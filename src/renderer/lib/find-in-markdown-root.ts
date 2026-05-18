/** Registered name for `::highlight(markedly-find)` in global CSS. */
export const FIND_HIGHLIGHT_NAME = "markedly-find";

/** Stronger style for the active match (`::highlight(markedly-find-current)`). */
export const FIND_HIGHLIGHT_CURRENT_NAME = "markedly-find-current";

export function fingerprintString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

function isInsideExcludedSubtree(node: Node): boolean {
  const start =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  if (!start) return true;
  const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start;
  return Boolean(el.closest("script, style, .mermaid-host"));
}

/** Literal substring matches (case-insensitive), one range per text node slice. */
export function collectFindRanges(
  root: HTMLElement,
  query: string,
): Range[] {
  const q = query.trim();
  if (!q) return [];

  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null = walker.nextNode();
  while (n) {
    const textNode = n as Text;
    if (!isInsideExcludedSubtree(textNode)) {
      const raw = textNode.data;
      const lowerRaw = raw.toLowerCase();
      const lowerQ = q.toLowerCase();
      let from = 0;
      while (from <= lowerRaw.length - lowerQ.length) {
        const idx = lowerRaw.indexOf(lowerQ, from);
        if (idx === -1) break;
        const r = document.createRange();
        r.setStart(textNode, idx);
        r.setEnd(textNode, idx + q.length);
        ranges.push(r);
        from = idx + Math.max(lowerQ.length, 1);
      }
    }
    n = walker.nextNode();
  }
  return ranges;
}

export function supportsCssCustomHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  );
}

export function applyFindHighlights(
  ranges: Range[],
  activeIndex: number,
): void {
  if (!supportsCssCustomHighlight()) return;
  if (ranges.length === 0) {
    CSS.highlights!.delete(FIND_HIGHLIGHT_NAME);
    CSS.highlights!.delete(FIND_HIGHLIGHT_CURRENT_NAME);
    return;
  }
  const safeIdx = Math.min(
    Math.max(activeIndex, 0),
    ranges.length - 1,
  );
  const inactive = ranges.filter((_, i) => i !== safeIdx);
  if (inactive.length > 0) {
    CSS.highlights!.set(FIND_HIGHLIGHT_NAME, new Highlight(...inactive));
  } else {
    CSS.highlights!.delete(FIND_HIGHLIGHT_NAME);
  }
  CSS.highlights!.set(
    FIND_HIGHLIGHT_CURRENT_NAME,
    new Highlight(ranges[safeIdx]!),
  );
}

export function clearFindHighlights(): void {
  if (supportsCssCustomHighlight()) {
    CSS.highlights!.delete(FIND_HIGHLIGHT_NAME);
    CSS.highlights!.delete(FIND_HIGHLIGHT_CURRENT_NAME);
  }
}

export function scrollRangeIntoView(
  range: Range,
  scrollParent: HTMLElement,
): void {
  const top = range.getBoundingClientRect().top;
  const parentTop = scrollParent.getBoundingClientRect().top;
  const marginTop = 8;
  const delta = top - parentTop + scrollParent.scrollTop - marginTop;
  scrollParent.scrollTo({
    top: Math.max(0, delta),
    behavior: "auto",
  });
}
