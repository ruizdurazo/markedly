import DOMPurify from "dompurify";
import { marked } from "marked";
import { markedRenderingExtensions } from "../renderer/marked-extensions";
import {
  formatMetadataCell,
  splitFrontmatter,
} from "../renderer/frontmatter";

type QuickLookBridge = {
  getPreviewedFile(): Promise<{ file: File; path: string }>;
  finishedLoading(): Promise<void>;
};

declare global {
  interface Window {
    quicklook?: QuickLookBridge;
  }
}

const preview = document.querySelector<HTMLElement>("#preview")!;
const purify = DOMPurify(window);
let didFinishLoading = false;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

marked.use(...markedRenderingExtensions);

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "Markdown Preview";
}

function directoryFileUrl(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const directory = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "/";
  const encoded = directory
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encoded}`;
}

function setBaseHref(path: string): void {
  const base = document.createElement("base");
  base.href = directoryFileUrl(path);
  document.head.prepend(base);
}

function buildMetadataTableHtml(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata).filter(([key]) => key.length > 0);
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(formatMetadataCell(value))}</td></tr>`,
    )
    .join("");
  return `<section class="doc-metadata" aria-label="Document metadata"><table class="doc-metadata__table"><thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function parseMarkdown(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  return purify.sanitize(raw, {
    ADD_ATTR: ["id", "class", "style"],
    ADD_TAGS: ["svg", "path", "g", "marker", "defs", "use"],
  });
}

function rewriteRootRelativeAttrValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;
  if (!trimmed.startsWith("/")) return null;
  return `.${trimmed}`;
}

function normalizeRootRelativeMediaUrls(root: HTMLElement): void {
  const pairs: { selector: string; attr: string }[] = [
    { selector: "img[src]", attr: "src" },
    { selector: "video[src]", attr: "src" },
    { selector: "audio[src]", attr: "src" },
    { selector: "source[src]", attr: "src" },
    { selector: "track[src]", attr: "src" },
    { selector: "video[poster]", attr: "poster" },
  ];

  for (const { selector, attr } of pairs) {
    for (const el of root.querySelectorAll(selector)) {
      const value = el.getAttribute(attr);
      if (value == null) continue;
      const next = rewriteRootRelativeAttrValue(value);
      if (next) el.setAttribute(attr, next);
    }
  }

  for (const el of root.querySelectorAll("[srcset]")) {
    const value = el.getAttribute("srcset");
    if (value == null) continue;
    const next = value
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const spaceIndex = trimmed.lastIndexOf(" ");
        const urlPart =
          spaceIndex >= 0 ? trimmed.slice(0, spaceIndex).trim() : trimmed;
        const descriptor = spaceIndex >= 0 ? trimmed.slice(spaceIndex) : "";
        const normalized = rewriteRootRelativeAttrValue(urlPart);
        return normalized ? `${normalized}${descriptor}` : trimmed;
      })
      .join(", ");
    el.setAttribute("srcset", next);
  }
}

async function renderMermaid(scope: ParentNode): Promise<void> {
  const nodes = scope.querySelectorAll(".mermaid");
  if (nodes.length === 0) return;
  const mermaid = (await import("mermaid")).default;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: "inherit",
  });
  await mermaid.run({ nodes: Array.from(nodes) as HTMLElement[] });
}

function showError(title: string, detail: string): void {
  preview.innerHTML = `<section class="preview__error" role="alert"><p class="preview__error-title">${escapeHtml(title)}</p><p class="preview__error-detail">${escapeHtml(detail)}</p></section>`;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function finishQuickLook(bridge: QuickLookBridge): Promise<void> {
  if (didFinishLoading) return;
  didFinishLoading = true;
  await bridge.finishedLoading();
}

async function main(): Promise<void> {
  const bridge = window.quicklook;
  if (!bridge) {
    showError(
      "Quick Look is unavailable",
      "This preview page must be loaded by the macOS Quick Look extension.",
    );
    return;
  }

  try {
    const { file, path } = await withTimeout(
      bridge.getPreviewedFile(),
      8000,
      "Quick Look did not provide the selected file.",
    );
    const content = await file.text();
    const { body, metadata } = splitFrontmatter(content);
    const metadataHtml =
      metadata && Object.keys(metadata).length > 0
        ? buildMetadataTableHtml(metadata)
        : "";

    document.title = fileNameFromPath(path);
    setBaseHref(path);
    preview.innerHTML = purify.sanitize(metadataHtml, {
      ADD_ATTR: ["class", "scope", "aria-label"],
    }) + parseMarkdown(body);
    normalizeRootRelativeMediaUrls(preview);
    await finishQuickLook(bridge);

    try {
      await renderMermaid(preview);
    } catch {
      // Keep the rest of the Markdown preview usable if a diagram fails.
    }
  } catch (error) {
    showError(
      "Unable to preview Markdown",
      error instanceof Error ? error.message : String(error),
    );
    await finishQuickLook(bridge);
  }
}

void main();
