import DOMPurify from "dompurify";
import { marked } from "marked";
import ghDark from "highlight.js/styles/github-dark.css?inline";
import ghLight from "highlight.js/styles/github.css?inline";
import type { ColorSchemePreference } from "../../shared/types.js";
import { markedRenderingExtensions } from "../marked-extensions";
import { wrapBareMermaidMarkdown } from "./wrap-bare-mermaid.js";

const HLJS_LIGHT_ID = "markedly-hljs-light";
const HLJS_DARK_ID = "markedly-hljs-dark";

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

function getHljsStyleElements(): {
  light: HTMLStyleElement | null;
  dark: HTMLStyleElement | null;
} {
  return {
    light: document.getElementById(HLJS_LIGHT_ID) as HTMLStyleElement | null,
    dark: document.getElementById(HLJS_DARK_ID) as HTMLStyleElement | null,
  };
}

/** Idempotent: creates highlight.js stylesheets if missing. */
export function injectHighlighterTheme(): void {
  if (document.getElementById(HLJS_LIGHT_ID)) return;
  const light = document.createElement("style");
  light.id = HLJS_LIGHT_ID;
  light.textContent = ghLight;
  const dark = document.createElement("style");
  dark.id = HLJS_DARK_ID;
  dark.textContent = ghDark;
  document.head.append(light, dark);
}

export function syncHighlighterColorScheme(
  preference: ColorSchemePreference,
): void {
  const { light, dark } = getHljsStyleElements();
  if (!light || !dark) return;
  if (preference === "light") {
    light.media = "all";
    dark.media = "not all";
  } else if (preference === "dark") {
    light.media = "not all";
    dark.media = "all";
  } else {
    light.media = "(prefers-color-scheme: light)";
    dark.media = "(prefers-color-scheme: dark)";
  }
}

export function parseMarkdown(md: string): string {
  const raw = marked.parse(wrapBareMermaidMarkdown(md), {
    async: false,
  }) as string;
  return purify.sanitize(raw, {
    ADD_ATTR: [
      "id",
      "class",
      "style",
      "data-mermaid-source",
      "data-markedly-expand-layout",
    ],
    ADD_TAGS: ["svg", "path", "g", "marker", "defs", "use"],
  });
}

/** Inserts a React mount point before each `.mermaid` inside `.mermaid-host` (idempotent). */
export function prepareMermaidDiagramHosts(root: HTMLElement): void {
  for (const host of root.querySelectorAll<HTMLElement>(".mermaid-host")) {
    if (host.querySelector(":scope > .mermaid-host__bridge")) continue;
    const mermaid = host.querySelector<HTMLElement>(":scope > .mermaid");
    if (!mermaid) continue;
    const bridge = document.createElement("div");
    bridge.className = "mermaid-host__bridge";
    host.insertBefore(bridge, mermaid);
  }
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

export async function renderMermaid(
  scope: ParentNode,
  resolved: "light" | "dark",
): Promise<void> {
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>(".mermaid"));
  if (nodes.length === 0) return;
  const m = (await import("mermaid")).default;
  m.initialize({
    startOnLoad: false,
    theme: resolved === "dark" ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: "inherit",
  });

  const errors: unknown[] = [];
  for (const node of nodes) {
    const sourceAttr = node.getAttribute("data-mermaid-source");
    let source = node.textContent ?? "";
    if (sourceAttr) {
      try {
        source = decodeURIComponent(sourceAttr);
      } catch {
        source = node.textContent ?? "";
      }
    }
    if (!source.trim()) continue;

    try {
      const id = `markedly-mermaid-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const { svg, bindFunctions } = await m.render(id, source);
      node.innerHTML = svg;
      bindFunctions?.(node);
      node.classList.remove("mermaid--error");
    } catch (error) {
      errors.push(error);
      node.classList.add("mermaid--error");
      node.textContent = source;
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }
}
