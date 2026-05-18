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
import { formatMetadataCell, splitFrontmatter } from "./frontmatter";
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
import { MarkdownBody, type MarkdownBodyHandle } from "./MarkdownBody";
import statusStyles from "./StatusBar.module.scss";
import SidebarLeftIcon from "../assets/icons/sidebar-left.svg?react";
import SidebarRightIcon from "../assets/icons/sidebar-right.svg?react";
import { HalfMoon, ModernTv, Search, SunLight, Xmark } from "iconoir-react";
import { TabStrip } from "./TabStrip";
import appStyles from "./App.module.scss";
import { Welcome } from "./Welcome";
import type { ColorSchemePreference, DirTreeNode } from "../shared/types.js";
import { FileTreePanel } from "./FileTreePanel";
import { TocPanel, type TocEntry } from "./TocPanel";
import {
  applyColorSchemeToDocument,
  getResolvedColorScheme,
  readStoredColorSchemePreference,
  writeStoredColorSchemePreference,
} from "./color-scheme";

type Tab = {
  id: string;
  path: string | null;
  stale: boolean;
  scrollTop: number;
};

/** Per-tab rendered HTML + `<base href>` dir so switching tabs does not re-fetch or re-parse. */
type TabContentCache = {
  html: string;
  dirUrl: string;
  path: string;
};

function newTabId(): string {
  return crypto.randomUUID();
}

function tabLabel(tab: Tab): string {
  if (!tab.path) return "New tab";
  const parts = tab.path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
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

export function App() {
  const initialTabId = useMemo(() => newTabId(), []);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: initialTabId, path: null, stale: false, scrollTop: 0 },
  ]);
  const [activeTabId, setActiveTabId] = useState(initialTabId);
  const [statusText, setStatusText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [findMatchTotal, setFindMatchTotal] = useState(0);
  const [markdownHtml, setMarkdownHtml] = useState("");
  const [showWelcome, setShowWelcome] = useState(true);
  const [filePanelExpanded, setFilePanelExpanded] = useState(true);
  const [tocPanelExpanded, setTocPanelExpanded] = useState(true);
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
  const showWelcomeRef = useRef(showWelcome);
  showWelcomeRef.current = showWelcome;
  const ignoreScrollRef = useRef(false);
  const baseElRef = useRef<HTMLBaseElement | null>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const tabContentCacheRef = useRef(new Map<string, TabContentCache>());
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const getActiveMarkdownRoot = useCallback((): HTMLElement | null => {
    if (showWelcomeRef.current) return null;
    const id = activeTabIdRef.current;
    return markdownBodyHandlesRef.current.get(id)?.getRoot() ?? null;
  }, []);

  const activePathRef = useRef<string | null>(null);
  activePathRef.current = tabs.find((t) => t.id === activeTabId)?.path ?? null;

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
            t.id === loadingTabId ? { ...t, path: null, stale: false } : t,
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

      const { body, metadata } = splitFrontmatter(result.content);
      const metaHtml =
        metadata && Object.keys(metadata).length > 0
          ? buildMetadataTableHtml(metadata, formatMetadataCell)
          : "";
      const html = metaHtml + parseMarkdown(body);
      tabContentCacheRef.current.set(loadingTabId, {
        html,
        dirUrl: result.dirUrl,
        path: result.path,
      });

      ignoreScrollRef.current = true;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === loadingTabId ? { ...t, path: result.path, stale: false } : t,
        ),
      );

      if (activeTabIdRef.current !== loadingTabId) {
        ignoreScrollRef.current = false;
        return;
      }

      setBaseHref(result.dirUrl);
      setMarkdownHtml(html);
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
    if (!t.path) {
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
    const cached = tabContentCacheRef.current.get(t.id);
    if (cached && cached.path === t.path && !t.stale) {
      ignoreScrollRef.current = true;
      setBaseHref(cached.dirUrl);
      setMarkdownHtml(cached.html);
      setShowWelcome(false);
      setStatusText(cached.path);
      const scrollTopForTab = t.scrollTop;
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollTopForTab;
        }
        requestAnimationFrame(() => {
          ignoreScrollRef.current = false;
        });
      });
      return;
    }
    await loadPath(t.path);
  }, [clearBaseHref, getActiveTab, loadPath, setBaseHref]);

  const openFilePathSmart = useCallback(
    async (filePath: string, options?: { fragment?: string }) => {
      const fragment = options?.fragment;
      const normalized = await window.markedly.normalizeMarkdownPath(filePath);
      if (!normalized) {
        const active = getActiveTab();
        if (active?.path) {
          const fromId = activeTabIdRef.current;
          const sc = scrollContainerRef.current?.scrollTop ?? 0;
          const id = newTabId();
          ignoreScrollRef.current = true;
          flushSync(() => {
            setTabs((prev) =>
              prev
                .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
                .concat([{ id, path: null, stale: false, scrollTop: 0 }]),
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
      if (active?.path) {
        const fromId = activeTabIdRef.current;
        const sc = scrollContainerRef.current?.scrollTop ?? 0;
        const id = newTabId();
        ignoreScrollRef.current = true;
        flushSync(() => {
          setTabs((prev) =>
            prev
              .map((t) => (t.id === fromId ? { ...t, scrollTop: sc } : t))
              .concat([{ id, path: null, stale: false, scrollTop: 0 }]),
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
            .concat([{ id, path: null, stale: false, scrollTop: 0 }]),
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
          .concat([{ id, path: null, stale: false, scrollTop: 0 }]),
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
      if (prev.length <= 1) {
        window.close();
        return;
      }
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx < 0) return;
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
  }, [colorSchemePref]);

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
    if (t?.path) {
      document.title = `${tabLabel(t)} — Markedly`;
    } else {
      document.title = "Markedly";
    }
  }, [tabs, activeTabId]);

  useEffect(() => {
    const root = getActiveMarkdownRoot();
    if (!root || showWelcome) return;
    const handler = (e: MouseEvent) => {
      void handleMarkdownLinkClick(e);
    };
    root.addEventListener("click", handler, true);
    return () => root.removeEventListener("click", handler, true);
  }, [
    activeTabId,
    getActiveMarkdownRoot,
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
        const path = activePathRef.current;
        if (path) void loadPath(path);
      }),
      window.markedly.onNewTab(() => addTab()),
      window.markedly.onCloseTab(() => closeActiveTabOrWindow()),
      window.markedly.onRequestOpenFolder(() => {
        void pickFolderForFileTree();
      }),
      window.markedly.onFind(() => {
        if (showWelcomeRef.current) return;
        const root = getActiveMarkdownRoot();
        if (!root) return;
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [
    addTab,
    closeActiveTabOrWindow,
    getActiveMarkdownRoot,
    loadPath,
    openFilePathSmart,
    openPathInNewTab,
    pickFolderForFileTree,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const findHotkey =
        (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === "f";
      if (!findHotkey) return;
      if (showWelcomeRef.current) return;
      const root = getActiveMarkdownRoot();
      if (!root) return;
      e.preventDefault();
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [getActiveMarkdownRoot]);

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
    if (showWelcome || !markdownHtml.trim()) {
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
  }, [activeTabId, getActiveMarkdownRoot, markdownHtml, showWelcome]);

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
    if (showWelcome || !root || !sc) {
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
            <button
              type="button"
              className={appStyles.titlebarIconButton}
              onClick={toggleFilePanel}
              title={filePanelExpanded ? "Hide file tree" : "Show file tree"}
              aria-expanded={filePanelExpanded}
              aria-controls="file-tree-panel"
            >
              <SidebarLeftIcon width={16} height={16} aria-hidden />
            </button>
            <div
              className={
                showWelcome
                  ? `${appStyles.titlebarSearch} ${appStyles.titlebarSearchWelcomeOnly}`
                  : appStyles.titlebarSearch
              }
            >
              {showWelcome ? (
                <span
                  className={appStyles.titlebarSearchIconOnly}
                  role="img"
                  aria-label="Find: open a document to search"
                  title="Open a document to search"
                >
                  <Search
                    width={16}
                    height={16}
                    strokeWidth={2}
                    className={appStyles.titlebarSearchIcon}
                    aria-hidden
                  />
                </span>
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
                      title="Find in document · Enter: next match · Shift+Enter: previous match"
                      aria-label="Find in document"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    {searchQuery !== "" ? (
                      <button
                        type="button"
                        className={appStyles.titlebarSearchClear}
                        aria-label="Clear search"
                        title="Clear search"
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
            <button
              type="button"
              className={appStyles.titlebarIconButton}
              onClick={cycleColorScheme}
              title={
                colorSchemePref === "system"
                  ? "Appearance: System (follows OS). Click to use light."
                  : colorSchemePref === "light"
                    ? "Appearance: Light. Click to use dark."
                    : "Appearance: Dark. Click to follow system."
              }
              aria-label={
                colorSchemePref === "system"
                  ? "Color scheme: system. Activate to switch to light."
                  : colorSchemePref === "light"
                    ? "Color scheme: light. Activate to switch to dark."
                    : "Color scheme: dark. Activate to switch to system."
              }
            >
              {colorSchemePref === "system" ? (
                <ModernTv width={16} height={16} strokeWidth={2} aria-hidden />
              ) : colorSchemePref === "light" ? (
                <SunLight width={16} height={16} strokeWidth={2} aria-hidden />
              ) : (
                <HalfMoon width={16} height={16} strokeWidth={2} aria-hidden />
              )}
            </button>
            <button
              type="button"
              className={appStyles.titlebarIconButton}
              onClick={toggleTocPanel}
              title={tocPanelExpanded ? "Hide outline" : "Show outline"}
              aria-expanded={tocPanelExpanded}
              aria-controls="toc-panel"
            >
              <SidebarRightIcon width={16} height={16} aria-hidden />
            </button>
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
            {/* Tabs */}
            <TabStrip
              tabs={tabStripTabs}
              activeTabId={activeTabId}
              onSelect={activateTab}
              onClose={closeTab}
              onReorderTabIds={reorderTabsByIds}
              onNew={addTab}
            />

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
                  {showWelcome ? <Welcome onOpenFile={onOpenDialog} /> : null}
                  {tabs.some((t) => {
                    const c = tabContentCacheRef.current.get(t.id);
                    return Boolean(t.path && c && c.path === t.path);
                  }) ? (
                    <div
                      className={`${appStyles.markdownPaneShell} ${showWelcome ? appStyles.markdownPaneShellHiddenWhileWelcome : ""}`}
                    >
                      {tabs.map((t) => {
                        const cached = tabContentCacheRef.current.get(t.id);
                        if (!t.path || !cached || cached.path !== t.path) {
                          return null;
                        }
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
                            <MarkdownBody
                              ref={(handle) => {
                                if (handle) {
                                  markdownBodyHandlesRef.current.set(
                                    t.id,
                                    handle,
                                  );
                                } else {
                                  markdownBodyHandlesRef.current.delete(t.id);
                                }
                              }}
                              html={cached.html}
                              isActive={isActive}
                              mermaidLayoutNamespace={t.id}
                              resolvedColorScheme={resolvedColorScheme}
                              onDiagramError={onDiagramError}
                            />
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
