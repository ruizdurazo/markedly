const BLOCK_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
  "ul",
  "ol",
  "blockquote",
  "table",
  "hr",
  ".md-math",
  ".md-code-block",
  ".mermaid-host",
].join(",");

const TEXT_LIMIT = 160;
const PORT_EDGE_PX = 8;

export type ScrollAnchor = {
  kind: string;
  textKey: string;
  hasText: boolean;
  occurrence: number;
  offsetFromPortTop: number;
  scrollTop: number;
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Preview fences, editor code, and Mermaid hosts share a kind so they match across modes. */
function blockKind(el: HTMLElement): string {
  if (
    el.classList.contains("mermaid-host") ||
    el.classList.contains("md-code-block") ||
    el.tagName === "PRE"
  ) {
    return "code";
  }
  if (el.classList.contains("md-math")) return "math";
  return el.tagName.toLowerCase();
}

function rawBlockText(el: HTMLElement): string {
  if (el.classList.contains("mermaid-host")) {
    const encoded = el
      .querySelector("[data-mermaid-source]")
      ?.getAttribute("data-mermaid-source");
    if (encoded) {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    }
  }
  return el.textContent ?? "";
}

function blockTextKey(el: HTMLElement): { key: string; hasText: boolean } {
  const normalized = normalizeText(rawBlockText(el));
  return {
    hasText: normalized.length > 0,
    key: `${normalized.slice(0, TEXT_LIMIT)}:${hashText(normalized)}`,
  };
}

function topLevelBlocks(scope: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const el of scope.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    const parentBlock = el.parentElement?.closest(BLOCK_SELECTOR);
    if (parentBlock && scope.contains(parentBlock)) continue;
    blocks.push(el);
  }
  return blocks;
}

function nthMatch(
  blocks: HTMLElement[],
  occurrence: number,
  match: (el: HTMLElement) => boolean,
): HTMLElement | null {
  let seen = 0;
  for (const el of blocks) {
    if (!match(el)) continue;
    if (seen === occurrence) return el;
    seen += 1;
  }
  return null;
}

function findAnchorElement(
  scope: HTMLElement,
  anchor: ScrollAnchor,
): HTMLElement | null {
  if (!anchor.kind) return null;
  const blocks = topLevelBlocks(scope);
  const sameKindAndText = (el: HTMLElement) =>
    blockKind(el) === anchor.kind && blockTextKey(el).key === anchor.textKey;
  const primary = nthMatch(blocks, anchor.occurrence, sameKindAndText);
  if (primary || !anchor.hasText) return primary;
  const sameText = (el: HTMLElement) => blockTextKey(el).key === anchor.textKey;
  return (
    nthMatch(blocks, anchor.occurrence, sameText) ??
    nthMatch(blocks, 0, sameText)
  );
}

/** Block nearest the top of the scrollport, plus the raw scroll offset as a fallback. */
export function captureScrollAnchor(
  scrollParent: HTMLElement,
  scope: HTMLElement,
): ScrollAnchor {
  const scrollTop = scrollParent.scrollTop;
  const portTop = scrollParent.getBoundingClientRect().top;
  const blocks = topLevelBlocks(scope);
  let chosen: HTMLElement | null = null;
  for (const el of blocks) {
    if (el.getBoundingClientRect().bottom > portTop + PORT_EDGE_PX) {
      chosen = el;
      break;
    }
  }
  if (!chosen && blocks.length > 0) chosen = blocks[blocks.length - 1] ?? null;
  if (!chosen) {
    return {
      kind: "",
      textKey: "",
      hasText: false,
      occurrence: 0,
      offsetFromPortTop: 0,
      scrollTop,
    };
  }
  const kind = blockKind(chosen);
  const { key, hasText } = blockTextKey(chosen);
  let occurrence = 0;
  for (const el of blocks) {
    if (el === chosen) break;
    if (blockKind(el) !== kind || blockTextKey(el).key !== key) continue;
    occurrence += 1;
  }
  return {
    kind,
    textKey: key,
    hasText,
    occurrence,
    offsetFromPortTop: chosen.getBoundingClientRect().top - portTop,
    scrollTop,
  };
}

/** Place the anchored block at the same viewport offset. Returns the applied scrollTop. */
export function applyScrollAnchor(
  scrollParent: HTMLElement,
  scope: HTMLElement,
  anchor: ScrollAnchor,
): number {
  const el = anchor.kind ? findAnchorElement(scope, anchor) : null;
  if (!el) {
    scrollParent.scrollTop = anchor.scrollTop;
    return scrollParent.scrollTop;
  }
  const delta =
    el.getBoundingClientRect().top -
    scrollParent.getBoundingClientRect().top -
    anchor.offsetFromPortTop;
  if (delta !== 0) scrollParent.scrollTop += delta;
  return scrollParent.scrollTop;
}
