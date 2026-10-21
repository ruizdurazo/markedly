import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  composeMarkdown,
  formatMetadataCell,
  splitFrontmatter,
} from "./frontmatter";
import {
  buildMetadataTableHtml,
  getMarkdownHeadingElements,
  injectHighlighterTheme,
  parseMarkdown,
  scrollElementIntoScrollParent,
  scrollMarkdownToFragment,
  syncHighlighterColorScheme,
} from "./lib/markdown-html";
import {
  applyFindHighlights,
  clearFindHighlights,
  collectFindRanges,
  fingerprintString,
  scrollRangeIntoView,
} from "./lib/find-in-markdown-root";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownBody, type MarkdownBodyHandle } from "./MarkdownBody";
import statusStyles from "./StatusBar.module.scss";
import SidebarLeftIcon from "../assets/icons/sidebar-left.svg?react";
import SidebarRightIcon from "../assets/icons/sidebar-right.svg?react";
import TextSansIcon from "../assets/icons/text-sans.svg?react";
import TextSerifIcon from "../assets/icons/text-serif.svg?react";
import {
  Check,
  HalfMoon,
  ModernTv,
  EditPencil,
  Search,
  SunLight,
  Xmark,
} from "iconoir-react";
import { TabStrip } from "./TabStrip";
import appStyles from "./App.module.scss";
import { Welcome } from "./Welcome";
import type { ColorSchemePreference, DirTreeNode } from "../shared/types.js";
import { FileTreePanel } from "./FileTreePanel";
import { TocPanel, type TocEntry } from "./TocPanel";
import { Tooltip } from "./Tooltip";
import {
  applyColorSchemeToDocument,
  getResolvedColorScheme,
  readStoredColorSchemePreference,
  writeStoredColorSchemePreference,
} from "./color-scheme";
import {
  applyFontPreferenceToDocument,
  readStoredFontPreference,
  writeStoredFontPreference,
  type FontPreference,
} from "./font-preference";

type Tab = {
  id: string;
  path: string | null;
  stale: boolean;
  dirty: boolean;
  /** True once this tab is an open file or an untitled document. */
  document: boolean;
  /** Pencil is edit. Check saves and returns to the rendered preview. */
  editing: boolean;
  scrollTop: number;
};

/** Per-tab Markdown source so switching tabs does not re-fetch. */
type TabContentCache = {
  body: string;
  savedBody: string;
  frontmatterRaw: string | null;
  metadataHtml: string;
  /** Rendered preview, including the metadata table. */
  html: string;
  dirUrl: string;
  path: string | null;
  generation: number;
  hydrated: boolean;
};

function newTabId(): string {
  return crypto.randomUUID();
}

function blankTab(id: string, scrollTop = 0): Tab {
  return {
    id,
    path: null,
    stale: false,
    dirty: false,
    document: false,
    editing: false,
    scrollTop,
  };
}

function emptyDocumentCache(): TabContentCache {
  return {
    body: "",
    savedBody: "",
    frontmatterRaw: null,
    metadataHtml: "",
    html: "",
    dirUrl: "",
    path: null,
    generation: 1,
    hydrated: false,
  };
}

function documentName(tab: Tab): string {
  if (tab.path) {
    const parts = tab.path.split(/[/\\]/);
    return parts[parts.length - 1] || "Untitled";
  }
  if (tab.document) return "Untitled";
  return "New tab";
}

function tabLabel(tab: Tab): string {
  const name = documentName(tab);
  return tab.dirty ? `${name} •` : name;
}

function buildPreviewHtml(metadataHtml: string, body: string): string {
  return metadataHtml + parseMarkdown(body);
}

const DEFAULT_FILE_PANEL_WIDTH_PX = 200;
const DEFAULT_TOC_PANEL_WIDTH_PX = 220;
const FILE_PANEL_WIDTH_MIN_PX = 160;
const FILE_PANEL_WIDTH_MAX_PX = 480;
const TOC_PANEL_WIDTH_MIN_PX = 160;
const TOC_PANEL_WIDTH_MAX_PX = 480;

function clampPx(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function sameTocEntries(a: TocEntry[], b: TocEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].level !== b[i].level || a[i].text !== b[i].text) return false;
  }
  return true;
}

export function App() {
  const initialTabId = useMemo(() => newTabId(), []);
  const [tabs, setTabs] = useState<Tab[]>([blankTab(initialTabId)]);
  const [activeTabId, setActiveTabId] = useState(initialTabId);
  const [statusText, setStatusText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [findMatchTotal, setFindMatchTotal] = useState(0);
  const [markdownHtml, setMarkdownHtml] = useState("");
  const [showWelcome, setShowWelcome] = useState(true);
  const [filePanelExpanded, setFilePanelExpanded] = useState(false);
  const [tocPanelExpanded, setTocPanelExpanded] = useState(false);
  const [filePanelWidthPx, setFilePanelWidthPx] = useState(
    DEFAULT_FILE_PANEL_WIDTH_PX,
  );
  const [tocPanelWidthPx, setTocPanelWidthPx] = useState(
    DEFAULT_TOC_PANEL_WIDTH_PX,
  );
  const [filePanelResizeDragActive, setFilePanelResizeDragActive] =
    useState(false);
  const [tocPanelResizeDragActive, setTocPanelResizeDragActive] =
    useState(false);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<DirTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [colorSchemePref, setColorSchemePref] = useState<ColorSchemePreference>(
    () => readStoredColorSchemePreference(),
  );
  const [fontPref, setFontPref] = useState<FontPreference>(() =>
    readStoredFontPreference(),
  );
  const [systemSchemeTick, setSystemSchemeTick] = useState(0);
  const colorSchemePrefRef = useRef(colorSchemePref);
  colorSchemePrefRef.current = colorSchemePref;

  const resolvedColorScheme = useMemo(
    () => getResolvedColorScheme(colorSchemePref),
    [colorSchemePref, systemSchemeTick],
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const findScrollTargetKeyRef = useRef("");
  const markdownBodyHandlesRef = useRef(new Map<string, MarkdownBodyHandle>());
  const editorRootsRef = useRef(new Map<string, HTMLElement>());
  const showWelcomeRef = useRef(showWelcome);
  showWelcomeRef.current = showWelcome;
  const ignoreScrollRef = useRef(false);
  const baseElRef = useRef<HTMLBaseElement | null>(null);
  const skipUnloadPromptRef = useRef(false);
  const saveLockRef = useRef(false);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const tabContentCacheRef = useRef(new Map<string, TabContentCache>());
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const getActiveMarkdownRoot = useCallback((): HTMLElement | null => {
    if (showWelcomeRef.current) return null;
    const id = activeTabIdRef.current;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (tab?.editing) return editorRootsRef.current.get(id) ?? null;
    return markdownBodyHandlesRef.current.get(id)?.getRoot() ?? null;
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeEditing = Boolean(activeTab?.document && activeTab.editing);
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activeTab?.path ?? null;

  const setBaseHref = useCallback((dirUrl: string) => {
    if (!baseElRef.current) {
      const el = document.createElement("base");
      document.head.prepend(el);
      baseElRef.current = el;
    }
    baseElRef.current.href = dirUrl;
  }, []);

  const clearBaseHref = useCallback(() => {
    baseElRef.current?.remove();
    baseElRef.current = null;
  }, []);

  const getActiveTab = useCallback((): Tab | undefined => {
    return tabsRef.current.find((t) => t.id === activeTabIdRef.current);
  }, []);

  const onDiagramError = useCallback(() => {
    const p = activePathRef.current;
    if (p) setStatusText(`${p} (diagram error)`);
  }, []);

  const cycleColorScheme = useCallback(() => {
    setColorSchemePref((p) => {
      const next: ColorSchemePreference =
        p === "system" ? "light" : p === "light" ? "dark" : "system";
      writeStoredColorSchemePreference(next);
      return next;
    });
  }, []);

  const toggleFont = useCallback(() => {
    setFontPref((p) => {
      const next: FontPreference = p === "sans" ? "serif" : "sans";
      writeStoredFontPreference(next);
      return next;
    });
  }, []);

  const loadPath = useCallback(
    async (filePath: string, options?: { fragment?: string }) => {
      const loadingTabId = activeTabIdRef.current;
      const tab = tabsRef.current.find((x) => x.id === loadingTabId);
      if (!tab) return;

      if (activeTabIdRef.current === loadingTabId) {
        setStatusText("Loading…");
      }
      const result = await window.markedly.readFile(filePath);
      if (!result.ok) {
        tabContentCacheRef.current.delete(loadingTabId);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === loadingTabId
              ? {
                  ...t,
                  path: null,
                  stale: false,
                  dirty: false,
                  document: false,
                  editing: false,
                }
              : t,
          ),
        );
        if (activeTabIdRef.current === loadingTabId) {
          setStatusText(result.error);
          setShowWelcome(true);
          setMarkdownHtml("");
          clearBaseHref();
          ignoreScrollRef.current = false;
        }
        return;
      }

      const split = splitFrontmatter(result.content);
      const metadataHtml =
        split.metadata && Object.keys(split.metadata).length > 0
          ? buildMetadataTableHtml(split.metadata, formatMetadataCell)
          : "";
      const previous = tabContentCacheRef.current.get(loadingTabId);
      tabContentCacheRef.current.set(loadingTabId, {
        body: split.body,
        savedBody: split.body,
        frontmatterRaw: split.frontmatterRaw,
        metadataHtml,
        html: buildPreviewHtml(metadataHtml, split.body),
        dirUrl: result.dirUrl,
        path: result.path,
        generation: (previous?.generation ?? 0) + 1,
        hydrated: false,
      });

      ignoreScrollRef.current = true;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === loadingTabId
            ? {
                ...t,
                path: result.path,
                stale: false,
                dirty: false,
                document: true,
                editing: false,
              }
            : t,
        ),
      );

      if (activeTabIdRef.current !== loadingTabId) {
        ignoreScrollRef.current = false;
        return;
      }

      setBaseHref(result.dirUrl);
      setMarkdownHtml(buildPreviewHtml(metadataHtml, split.body));
      setShowWelcome(false);
      setStatusText(result.path);

      const frag = options?.fragment;
      const scrollTopForTab = tab.scrollTop;
      requestAnimationFrame(() => {
        const root = getActiveMarkdownRoot();
        if (frag && root) {
          scrollMarkdownToFragment(frag, root);
        } else if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollTopForTab;
        }
        requestAnimationFrame(() => {
          ignoreScrollRef.current = false;
        });
      });
    },
    [clearBaseHref, getActiveMarkdownRoot, setBaseHref],
  );

  const applyActiveTabToView = useCallback(async () => {
    const t = getActiveTab();
    if (!t) return;
    const cached = tabContentCacheRef.current.get(t.id);
    const showCached = () => {
      ignoreScrollRef.current = true;
      if (cached?.dirUrl) setBaseHref(cached.dirUrl);
      else clearBaseHref();
      setMarkdownHtml(cached?.html ?? "");
      setShowWelcome(false);
      setStatusText(
        t.stale && t.path
          ? `${t.path} changed on disk. Save will overwrite it.`
          : t.path || "Untitled",
      );
      const scrollTopForTab = t.scrollTop;
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollTopForTab;
        }
        requestAnimationFrame(() => {
          ignoreScrollRef.current = false;
        });
      });
    };
    if (!t.document || !cached) {
      ignoreScrollRef.current = true;
      setStatusText("");
      setShowWelcome(true);
      setMarkdownHtml("");
      clearBaseHref();
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = t.scrollTop;
        }
        requestAnimationFrame(() => {
          ignoreScrollRef.current = false;
        });
      });
      return;
    }
    if (t.path && !t.dirty && (t.stale || cached.path !== t.path)) {
      await loadPath(t.path);
      return;
    }
    showCached();
  }, [clearBaseHref, getActiveTab, loadPath, setBaseHref]);

  const openFilePathSmart = useCallback(
    async (filePath: string, options?: { fragment?: string }) => {
      const fragment = options?.fragment;
      const normalized = await window.markedly.normalizeMarkdownPath(filePath);
      if (!normalized) {
        const active = getActiveTab();
        if (active?.document) {
          const fromId = activeTabIdRef.current;
          const sc = scrollContainerRef.current?.scrollTop ?? 0;
          const id = newTabId();
          ignoreScrollRef.current = true;
          flushSync(() => {
            setTabs((prev) =>
              prev
                .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
                .concat([blankTab(id)]),
            );
            setActiveTabId(id);
          });
          await loadPath(filePath, fragment ? { fragment } : undefined);
        } else {
          await loadPath(filePath, options);
        }
        return;
      }

      const existing = tabsRef.current.find((x) => x.path === normalized);
      if (existing) {
        if (existing.id === activeTabIdRef.current) {
          if (fragment) {
            requestAnimationFrame(() => {
              const root = getActiveMarkdownRoot();
              if (root) scrollMarkdownToFragment(fragment, root);
            });
          }
          return;
        }
        const fromId = activeTabIdRef.current;
        const sc = scrollContainerRef.current?.scrollTop ?? 0;
        ignoreScrollRef.current = true;
        flushSync(() => {
          setTabs((prev) =>
            prev.map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t)),
          );
          setActiveTabId(existing.id);
        });
        await applyActiveTabToView();
        if (fragment) {
          requestAnimationFrame(() => {
            const root = getActiveMarkdownRoot();
            if (root) scrollMarkdownToFragment(fragment, root);
          });
        }
        return;
      }

      const active = getActiveTab();
      if (active?.document) {
        const fromId = activeTabIdRef.current;
        const sc = scrollContainerRef.current?.scrollTop ?? 0;
        const id = newTabId();
        ignoreScrollRef.current = true;
        flushSync(() => {
          setTabs((prev) =>
            prev
              .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
              .concat([blankTab(id)]),
          );
          setActiveTabId(id);
        });
        await loadPath(normalized, fragment ? { fragment } : undefined);
      } else {
        await loadPath(normalized, options);
      }
    },
    [applyActiveTabToView, getActiveMarkdownRoot, getActiveTab, loadPath],
  );

  const openPathInNewTab = useCallback(
    async (filePath: string, fragment?: string) => {
      const fromId = activeTabIdRef.current;
      const sc = scrollContainerRef.current?.scrollTop ?? 0;
      const id = newTabId();
      ignoreScrollRef.current = true;
      flushSync(() => {
        setTabs((prev) =>
          prev
            .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
            .concat([blankTab(id)]),
        );
        setActiveTabId(id);
      });
      await loadPath(filePath, fragment ? { fragment } : undefined);
    },
    [loadPath],
  );

  const refreshFileTree = useCallback(async (folderPath: string) => {
    setTreeLoading(true);
    setTreeError(null);
    const res = await window.markedly.listMarkdownTree(folderPath);
    setTreeLoading(false);
    if (!res.ok) {
      setTreeError(res.error);
      setTreeNodes([]);
      setStatusText(res.error);
      return;
    }
    setRootFolderPath(res.root);
    setTreeNodes(res.tree);
  }, []);

  const pickFolderForFileTree = useCallback(async () => {
    const p = await window.markedly.openFolderDialog();
    if (!p) return;
    await refreshFileTree(p);
  }, [refreshFileTree]);

  const refreshFileTreeFromState = useCallback(async () => {
    if (!rootFolderPath) return;
    await refreshFileTree(rootFolderPath);
  }, [rootFolderPath, refreshFileTree]);

  const openMarkdownFromTree = useCallback(
    (filePath: string) => {
      void openFilePathSmart(filePath);
    },
    [openFilePathSmart],
  );

  const addTab = useCallback(() => {
    const fromId = activeTabIdRef.current;
    const sc = scrollContainerRef.current?.scrollTop ?? 0;
    const id = newTabId();
    ignoreScrollRef.current = true;
    flushSync(() => {
      setTabs((prev) =>
        prev
          .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
          .concat([blankTab(id)]),
      );
      setActiveTabId(id);
    });
    void applyActiveTabToView();
  }, [applyActiveTabToView]);

  const activateTab = useCallback(
    (tabId: string) => {
      if (!tabsRef.current.some((t) => t.id === tabId)) return;
      const fromId = activeTabIdRef.current;
      const sc = scrollContainerRef.current?.scrollTop ?? 0;
      ignoreScrollRef.current = true;
      flushSync(() => {
        setTabs((prev) =>
          prev.map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t)),
        );
        setActiveTabId(tabId);
      });
      void applyActiveTabToView();
    },
    [applyActiveTabToView],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const prev = tabsRef.current;
      const closing = prev.find((t) => t.id === tabId);
      if (!closing) return;
      if (closing.dirty) {
        const discard = window.confirm(
          `Discard unsaved changes to "${documentName(closing)}"?`,
        );
        if (!discard) return;
      }
      if (prev.length <= 1) {
        skipUnloadPromptRef.current = true;
        window.close();
        return;
      }
      const idx = prev.findIndex((t) => t.id === tabId);
      tabContentCacheRef.current.delete(tabId);
      const closingActive = activeTabIdRef.current === tabId;
      const newTabs = prev.filter((t) => t.id !== tabId);
      if (!closingActive) {
        setTabs(newTabs);
        return;
      }
      const nextId = newTabs[Math.max(0, idx - 1)]!.id;
      flushSync(() => {
        setTabs(newTabs);
        setActiveTabId(nextId);
      });
      void applyActiveTabToView();
    },
    [applyActiveTabToView],
  );

  const reorderTabsByIds = useCallback((orderedIds: string[]) => {
    setTabs((prev) => {
      if (orderedIds.length !== prev.length) return prev;
      const byId = new Map(prev.map((t) => [t.id, t]));
      const next: Tab[] = [];
      for (const id of orderedIds) {
        const t = byId.get(id);
        if (!t) return prev;
        next.push(t);
      }
      return next;
    });
  }, []);

  const closeActiveTabOrWindow = useCallback(() => {
    closeTab(activeTabIdRef.current);
  }, [closeTab]);

  const handleEditorOutline = useCallback(
    (tabId: string, entries: TocEntry[]) => {
      if (activeTabIdRef.current !== tabId) return;
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab?.editing) return;
      setTocEntries((prev) => (sameTocEntries(prev, entries) ? prev : entries));
    },
    [],
  );

  const handleEditorMarkdown = useCallback((tabId: string, markdown: string) => {
    const cache = tabContentCacheRef.current.get(tabId);
    if (!cache) return;
    cache.body = markdown;
    if (!cache.hydrated) {
      cache.savedBody = markdown;
      cache.hydrated = true;
      return;
    }
    const dirty = markdown !== cache.savedBody;
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || tab.dirty === dirty) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, dirty } : t)),
    );
  }, []);

  const saveActiveTab = useCallback(
    async (saveAs: boolean): Promise<boolean> => {
      if (saveLockRef.current) return false;
      const tab = getActiveTab();
      if (!tab?.document) return false;
      const cache = tabContentCacheRef.current.get(tab.id);
      if (!cache) return false;
      if (!saveAs && tab.path && !tab.dirty) return true;

      saveLockRef.current = true;
      try {
        let target = saveAs ? null : tab.path;
        if (!target) {
          const suggested = tab.path ?? "Untitled.md";
          const picked = await window.markedly.saveDialog(suggested);
          if (!picked) return false;
          target = picked;
        }
        const content = composeMarkdown(cache.frontmatterRaw, cache.body);
        const result = await window.markedly.writeFile(target, content);
        if (!result.ok) {
          setStatusText(result.error);
          return false;
        }
        cache.savedBody = cache.body;
        cache.html = buildPreviewHtml(cache.metadataHtml, cache.body);
        cache.path = result.path;
        cache.dirUrl = result.dirUrl;
        cache.hydrated = true;
        if (activeTabIdRef.current === tab.id) {
          setBaseHref(result.dirUrl);
          setMarkdownHtml(cache.html);
          setStatusText(result.path);
          setShowWelcome(false);
        }
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  path: result.path,
                  dirty: false,
                  stale: false,
                  document: true,
                }
              : t,
          ),
        );
        return true;
      } finally {
        saveLockRef.current = false;
      }
    },
    [getActiveTab, setBaseHref],
  );

  const beginEditing = useCallback(() => {
    const tab = getActiveTab();
    if (!tab?.document || tab.editing) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, editing: true } : t)),
    );
  }, [getActiveTab]);

  const finishEditing = useCallback(async () => {
    const tab = getActiveTab();
    if (!tab?.document || !tab.editing) return;
    const saved = await saveActiveTab(false);
    if (!saved) return;
    const cache = tabContentCacheRef.current.get(tab.id);
    if (cache && activeTabIdRef.current === tab.id) {
      setMarkdownHtml(cache.html);
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, editing: false } : t)),
    );
  }, [getActiveTab, saveActiveTab]);

  const newDocument = useCallback(() => {
    const active = getActiveTab();
    if (active && !active.document) {
      tabContentCacheRef.current.set(active.id, emptyDocumentCache());
      setTabs((prev) =>
        prev.map((t) =>
          t.id === active.id
            ? {
                ...t,
                path: null,
                dirty: false,
                stale: false,
                document: true,
                editing: true,
              }
            : t,
        ),
      );
      setShowWelcome(false);
      setMarkdownHtml("");
      clearBaseHref();
      setStatusText("Untitled");
      return;
    }
    const fromId = activeTabIdRef.current;
    const sc = scrollContainerRef.current?.scrollTop ?? 0;
    const id = newTabId();
    tabContentCacheRef.current.set(id, emptyDocumentCache());
    ignoreScrollRef.current = true;
    flushSync(() => {
      setTabs((prev) =>
        prev
          .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
          .concat([{ ...blankTab(id), document: true, editing: true }]),
      );
      setActiveTabId(id);
    });
    setShowWelcome(false);
    setMarkdownHtml("");
    clearBaseHref();
    setStatusText("Untitled");
  }, [clearBaseHref, getActiveTab]);

  const handleMarkdownLinkClick = useCallback(
    async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const a = target.closest("a");
      const root = getActiveMarkdownRoot();
      if (!a || !root?.contains(a)) return;
      const hrefAttr = a.getAttribute("href");
      if (hrefAttr == null || hrefAttr === "") return;

      const baseFile = activePathRef.current;
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
          setStatusText(`Could not open link: ${hrefAttr}`);
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
        scrollMarkdownToFragment(resolved.fragment, root);
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
    },
    [getActiveMarkdownRoot, openFilePathSmart],
  );

  useLayoutEffect(() => {
    injectHighlighterTheme();
    applyColorSchemeToDocument(colorSchemePref);
    syncHighlighterColorScheme(colorSchemePref);
  }, [colorSchemePref, systemSchemeTick]);

  useLayoutEffect(() => {
    applyFontPreferenceToDocument(fontPref);
  }, [fontPref]);

  useEffect(() => {
    void window.markedly.setNativeColorScheme(colorSchemePref);
  }, [colorSchemePref]);

  useEffect(() => {
    if (colorSchemePref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemSchemeTick((n) => n + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [colorSchemePref]);

  useEffect(() => {
    if (navigator.userAgent.toLowerCase().includes("mac")) {
      document.body.classList.add("platform-mac");
    }
  }, []);

  const hasOpenDocument = tabs.some((t) => t.document);
  useEffect(() => {
    void window.markedly.setHasOpenDocument(hasOpenDocument);
  }, [hasOpenDocument]);

  useEffect(() => {
    if (showWelcome) {
      setSearchQuery("");
      findScrollTargetKeyRef.current = "";
      setFindMatchTotal(0);
      setSearchMatchIndex(0);
    }
  }, [showWelcome]);

  useEffect(() => {
    setSearchMatchIndex(0);
  }, [activeTabId, markdownHtml]);

  useEffect(() => {
    const t = tabs.find((x) => x.id === activeTabId);
    if (t?.document) {
      document.title = `${tabLabel(t)} — Markedly`;
    } else {
      document.title = "Markedly";
    }
  }, [tabs, activeTabId]);

  useEffect(() => {
    if (showWelcome || activeEditing) return;
    const root = getActiveMarkdownRoot();
    if (!root) return;
    const handler = (e: MouseEvent) => {
      void handleMarkdownLinkClick(e);
    };
    root.addEventListener("click", handler, true);
    return () => root.removeEventListener("click", handler, true);
  }, [
    activeTabId,
    getActiveMarkdownRoot,
    activeEditing,
    handleMarkdownLinkClick,
    markdownHtml,
    showWelcome,
  ]);

  useEffect(() => {
    const unsubs = [
      window.markedly.onOpenPath((p) => void openFilePathSmart(p)),
      window.markedly.onOpenPathNewTab((p) => void openPathInNewTab(p)),
      window.markedly.onFileChanged((p) => {
        for (const t of tabsRef.current) {
          if (t.path !== p) continue;
          if (t.dirty) {
            setTabs((prev) =>
              prev.map((x) => (x.id === t.id ? { ...x, stale: true } : x)),
            );
            if (t.id === activeTabIdRef.current) {
              setStatusText(`${p} changed on disk. Save will overwrite it.`);
            }
            continue;
          }
          if (t.id === activeTabIdRef.current) void loadPath(p);
          else {
            tabContentCacheRef.current.delete(t.id);
            setTabs((prev) =>
              prev.map((x) => (x.id === t.id ? { ...x, stale: true } : x)),
            );
          }
        }
      }),
      window.markedly.onThemeChanged(() => {
        if (colorSchemePrefRef.current === "system") {
          setSystemSchemeTick((n) => n + 1);
        }
      }),
      window.markedly.onNewTab(() => {
        if (!tabsRef.current.some((t) => t.document)) return;
        addTab();
      }),
      window.markedly.onCloseTab(() => closeActiveTabOrWindow()),
      window.markedly.onRequestOpenFolder(() => {
        void pickFolderForFileTree();
      }),
      window.markedly.onFind(() => {
        if (showWelcomeRef.current) return;
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      }),
      window.markedly.onSave(() => {
        void saveActiveTab(false);
      }),
      window.markedly.onSaveAs(() => {
        void saveActiveTab(true);
      }),
      window.markedly.onNewDocument(() => {
        newDocument();
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [
    addTab,
    closeActiveTabOrWindow,
    loadPath,
    newDocument,
    openFilePathSmart,
    openPathInNewTab,
    pickFolderForFileTree,
    saveActiveTab,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const findHotkey =
        (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === "f";
      if (!findHotkey) return;
      if (showWelcomeRef.current) return;
      e.preventDefault();
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void saveActiveTab(e.shiftKey);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [saveActiveTab]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (skipUnloadPromptRef.current) return;
      if (!tabsRef.current.some((t) => t.dirty)) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const candidates = pathsFromDataTransfer(e.dataTransfer);
      const mdPaths = candidates.filter((path) =>
        /\.(md|markdown|mdown|mkd)$/i.test(path),
      );
      if (mdPaths.length === 0) {
        if (candidates.length > 0) {
          setStatusText("Drop a Markdown file (.md, .markdown, …)");
        }
        return;
      }
      const seen = new Set<string>();
      const unique = mdPaths.filter((path) => {
        if (seen.has(path)) return false;
        seen.add(path);
        return true;
      });
      void (async () => {
        for (const path of unique) {
          await openFilePathSmart(path);
        }
      })();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFilePathSmart]);

  useEffect(() => {
    const sc = scrollContainerRef.current;
    if (!sc) return;
    const onScroll = () => {
      if (ignoreScrollRef.current) return;
      const t = getActiveTab();
      if (!t) return;
      setTabs((prev) =>
        prev.map((x) =>
          x.id === t.id ? { ...x, scrollTop: sc.scrollTop } : x,
        ),
      );
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => sc.removeEventListener("scroll", onScroll);
  }, [getActiveTab, activeTabId]);

  const tabStripTabs = useMemo(
    () =>
      tabs.map((t) => ({
        id: t.id,
        label: tabLabel(t),
      })),
    [tabs],
  );

  const onOpenDialog = useCallback(() => {
    void window.markedly.openDialog().then((p) => {
      if (p) void openFilePathSmart(p);
    });
  }, [openFilePathSmart]);

  const toggleFilePanel = useCallback(() => {
    setFilePanelExpanded((v) => !v);
  }, []);

  const toggleTocPanel = useCallback(() => {
    setTocPanelExpanded((v) => !v);
  }, []);

  const onFilePanelResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      flushSync(() => {
        setFilePanelResizeDragActive(true);
      });
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = filePanelWidthPx;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        setFilePanelWidthPx(
          clampPx(
            startW + dx,
            FILE_PANEL_WIDTH_MIN_PX,
            FILE_PANEL_WIDTH_MAX_PX,
          ),
        );
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        setFilePanelResizeDragActive(false);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [filePanelWidthPx],
  );

  const onTocPanelResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      flushSync(() => {
        setTocPanelResizeDragActive(true);
      });
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = tocPanelWidthPx;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        setTocPanelWidthPx(
          clampPx(startW - dx, TOC_PANEL_WIDTH_MIN_PX, TOC_PANEL_WIDTH_MAX_PX),
        );
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        setTocPanelResizeDragActive(false);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [tocPanelWidthPx],
  );

  useLayoutEffect(() => {
    if (showWelcome) {
      setTocEntries([]);
      return;
    }
    if (activeEditing) return;
    if (!markdownHtml.trim()) {
      setTocEntries([]);
      return;
    }
    const root = getActiveMarkdownRoot();
    if (!root) {
      setTocEntries([]);
      return;
    }
    const headings = getMarkdownHeadingElements(root);
    setTocEntries(
      headings.map((node) => ({
        level: Number.parseInt(node.tagName.slice(1), 10),
        text: node.textContent?.trim() ?? "",
      })),
    );
  }, [
    activeEditing,
    activeTabId,
    getActiveMarkdownRoot,
    markdownHtml,
    showWelcome,
  ]);

  const activateTocEntry = useCallback(
    (index: number) => {
      const root = getActiveMarkdownRoot();
      const scrollParent = scrollContainerRef.current;
      if (!root || !scrollParent) return;
      const headings = getMarkdownHeadingElements(root);
      const el = headings[index];
      if (!el) return;
      scrollElementIntoScrollParent(el, scrollParent, {
        behavior: "smooth",
        marginTop: 8,
      });
    },
    [getActiveMarkdownRoot],
  );

  const bumpSearchMatch = useCallback(
    (delta: number) => {
      if (showWelcome) return;
      const root = getActiveMarkdownRoot();
      if (!root) return;
      const ranges = collectFindRanges(root, searchQuery);
      if (ranges.length === 0) return;
      setSearchMatchIndex((i) => {
        const n = ranges.length;
        return (((i + delta) % n) + n) % n;
      });
    },
    [getActiveMarkdownRoot, searchQuery, showWelcome],
  );

  useLayoutEffect(() => {
    const sc = scrollContainerRef.current;
    const root = getActiveMarkdownRoot();
    if (showWelcome || activeEditing || !root || !sc) {
      clearFindHighlights();
      setFindMatchTotal(0);
      return () => {
        clearFindHighlights();
      };
    }
    const ranges = collectFindRanges(root, searchQuery);
    if (ranges.length === 0) {
      clearFindHighlights();
      setFindMatchTotal(0);
      if (searchMatchIndex !== 0) {
        setSearchMatchIndex(0);
      }
      findScrollTargetKeyRef.current = "";
      return () => {
        clearFindHighlights();
      };
    }

    const safeIdx = Math.min(searchMatchIndex, ranges.length - 1);
    if (safeIdx !== searchMatchIndex) {
      setSearchMatchIndex(safeIdx);
    }

    applyFindHighlights(ranges, safeIdx);
    setFindMatchTotal(ranges.length);

    const hp = fingerprintString(markdownHtml);
    const scrollKey = `${activeTabId}\0${searchQuery}\0${markdownHtml.length}\0${hp}\0${safeIdx}\0${resolvedColorScheme}`;
    if (scrollKey !== findScrollTargetKeyRef.current) {
      findScrollTargetKeyRef.current = scrollKey;
      scrollRangeIntoView(ranges[safeIdx]!, sc);
    }

    return () => {
      clearFindHighlights();
    };
  }, [
    activeEditing,
    activeTabId,
    getActiveMarkdownRoot,
    markdownHtml,
    resolvedColorScheme,
    searchMatchIndex,
    searchQuery,
    showWelcome,
  ]);

  return (
    <>
      <header className={appStyles.titlebar}>
        <div className={appStyles.titlebarRow}>
          <div className={appStyles.titlebarCluster}>
            <Tooltip
              content={filePanelExpanded ? "Hide file tree" : "Show file tree"}
            >
              <button
                type="button"
                className={appStyles.titlebarIconButton}
                onClick={toggleFilePanel}
                aria-label={
                  filePanelExpanded ? "Hide file tree" : "Show file tree"
                }
                aria-expanded={filePanelExpanded}
                aria-controls="file-tree-panel"
              >
                <SidebarLeftIcon width={16} height={16} aria-hidden />
              </button>
            </Tooltip>
            <div
              className={
                showWelcome
                  ? `${appStyles.titlebarSearch} ${appStyles.titlebarSearchWelcomeOnly}`
                  : appStyles.titlebarSearch
              }
            >
              {showWelcome ? (
                <Tooltip content="Open a document to search">
                  <span
                    className={appStyles.titlebarSearchIconOnly}
                    role="img"
                    aria-label="Find: open a document to search"
                  >
                    <Search
                      width={16}
                      height={16}
                      strokeWidth={2}
                      className={appStyles.titlebarSearchIcon}
                      aria-hidden
                    />
                  </span>
                </Tooltip>
              ) : (
                <div className={appStyles.titlebarSearchRow}>
                  <div className={appStyles.titlebarSearchField} role="search">
                    <span
                      className={appStyles.titlebarSearchInputLeading}
                      aria-hidden
                    >
                      <Search
                        width={16}
                        height={16}
                        strokeWidth={2}
                        className={appStyles.titlebarSearchInputIcon}
                      />
                    </span>
                    <Tooltip content="Find in document · Enter: next match · Shift+Enter: previous match">
                      <input
                        ref={searchInputRef}
                        type="text"
                        className={appStyles.titlebarSearchInput}
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setSearchMatchIndex(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setSearchQuery("");
                            e.currentTarget.blur();
                            return;
                          }
                          if (e.key === "Enter") {
                            e.preventDefault();
                            bumpSearchMatch(e.shiftKey ? -1 : 1);
                          }
                        }}
                        placeholder="Find…"
                        aria-label="Find in document"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </Tooltip>
                    {searchQuery !== "" ? (
                      <Tooltip content="Clear search">
                        <button
                          type="button"
                          className={appStyles.titlebarSearchClear}
                          aria-label="Clear search"
                          onClick={() => {
                            setSearchQuery("");
                            setSearchMatchIndex(0);
                            searchInputRef.current?.focus();
                          }}
                        >
                          <Xmark
                            width={16}
                            height={16}
                            strokeWidth={2}
                            aria-hidden
                          />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                  {searchQuery.trim() !== "" ? (
                    <span className={appStyles.titlebarSearchMeta} aria-hidden>
                      {findMatchTotal === 0
                        ? "No matches"
                        : `${Math.min(searchMatchIndex, findMatchTotal - 1) + 1} / ${findMatchTotal} matches`}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          <div className={appStyles.titlebarFlexSpacer} aria-hidden />
          <div className={appStyles.titlebarCluster}>
            {activeTab?.document ? (
              <Tooltip content={activeEditing ? "Save and preview" : "Edit"}>
                <button
                  type="button"
                  className={appStyles.titlebarIconButton}
                  onClick={() => {
                    if (activeEditing) void finishEditing();
                    else beginEditing();
                  }}
                  aria-label={activeEditing ? "Save and preview" : "Edit"}
                  aria-pressed={activeEditing}
                >
                  {activeEditing ? (
                    <Check width={16} height={16} strokeWidth={2} aria-hidden />
                  ) : (
                    <EditPencil
                      width={16}
                      height={16}
                      strokeWidth={2}
                      aria-hidden
                    />
                  )}
                </button>
              </Tooltip>
            ) : null}
            <Tooltip content="Toggle font">
              <button
                type="button"
                className={appStyles.titlebarIconButton}
                onClick={toggleFont}
                aria-label={
                  fontPref === "sans"
                    ? "Toggle font. Current: Sans. Click to switch to serif."
                    : "Toggle font. Current: Serif. Click to switch to sans."
                }
              >
                {fontPref === "sans" ? (
                  <TextSansIcon width={16} height={16} aria-hidden />
                ) : (
                  <TextSerifIcon width={16} height={16} aria-hidden />
                )}
              </button>
            </Tooltip>
            <Tooltip content="Toggle theme">
              <button
                type="button"
                className={appStyles.titlebarIconButton}
                onClick={cycleColorScheme}
                aria-label={
                  colorSchemePref === "system"
                    ? "Toggle theme. Current: System. Click to switch to light."
                    : colorSchemePref === "light"
                      ? "Toggle theme. Current: Light. Click to switch to dark."
                      : "Toggle theme. Current: Dark. Click to switch to system."
                }
              >
                {colorSchemePref === "system" ? (
                  <ModernTv
                    width={16}
                    height={16}
                    strokeWidth={2}
                    aria-hidden
                  />
                ) : colorSchemePref === "light" ? (
                  <SunLight
                    width={16}
                    height={16}
                    strokeWidth={2}
                    aria-hidden
                  />
                ) : (
                  <HalfMoon
                    width={16}
                    height={16}
                    strokeWidth={2}
                    aria-hidden
                  />
                )}
              </button>
            </Tooltip>
            <Tooltip
              content={tocPanelExpanded ? "Hide outline" : "Show outline"}
            >
              <button
                type="button"
                className={appStyles.titlebarIconButton}
                onClick={toggleTocPanel}
                aria-label={tocPanelExpanded ? "Hide outline" : "Show outline"}
                aria-expanded={tocPanelExpanded}
                aria-controls="toc-panel"
              >
                <SidebarRightIcon width={16} height={16} aria-hidden />
              </button>
            </Tooltip>
          </div>
        </div>
      </header>

      <div className={appStyles.app}>
        <div className={appStyles.bodyRow}>
          {/* Files side panel */}
          <FileTreePanel
            id="file-tree-panel"
            panelExpanded={filePanelExpanded}
            suppressWidthTransition={filePanelResizeDragActive}
            panelWidthPx={filePanelWidthPx}
            rootFolderPath={rootFolderPath}
            tree={treeNodes}
            treeLoading={treeLoading}
            treeError={treeError}
            onPickFolder={() => {
              void pickFolderForFileTree();
            }}
            onRefresh={() => {
              void refreshFileTreeFromState();
            }}
            onOpenMarkdown={(path) => {
              void openMarkdownFromTree(path);
            }}
          />

          <div
            className={`${appStyles.resizeHandle} ${filePanelExpanded ? "" : appStyles.resizeHandleCollapsed}`}
            role="separator"
            aria-orientation="vertical"
            aria-hidden={!filePanelExpanded}
            aria-label={
              filePanelExpanded ? "Resize file tree panel" : undefined
            }
            onPointerDown={onFilePanelResizePointerDown}
            onDoubleClick={() =>
              setFilePanelWidthPx(DEFAULT_FILE_PANEL_WIDTH_PX)
            }
          />

          {/* Main column */}
          <div
            className={`${appStyles.mainColumn} ${filePanelExpanded ? appStyles.mainColumnLeftHandleOverlap : ""} ${tocPanelExpanded ? appStyles.mainColumnRightHandleOverlap : ""}`}
          >
            {/* Tabs — only once a file or untitled document is open */}
            {tabs.some((t) => t.document) ? (
              <TabStrip
                tabs={tabStripTabs}
                activeTabId={activeTabId}
                onSelect={activateTab}
                onClose={closeTab}
                onReorderTabIds={reorderTabsByIds}
                onNew={addTab}
              />
            ) : null}

            {/* Body */}
            <div className={appStyles.mainColumnStack}>
              <div
                ref={scrollContainerRef}
                className={appStyles.contentWrapper}
              >
                <main
                  id="content"
                  className={`${appStyles.main} ${showWelcome ? appStyles.mainEmpty : ""}`}
                  tabIndex={-1}
                >
                  {showWelcome ? (
                    <Welcome
                      onOpenFile={onOpenDialog}
                      onNewDocument={newDocument}
                      reserveTabStripSpace={!tabs.some((t) => t.document)}
                    />
                  ) : null}
                  {tabs.some((t) => tabContentCacheRef.current.has(t.id)) ? (
                    <div
                      className={`${appStyles.markdownPaneShell} ${showWelcome ? appStyles.markdownPaneShellHiddenWhileWelcome : ""}`}
                    >
                      {tabs.map((t) => {
                        const cached = tabContentCacheRef.current.get(t.id);
                        if (!cached) return null;
                        const isActive = t.id === activeTabId && !showWelcome;
                        return (
                          <div
                            key={t.id}
                            className={
                              isActive
                                ? appStyles.markdownPaneActive
                                : appStyles.markdownPaneInactive
                            }
                          >
                            {t.editing ? (
                              <MarkdownEditor
                                key={`${t.id}:${cached.generation}`}
                                initialMarkdown={cached.body}
                                metadataHtml={cached.metadataHtml}
                                isActive={isActive}
                                onChange={(markdown) => {
                                  handleEditorMarkdown(t.id, markdown);
                                }}
                                onOutline={(entries) => {
                                  handleEditorOutline(t.id, entries);
                                }}
                                onRoot={(el) => {
                                  if (el) editorRootsRef.current.set(t.id, el);
                                  else editorRootsRef.current.delete(t.id);
                                }}
                              />
                            ) : (
                              <MarkdownBody
                                ref={(handle) => {
                                  if (handle) {
                                    markdownBodyHandlesRef.current.set(
                                      t.id,
                                      handle,
                                    );
                                  } else {
                                    markdownBodyHandlesRef.current.delete(
                                      t.id,
                                    );
                                  }
                                }}
                                html={cached.html}
                                isActive={isActive}
                                mermaidLayoutNamespace={t.id}
                                resolvedColorScheme={resolvedColorScheme}
                                onDiagramError={onDiagramError}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </main>
              </div>

              {/* Status bar */}
              {!showWelcome ? (
                <footer className={statusStyles.status} aria-live="polite">
                  {statusText}
                </footer>
              ) : null}
            </div>
          </div>

          <div
            className={`${appStyles.resizeHandle} ${tocPanelExpanded ? "" : appStyles.resizeHandleCollapsed}`}
            role="separator"
            aria-orientation="vertical"
            aria-hidden={!tocPanelExpanded}
            aria-label={tocPanelExpanded ? "Resize outline panel" : undefined}
            onPointerDown={onTocPanelResizePointerDown}
            onDoubleClick={() => setTocPanelWidthPx(DEFAULT_TOC_PANEL_WIDTH_PX)}
          />

          {/* TOC side panel */}
          <TocPanel
            id="toc-panel"
            panelExpanded={tocPanelExpanded}
            suppressWidthTransition={tocPanelResizeDragActive}
            panelWidthPx={tocPanelWidthPx}
            documentOpen={!showWelcome}
            entries={tocEntries}
            onActivateEntry={activateTocEntry}
          />
        </div>
      </div>
    </>
  );
}
