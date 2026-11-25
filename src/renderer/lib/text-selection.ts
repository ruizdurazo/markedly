/**
 * Selection bridge between preview HTML and the editor.
 *
 * The two modes do not share DOM nodes, but they show the same document in the
 * same order. A selection is stored as offsets into that visible text, then
 * rebuilt on the next tree. Whitespace that only exists to format the HTML is
 * ignored so the offsets line up; code and math keep their own whitespace.
 */

const CONTEXT = 80;

export type TextSelectionAnchor = {
  start: number;
  end: number;
  text: string;
  prefix: string;
  suffix: string;
  reversed: boolean;
};

type Piece = {
  text: string;
  normStart: number;
  node: Text | null;
  domFrom: number;
  domTo: number;
  host: HTMLElement | null;
};

type FlatText = {
  text: string;
  pieces: Piece[];
};

type WalkState = {
  pieces: Piece[];
  checkboxLi: HTMLElement | null;
  checkboxTrim: boolean;
};

type Boundary =
  | { type: "text"; node: Text; offset: number }
  | { type: "before"; el: HTMLElement }
  | { type: "after"; el: HTMLElement };

function mermaidSource(el: HTMLElement): string {
  const encoded = el
    .querySelector("[data-mermaid-source]")
    ?.getAttribute("data-mermaid-source");
  if (!encoded) return "";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function preserveWhitespace(node: Text): boolean {
  return Boolean(node.parentElement?.closest("pre, code, .md-code-block, .md-math"));
}

function isTaskItem(el: HTMLElement): boolean {
  return (
    el.classList.contains("md-task") ||
    el.classList.contains("md-task-checked") ||
    el.querySelector(":scope > input[type='checkbox']") != null
  );
}

function isBlockCode(el: HTMLElement): boolean {
  return (
    el.matches("pre, .md-code-block") &&
    !el.parentElement?.closest("pre, .md-code-block")
  );
}

function shouldSkip(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.hasAttribute("data-markedly-ignore-selection")) return true;
  return el.matches("script, style");
}

function pushPiece(pieces: Piece[], text: string, node: Text | null, domFrom: number, domTo: number, host: HTMLElement | null) {
  if (!text) return;
  pieces.push({
    text,
    normStart: 0,
    node,
    domFrom,
    domTo,
    host,
  });
}

/** Marked keeps the fence's closing newline; the editor does not. */
function stripOneTrailingNewline(pieces: Piece[], from: number) {
  for (let i = pieces.length - 1; i >= from; i -= 1) {
    const piece = pieces[i];
    if (!piece || piece.text.length === 0) continue;
    if (!piece.text.endsWith("\n")) return;
    piece.text = piece.text.slice(0, -1);
    if (piece.node) piece.domTo -= 1;
    if (piece.text.length === 0) pieces.splice(i, 1);
    return;
  }
}

function walk(node: Node, state: WalkState) {
  if (node instanceof HTMLElement) {
    if (shouldSkip(node)) return;
    if (node.classList.contains("mermaid-host")) {
      const text = mermaidSource(node).replace(/\n$/, "");
      pushPiece(state.pieces, text, null, 0, 0, node);
      return;
    }
    if (isBlockCode(node)) {
      const mark = state.pieces.length;
      const checkboxLi = state.checkboxLi;
      const checkboxTrim = state.checkboxTrim;
      for (const child of node.childNodes) walk(child, state);
      stripOneTrailingNewline(state.pieces, mark);
      state.checkboxLi = checkboxLi;
      state.checkboxTrim = checkboxTrim;
      return;
    }
    const checkboxLi = state.checkboxLi;
    const checkboxTrim = state.checkboxTrim;
    if (node.matches("li") && isTaskItem(node)) {
      state.checkboxLi = node;
      state.checkboxTrim = true;
    }
    for (const child of node.childNodes) walk(child, state);
    state.checkboxLi = checkboxLi;
    state.checkboxTrim = checkboxTrim;
    return;
  }
  if (node.nodeType !== Node.TEXT_NODE) return;
  const textNode = node as Text;
  const data = textNode.data;
  const preserve = preserveWhitespace(textNode);
  if (!preserve && data.trim() === "") return;
  let domFrom = 0;
  if (
    state.checkboxTrim &&
    state.checkboxLi &&
    textNode.parentElement?.closest("li") === state.checkboxLi
  ) {
    state.checkboxTrim = false;
    if (!preserve && (data.startsWith(" ") || data.startsWith("\u00a0"))) {
      domFrom = 1;
    }
  }
  if (preserve) {
    pushPiece(state.pieces, data.slice(domFrom), textNode, domFrom, data.length, null);
    return;
  }
  // Preview soft breaks are newline characters. The editor uses <br>, which
  // has no text, so those newlines must not occupy an offset.
  let i = domFrom;
  while (i < data.length) {
    const ch = data.charCodeAt(i);
    if (ch === 10 || ch === 13) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < data.length) {
      const next = data.charCodeAt(i);
      if (next === 10 || next === 13) break;
      i += 1;
    }
    pushPiece(state.pieces, data.slice(start, i), textNode, start, i, null);
  }
}

function flatten(scope: HTMLElement): FlatText {
  const state: WalkState = {
    pieces: [],
    checkboxLi: null,
    checkboxTrim: false,
  };
  walk(scope, state);
  let offset = 0;
  for (const piece of state.pieces) {
    piece.normStart = offset;
    offset += piece.text.length;
  }
  return {
    text: state.pieces.map((piece) => piece.text).join(""),
    pieces: state.pieces,
  };
}

function clampOffset(node: Node, offset: number): number {
  const max =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).length
      : node.childNodes.length;
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(offset, max));
}

/** Negative when `a` is before `b`. */
function comparePoints(
  aNode: Node,
  aOffset: number,
  bNode: Node,
  bOffset: number,
): number {
  const range = document.createRange();
  range.setStart(aNode, clampOffset(aNode, aOffset));
  range.collapse(true);
  return -range.comparePoint(bNode, clampOffset(bNode, bOffset));
}

function mermaidHostWithin(scope: HTMLElement, node: Node): HTMLElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  const host = el?.closest(".mermaid-host");
  if (!(host instanceof HTMLElement) || !scope.contains(host)) return null;
  return host;
}

function pointAfterElement(
  el: HTMLElement,
  container: Node,
  offset: number,
): boolean {
  if (el.contains(container) && container !== el) return false;
  const parent = el.parentNode;
  if (parent && container === parent) {
    const index = Array.prototype.indexOf.call(parent.childNodes, el);
    return index >= 0 && offset >= index + 1;
  }
  return (el.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function offsetForPoint(
  scope: HTMLElement,
  flat: FlatText,
  container: Node,
  offset: number,
  bias: "start" | "end",
): number | null {
  if (flat.pieces.length === 0) return null;
  const host = mermaidHostWithin(scope, container);
  if (host) {
    const piece = flat.pieces.find((item) => item.host === host);
    if (!piece) return null;
    return bias === "end" ? piece.normStart + piece.text.length : piece.normStart;
  }
  try {
    let count = 0;
    for (const piece of flat.pieces) {
      if (piece.host) {
        if (pointAfterElement(piece.host, container, offset)) {
          count = piece.normStart + piece.text.length;
          continue;
        }
        return piece.normStart;
      }
      if (!piece.node) continue;
      if (comparePoints(piece.node, piece.domTo, container, offset) <= 0) {
        count = piece.normStart + piece.text.length;
        continue;
      }
      if (comparePoints(piece.node, piece.domFrom, container, offset) >= 0) {
        return piece.normStart;
      }
      if (container === piece.node) {
        const clamped = Math.max(piece.domFrom, Math.min(offset, piece.domTo));
        return piece.normStart + (clamped - piece.domFrom);
      }
      return piece.normStart;
    }
    return count;
  } catch {
    return null;
  }
}

function inField(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return Boolean(el?.closest("input, textarea, select"));
}

function containsNode(scope: HTMLElement, node: Node | null): node is Node {
  return node != null && (scope === node || scope.contains(node));
}

export function captureTextSelection(
  scope: HTMLElement,
): TextSelectionAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    !containsNode(scope, range.startContainer) ||
    !containsNode(scope, range.endContainer) ||
    inField(range.startContainer) ||
    inField(range.endContainer)
  ) {
    return null;
  }
  const flat = flatten(scope);
  if (flat.pieces.length === 0) return null;
  let start = offsetForPoint(
    scope,
    flat,
    range.startContainer,
    range.startOffset,
    "start",
  );
  let end = range.collapsed
    ? start
    : offsetForPoint(scope, flat, range.endContainer, range.endOffset, "end");
  if (start == null || end == null) return null;
  const startHost = mermaidHostWithin(scope, range.startContainer);
  const endHost = mermaidHostWithin(scope, range.endContainer);
  if (startHost && startHost === endHost) {
    const piece = flat.pieces.find((item) => item.host === startHost);
    if (piece) {
      if (range.collapsed) {
        start = piece.normStart;
        end = piece.normStart;
      } else {
        const raw = range.toString();
        const at = raw ? piece.text.indexOf(raw) : -1;
        if (at >= 0) {
          start = piece.normStart + at;
          end = start + raw.length;
        } else {
          start = piece.normStart;
          end = piece.normStart + piece.text.length;
        }
      }
    }
  }
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }
  let reversed = false;
  if (
    !selection.isCollapsed &&
    selection.anchorNode &&
    selection.focusNode
  ) {
    try {
      reversed =
        comparePoints(
          selection.anchorNode,
          selection.anchorOffset,
          selection.focusNode,
          selection.focusOffset,
        ) > 0;
    } catch {
      reversed = false;
    }
  }
  return {
    start,
    end,
    text: flat.text.slice(start, end),
    prefix: flat.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: flat.text.slice(end, end + CONTEXT),
    reversed,
  };
}

function regionMatches(
  haystack: string,
  anchor: TextSelectionAnchor,
  start: number,
): boolean {
  if (start < 0 || start + anchor.text.length > haystack.length) return false;
  if (haystack.slice(start, start + anchor.text.length) !== anchor.text) {
    return false;
  }
  if (anchor.prefix.length > 0) {
    if (start < anchor.prefix.length) return false;
    if (haystack.slice(start - anchor.prefix.length, start) !== anchor.prefix) {
      return false;
    }
  }
  if (anchor.suffix.length > 0) {
    const from = start + anchor.text.length;
    if (haystack.slice(from, from + anchor.suffix.length) !== anchor.suffix) {
      return false;
    }
  }
  return true;
}

function closestIndex(haystack: string, needle: string, hint: number): number {
  if (!needle) return -1;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const dist = Math.abs(at - hint);
    if (dist < bestDist) {
      best = at;
      bestDist = dist;
      if (dist === 0) break;
    }
    from = at + 1;
  }
  return best;
}

function locate(
  haystack: string,
  anchor: TextSelectionAnchor,
): { start: number; end: number } | null {
  if (regionMatches(haystack, anchor, anchor.start)) {
    return { start: anchor.start, end: anchor.start + anchor.text.length };
  }
  const needle = anchor.prefix + anchor.text + anchor.suffix;
  if (needle.length > 0) {
    const at = closestIndex(haystack, needle, anchor.start - anchor.prefix.length);
    if (at >= 0) {
      const start = at + anchor.prefix.length;
      return { start, end: start + anchor.text.length };
    }
  }
  if (anchor.text.length > 0) {
    const at = closestIndex(haystack, anchor.text, anchor.start);
    if (at >= 0) return { start: at, end: at + anchor.text.length };
  }
  if (anchor.text.length === 0) {
    if (anchor.suffix.length > 0) {
      const at = closestIndex(haystack, anchor.suffix, anchor.start);
      if (at >= 0) return { start: at, end: at };
    }
    if (anchor.prefix.length > 0) {
      const at = closestIndex(
        haystack,
        anchor.prefix,
        anchor.start - anchor.prefix.length,
      );
      if (at >= 0) {
        const start = at + anchor.prefix.length;
        return { start, end: start };
      }
    }
  }
  return null;
}

function pieceForStart(flat: FlatText, offset: number): Piece {
  for (const piece of flat.pieces) {
    if (offset < piece.normStart + piece.text.length) return piece;
  }
  return flat.pieces[flat.pieces.length - 1]!;
}

function pieceForEnd(flat: FlatText, offset: number): Piece {
  if (offset <= 0) return flat.pieces[0]!;
  for (const piece of flat.pieces) {
    const end = piece.normStart + piece.text.length;
    if (offset <= end && offset > piece.normStart) return piece;
  }
  return flat.pieces[flat.pieces.length - 1]!;
}

function boundaryInPiece(piece: Piece, local: number, edge: "start" | "end"): Boundary | null {
  const clamped = Math.max(0, Math.min(local, piece.text.length));
  if (piece.host) {
    if (clamped <= 0) return { type: "before", el: piece.host };
    if (clamped >= piece.text.length) return { type: "after", el: piece.host };
    return edge === "end"
      ? { type: "after", el: piece.host }
      : { type: "before", el: piece.host };
  }
  if (!piece.node) return null;
  return { type: "text", node: piece.node, offset: piece.domFrom + clamped };
}

function boundaryAt(
  flat: FlatText,
  offset: number,
  edge: "start" | "end" | "caret",
): Boundary | null {
  if (flat.pieces.length === 0) return null;
  const o = Math.max(0, Math.min(offset, flat.text.length));
  if (edge === "caret") {
    if (o >= flat.text.length) {
      const piece = flat.pieces[flat.pieces.length - 1]!;
      return boundaryInPiece(piece, piece.text.length, "end");
    }
    const piece = pieceForStart(flat, o);
    return boundaryInPiece(piece, o - piece.normStart, "start");
  }
  if (edge === "end" && o === 0) return boundaryAt(flat, 0, "start");
  const piece = edge === "start" ? pieceForStart(flat, o) : pieceForEnd(flat, o);
  return boundaryInPiece(piece, o - piece.normStart, edge);
}

function toDomPoint(boundary: Boundary): { node: Node; offset: number } | null {
  if (boundary.type === "text") {
    return {
      node: boundary.node,
      offset: clampOffset(boundary.node, boundary.offset),
    };
  }
  const parent = boundary.el.parentNode;
  if (!parent) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, boundary.el);
  if (index < 0) return null;
  return {
    node: parent,
    offset: boundary.type === "before" ? index : index + 1,
  };
}

function scrollParent(scope: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = scope;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function applyTextSelection(
  scope: HTMLElement,
  anchor: TextSelectionAnchor,
): boolean {
  const flat = flatten(scope);
  const found = locate(flat.text, anchor);
  if (!found) return false;
  const collapsed = found.start === found.end;
  const startBoundary = boundaryAt(
    flat,
    found.start,
    collapsed ? "caret" : "start",
  );
  const endBoundary = collapsed
    ? startBoundary
    : boundaryAt(flat, found.end, "end");
  if (!startBoundary || !endBoundary) return false;
  const startPoint = toDomPoint(startBoundary);
  const endPoint = toDomPoint(endBoundary);
  if (!startPoint || !endPoint) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  const base = anchor.reversed && !collapsed ? endPoint : startPoint;
  const extent = anchor.reversed && !collapsed ? startPoint : endPoint;
  const scroller = scrollParent(scope);
  const top = scroller?.scrollTop ?? 0;
  const left = scroller?.scrollLeft ?? 0;
  try {
    selection.setBaseAndExtent(base.node, base.offset, extent.node, extent.offset);
  } catch {
    return false;
  }
  if (scroller) {
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
  }
  return true;
}

export function textSelectionMatches(
  scope: HTMLElement,
  anchor: TextSelectionAnchor,
): boolean {
  const current = captureTextSelection(scope);
  if (!current || current.reversed !== anchor.reversed || current.text !== anchor.text) {
    return false;
  }
  const found = locate(flatten(scope).text, anchor);
  return found != null && current.start === found.start && current.end === found.end;
}
