import DOMPurify from "dompurify";
import { marked } from "marked";
import ghDark from "highlight.js/styles/github-dark.css?inline";
import ghLight from "highlight.js/styles/github.css?inline";
import { markedRenderingExtensions } from "../marked-extensions";

marked.use(...markedRenderingExtensions);

const purify = DOMPurify(window);

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function injectHighlighterTheme(): void {
  const light = document.createElement("style");
  light.setAttribute("data-hljs", "light");
  light.textContent = ghLight;
  const dark = document.createElement("style");
  dark.setAttribute("data-hljs", "dark");
  dark.textContent = `@media (prefers-color-scheme: dark) { ${ghDark} }`;
  document.head.append(light, dark);
}

export function parseMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return purify.sanitize(raw, {
    ADD_ATTR: ["id", "class", "style"],
    ADD_TAGS: ["svg", "path", "g", "marker", "defs", "use"],
  });
}

export function buildMetadataTableHtml(
  metadata: Record<string, unknown>,
  formatCell: (value: unknown) => string,
): string {
  const entries = Object.entries(metadata).filter(([k]) => k.length > 0);
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(formatCell(value))}</td></tr>`,
    )
    .join("");
  const raw = `<section class="doc-metadata" aria-label="Document metadata"><table class="doc-metadata__table"><tr><th scope="col">Field</th><th scope="col">Value</th></tr>${rows}</table></section>`;
  return purify.sanitize(raw, {
    ADD_ATTR: ["id", "class", "style", "scope"],
    ADD_TAGS: ["svg", "path", "g", "marker", "defs", "use"],
  });
}

/** Map `/folder/asset` → `./folder/asset` so URLs resolve against `<base href>` (doc dir), not filesystem root. */
function rewriteRootRelativeAttrValue(value: string): string | null {
  const t = value.trim();
  if (!t || t.startsWith("//")) return null;
  if (!t.startsWith("/")) return null;
  return `.${t}`;
}

export function normalizeRootRelativeMediaUrls(root: HTMLElement): void {
  const pairs: { sel: string; attr: string }[] = [
    { sel: "img[src]", attr: "src" },
    { sel: "video[src]", attr: "src" },
    { sel: "audio[src]", attr: "src" },
    { sel: "source[src]", attr: "src" },
    { sel: "track[src]", attr: "src" },
    { sel: "video[poster]", attr: "poster" },
  ];
  for (const { sel, attr } of pairs) {
    for (const el of root.querySelectorAll(sel)) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      const n = rewriteRootRelativeAttrValue(v);
      if (n) el.setAttribute(attr, n);
    }
  }
  for (const el of root.querySelectorAll("[srcset]")) {
    const v = el.getAttribute("srcset");
    if (v == null) continue;
    const next = v
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const si = trimmed.lastIndexOf(" ");
        const urlPart = si >= 0 ? trimmed.slice(0, si).trim() : trimmed;
        const desc = si >= 0 ? trimmed.slice(si) : "";
        const n = rewriteRootRelativeAttrValue(urlPart);
        return n ? `${n}${desc}` : trimmed;
      })
      .join(", ");
    el.setAttribute("srcset", next);
  }
}

/** Headings shown in the outline: same order as `querySelectorAll` document order, skips empty titles. */
export function getMarkdownHeadingElements(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!(node instanceof HTMLElement)) continue;
    const level = Number.parseInt(node.tagName.slice(1), 10);
    if (!Number.isFinite(level)) continue;
    if (!node.textContent?.trim()) continue;
    out.push(node);
  }
  return out;
}

/**
 * Scroll a nested scroll container so `el` aligns with the top of the viewport.
 * Prefer this over `scrollIntoView` when the document lives in `overflow: auto` (e.g. Electron), where
 * the window viewport can look "fine" while the inner scroller never moves.
 */
export function scrollElementIntoScrollParent(
  el: HTMLElement,
  scrollParent: HTMLElement,
  options?: { behavior?: ScrollBehavior; marginTop?: number },
): void {
  const behavior = options?.behavior ?? "smooth";
  const marginTop = options?.marginTop ?? 0;
  const delta =
    el.getBoundingClientRect().top -
    scrollParent.getBoundingClientRect().top +
    scrollParent.scrollTop -
    marginTop;
  scrollParent.scrollTo({
    top: Math.max(0, delta),
    behavior,
  });
}

export function scrollMarkdownToFragment(
  fragment: string,
  markdownRoot: HTMLElement,
): void {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    /* keep raw */
  }
  let el: Element | null = null;
  try {
    el = markdownRoot.querySelector(`#${CSS.escape(decoded)}`);
  } catch {
    el = null;
  }
  if (!el) {
    el = document.getElementById(decoded);
  }
  if (!el) {
    try {
      el = markdownRoot.querySelector(`a[name="${CSS.escape(decoded)}"]`);
    } catch {
      el = null;
    }
  }
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export async function renderMermaid(scope: ParentNode): Promise<void> {
  const nodes = scope.querySelectorAll(".mermaid");
  if (nodes.length === 0) return;
  const m = (await import("mermaid")).default;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  m.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: "inherit",
  });
  await m.run({ nodes: Array.from(nodes) as HTMLElement[] });
}
