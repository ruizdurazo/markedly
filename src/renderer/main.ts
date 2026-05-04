import "./styles.scss";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { markedRenderingExtensions } from "./marked-extensions";
import {
  formatMetadataCell,
  splitFrontmatter,
} from "./frontmatter";
import ghDark from "highlight.js/styles/github-dark.css?inline";
import ghLight from "highlight.js/styles/github.css?inline";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function injectHighlighterTheme() {
  const light = document.createElement("style");
  light.setAttribute("data-hljs", "light");
  light.textContent = ghLight;
  const dark = document.createElement("style");
  dark.setAttribute("data-hljs", "dark");
  dark.textContent = `@media (prefers-color-scheme: dark) { ${ghDark} }`;
  document.head.append(light, dark);
}

injectHighlighterTheme();

marked.use(...markedRenderingExtensions);

const purify = DOMPurify(window);

const welcome = document.querySelector<HTMLElement>("#welcome")!;
const markdownRoot = document.querySelector<HTMLElement>("#markdown-root")!;
const content = document.querySelector<HTMLElement>("#content")!;
const scrollContainer = document.querySelector<HTMLElement>(".content-wrapper")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const openBtn = document.querySelector<HTMLButtonElement>("#open-btn")!;
const tabStrip = document.querySelector<HTMLElement>("#tab-strip")!;

let ignoreScrollEvents = false;

if (navigator.userAgent.toLowerCase().includes("mac")) {
  document.body.classList.add("platform-mac");
}

type Tab = {
  id: string;
  path: string | null;
  stale: boolean;
  /** Last vertical scroll position for this tab in `.content-wrapper`. */
  scrollTop: number;
};

function newTabId(): string {
  return crypto.randomUUID();
}

let tabs: Tab[] = [{ id: newTabId(), path: null, stale: false, scrollTop: 0 }];
let activeTabId = tabs[0]!.id;

let baseEl: HTMLBaseElement | null = null;

function getActiveTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

function activePath(): string | null {
  return getActiveTab()?.path ?? null;
}

function captureScrollForTabId(tabId: string) {
  const t = tabs.find((x) => x.id === tabId);
  if (t) t.scrollTop = scrollContainer.scrollTop;
}

function setBaseHref(dirUrl: string) {
  if (!baseEl) {
    baseEl = document.createElement("base");
    document.head.prepend(baseEl);
  }
  baseEl.href = dirUrl;
}

function clearBaseHref() {
  baseEl?.remove();
  baseEl = null;
}

function setStatus(text: string) {
  statusEl.textContent = text;
}

function tabLabel(tab: Tab): string {
  if (!tab.path) return "New tab";
  const parts = tab.path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
}

function syncWindowTitle() {
  const t = getActiveTab();
  if (t?.path) {
    document.title = `${tabLabel(t)} — Markedly`;
  } else {
    document.title = "Markedly";
  }
}

function renderTabStrip() {
  tabStrip.replaceChildren();
  for (const tab of tabs) {
    const wrap = document.createElement("div");
    wrap.className = "tab" + (tab.id === activeTabId ? " tab--active" : "");
    wrap.dataset.tabId = tab.id;

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "tab__select";
    selectBtn.role = "tab";
    selectBtn.setAttribute(
      "aria-selected",
      tab.id === activeTabId ? "true" : "false",
    );
    selectBtn.textContent = tabLabel(tab);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab__close";
    closeBtn.title = "Close tab";
    closeBtn.setAttribute("aria-label", "Close tab");
    closeBtn.textContent = "\u00d7";

    wrap.append(selectBtn, closeBtn);
    tabStrip.append(wrap);
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tab-new";
  addBtn.title = "New tab";
  addBtn.setAttribute("aria-label", "New tab");
  addBtn.textContent = "+";
  tabStrip.append(addBtn);
}

function showWelcomeView() {
  welcome.style.display = "flex";
  markdownRoot.hidden = true;
  content.classList.add("empty");
  clearBaseHref();
  syncWindowTitle();
}

function showMarkdownView() {
  welcome.style.display = "none";
  markdownRoot.hidden = false;
  content.classList.remove("empty");
}

async function renderMermaid(scope: ParentNode) {
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

function parseMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return purify.sanitize(raw, {
    ADD_ATTR: ["id", "class", "style"],
    ADD_TAGS: ["svg", "path", "g", "marker", "defs", "use"],
  });
}

function buildMetadataTableHtml(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata).filter(([k]) => k.length > 0);
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(formatMetadataCell(value))}</td></tr>`,
    )
    .join("");
  /* Flat table (no thead/tbody): nested parsing/sanitization edge cases in some engines */
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

function normalizeRootRelativeMediaUrls(root: HTMLElement): void {
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

async function loadPath(filePath: string, options?: { fragment?: string }) {
  const tab = getActiveTab();
  if (!tab) return;

  setStatus("Loading…");
  const result = await window.markedly.readFile(filePath);
  if (!result.ok) {
    setStatus(result.error);
    tab.path = null;
    tab.stale = false;
    showWelcomeView();
    renderTabStrip();
    ignoreScrollEvents = false;
    return;
  }
  ignoreScrollEvents = true;
  tab.path = result.path;
  tab.stale = false;
  setBaseHref(result.dirUrl);
  syncWindowTitle();
  const { body, metadata } = splitFrontmatter(result.content);
  const metaHtml =
    metadata && Object.keys(metadata).length > 0
      ? buildMetadataTableHtml(metadata)
      : "";
  const html = metaHtml + parseMarkdown(body);
  markdownRoot.innerHTML = html;
  normalizeRootRelativeMediaUrls(markdownRoot);
  showMarkdownView();
  setStatus(result.path);
  renderTabStrip();
  try {
    await renderMermaid(markdownRoot);
  } catch {
    setStatus(`${result.path} (diagram error)`);
  }
  const frag = options?.fragment;
  requestAnimationFrame(() => {
    if (frag) {
      scrollMarkdownToFragment(frag);
    } else {
      scrollContainer.scrollTop = tab.scrollTop;
    }
    requestAnimationFrame(() => {
      ignoreScrollEvents = false;
    });
  });
}

async function applyActiveTabToView() {
  const t = getActiveTab();
  if (!t) return;
  if (!t.path) {
    ignoreScrollEvents = true;
    setStatus("");
    showWelcomeView();
    renderTabStrip();
    requestAnimationFrame(() => {
      scrollContainer.scrollTop = t.scrollTop;
      requestAnimationFrame(() => {
        ignoreScrollEvents = false;
      });
    });
    return;
  }
  await loadPath(t.path);
}

function addTab() {
  captureScrollForTabId(activeTabId);
  ignoreScrollEvents = true;
  const id = newTabId();
  tabs.push({ id, path: null, stale: false, scrollTop: 0 });
  activeTabId = id;
  renderTabStrip();
  void applyActiveTabToView();
}

async function openPathInNewTab(filePath: string, fragment?: string) {
  captureScrollForTabId(activeTabId);
  ignoreScrollEvents = true;
  const id = newTabId();
  tabs.push({ id, path: null, stale: false, scrollTop: 0 });
  activeTabId = id;
  renderTabStrip();
  await loadPath(filePath, fragment ? { fragment } : undefined);
}

/** Open from dialog, OS, drop, or in-doc link: dedupe by path, else new tab if active already has a file. */
async function openFilePathSmart(
  filePath: string,
  options?: { fragment?: string },
) {
  const fragment = options?.fragment;
  const normalized = await window.markedly.normalizeMarkdownPath(filePath);
  if (!normalized) {
    const active = getActiveTab();
    if (active?.path) await openPathInNewTab(filePath, fragment);
    else await loadPath(filePath, options);
    return;
  }

  const existing = tabs.find((t) => t.path === normalized);
  if (existing) {
    if (existing.id === activeTabId) {
      if (fragment) {
        requestAnimationFrame(() => scrollMarkdownToFragment(fragment));
      }
      return;
    }
    captureScrollForTabId(activeTabId);
    ignoreScrollEvents = true;
    activeTabId = existing.id;
    renderTabStrip();
    await applyActiveTabToView();
    if (fragment) {
      requestAnimationFrame(() => scrollMarkdownToFragment(fragment));
    }
    return;
  }

  const active = getActiveTab();
  if (active?.path) {
    await openPathInNewTab(normalized, fragment);
  } else {
    await loadPath(normalized, options);
  }
}

function activateTab(tabId: string) {
  if (!tabs.some((t) => t.id === tabId)) return;
  captureScrollForTabId(activeTabId);
  ignoreScrollEvents = true;
  activeTabId = tabId;
  renderTabStrip();
  void applyActiveTabToView();
}

function closeTab(tabId: string) {
  if (!tabs.some((t) => t.id === tabId)) return;
  if (tabs.length <= 1) {
    window.close();
    return;
  }
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  tabs.splice(idx, 1);
  if (activeTabId === tabId) {
    ignoreScrollEvents = true;
    activeTabId = tabs[Math.max(0, idx - 1)]!.id;
    renderTabStrip();
    void applyActiveTabToView();
  } else {
    renderTabStrip();
  }
}

function closeActiveTabOrWindow() {
  closeTab(activeTabId);
}

function pathsFromDataTransfer(dt: DataTransfer | null): string[] {
  if (!dt?.files?.length) return [];
  const paths: string[] = [];
  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files.item(i);
    if (!file) continue;
    let p = "";
    try {
      p = window.markedly.getPathForFile(file);
    } catch {
      /* non-native File */
    }
    if (!p && "path" in file) {
      const legacy = (file as File & { path?: string }).path;
      if (typeof legacy === "string") p = legacy;
    }
    if (p) paths.push(p);
  }
  return paths;
}

function scrollMarkdownToFragment(fragment: string) {
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

function setupMarkdownLinks() {
  markdownRoot.addEventListener(
    "click",
    (e) => {
      void handleMarkdownLinkClick(e as MouseEvent);
    },
    true,
  );
}

async function handleMarkdownLinkClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a || !markdownRoot.contains(a)) return;
  const hrefAttr = a.getAttribute("href");
  if (hrefAttr == null || hrefAttr === "") return;

  const baseFile = activePath();
  if (!baseFile) return;

  const resolved = await window.markedly.resolveMarkdownLink(
    baseFile,
    hrefAttr,
  );
  if (!resolved) {
    const t = hrefAttr.trim();
    const looksRelative = !/^[a-z][a-z0-9+.-]*:/i.test(t);
    if (looksRelative) {
      e.preventDefault();
      setStatus(`Could not open link: ${hrefAttr}`);
    }
    return;
  }

  if (resolved.kind === "external") {
    e.preventDefault();
    await window.markedly.openExternal(resolved.url);
    return;
  }

  if (resolved.kind === "localFile") {
    e.preventDefault();
    await window.markedly.openLocalFile(resolved.path);
    return;
  }

  if (resolved.kind === "fragment") {
    e.preventDefault();
    scrollMarkdownToFragment(resolved.fragment);
    return;
  }

  if (resolved.kind === "markdown") {
    e.preventDefault();
    void openFilePathSmart(
      resolved.path,
      resolved.fragment ? { fragment: resolved.fragment } : undefined,
    );
    return;
  }
}

function setupDropTarget() {
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const candidates = pathsFromDataTransfer(e.dataTransfer);
    const mdPaths = candidates.filter((p) =>
      /\.(md|markdown|mdown|mkd)$/i.test(p),
    );
    if (mdPaths.length === 0) {
      if (candidates.length > 0) {
        setStatus("Drop a Markdown file (.md, .markdown, …)");
      }
      return;
    }
    const seen = new Set<string>();
    const unique = mdPaths.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    void (async () => {
      for (const p of unique) {
        await openFilePathSmart(p);
      }
    })();
  };
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
}

tabStrip.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".tab-new")) {
    addTab();
    return;
  }
  const closeEl = target.closest<HTMLElement>(".tab__close");
  if (closeEl) {
    const tabWrap = closeEl.closest<HTMLElement>(".tab");
    const id = tabWrap?.dataset.tabId;
    if (id) {
      e.stopPropagation();
      closeTab(id);
    }
    return;
  }
  const tabEl = target.closest<HTMLElement>(".tab");
  const id = tabEl?.dataset.tabId;
  if (id) activateTab(id);
});

openBtn.addEventListener("click", () => {
  void window.markedly.openDialog().then((p) => {
    if (p) void openFilePathSmart(p);
  });
});

window.markedly.onOpenPath((p) => void openFilePathSmart(p));
window.markedly.onOpenPathNewTab((p) => void openPathInNewTab(p));
window.markedly.onFileChanged((p) => {
  for (const t of tabs) {
    if (t.path !== p) continue;
    if (t.id === activeTabId) void loadPath(p);
    else t.stale = true;
  }
});
window.markedly.onThemeChanged(() => {
  const p = activePath();
  if (p) void loadPath(p);
});

window.markedly.onNewTab(() => addTab());
window.markedly.onCloseTab(() => closeActiveTabOrWindow());

setupDropTarget();
setupMarkdownLinks();

scrollContainer.addEventListener(
  "scroll",
  () => {
    if (ignoreScrollEvents) return;
    const t = getActiveTab();
    if (t) t.scrollTop = scrollContainer.scrollTop;
  },
  { passive: true },
);

renderTabStrip();
syncWindowTitle();
