import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
} from "./lib/markdown-html";
import { MarkdownBody, type MarkdownBodyHandle } from "./MarkdownBody";
import statusStyles from "./StatusBar.module.scss";
import { SidebarCollapse, SidebarExpand } from "iconoir-react";
import { TabStrip } from "./TabStrip";
import appStyles from "./App.module.scss";
import { Welcome } from "./Welcome";
import type { DirTreeNode } from "../shared/types.js";
import { FileTreePanel } from "./FileTreePanel";
import { TocPanel, type TocEntry } from "./TocPanel";

type Tab = {
  id: string;
  path: string | null;
  stale: boolean;
  scrollTop: number;
};

function newTabId(): string {
  return crypto.randomUUID();
}

function tabLabel(tab: Tab): string {
  if (!tab.path) return "New tab";
  const parts = tab.path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
}

const titlebarIconProps = {
  width: 16,
  height: 16,
  strokeWidth: 2,
} as const;

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
  const [markdownHtml, setMarkdownHtml] = useState("");
  const [showWelcome, setShowWelcome] = useState(true);
  const [filePanelExpanded, setFilePanelExpanded] = useState(true);
  const [tocPanelExpanded, setTocPanelExpanded] = useState(true);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<DirTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const markdownBodyRef = useRef<MarkdownBodyHandle>(null);
  const ignoreScrollRef = useRef(false);
  const baseElRef = useRef<HTMLBaseElement | null>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

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

  const loadPath = useCallback(
    async (filePath: string, options?: { fragment?: string }) => {
      const tab = getActiveTab();
      if (!tab) return;

      setStatusText("Loading…");
      const result = await window.markedly.readFile(filePath);
      if (!result.ok) {
        setStatusText(result.error);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabIdRef.current
              ? { ...t, path: null, stale: false }
              : t,
          ),
        );
        setShowWelcome(true);
        setMarkdownHtml("");
        clearBaseHref();
        ignoreScrollRef.current = false;
        return;
      }

      ignoreScrollRef.current = true;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabIdRef.current
            ? { ...t, path: result.path, stale: false }
            : t,
        ),
      );
      setBaseHref(result.dirUrl);
      const { body, metadata } = splitFrontmatter(result.content);
      const metaHtml =
        metadata && Object.keys(metadata).length > 0
          ? buildMetadataTableHtml(metadata, formatMetadataCell)
          : "";
      const html = metaHtml + parseMarkdown(body);
      setMarkdownHtml(html);
      setShowWelcome(false);
      setStatusText(result.path);

      const frag = options?.fragment;
      const scrollTopForTab = tab.scrollTop;
      requestAnimationFrame(() => {
        const root = markdownBodyRef.current?.getRoot();
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
    [clearBaseHref, getActiveTab, setBaseHref],
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
    await loadPath(t.path);
  }, [clearBaseHref, getActiveTab, loadPath]);

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
              const root = markdownBodyRef.current?.getRoot();
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
            const root = markdownBodyRef.current?.getRoot();
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
    [applyActiveTabToView, getActiveTab, loadPath],
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
    async (filePath: string) => {
      const normalized = await window.markedly.normalizeMarkdownPath(filePath);
      await openPathInNewTab(normalized ?? filePath);
    },
    [openPathInNewTab],
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
      const closingActive = activeTabIdRef.current === tabId;
      const newTabs = prev.filter((t) => t.id !== tabId);
      if (!closingActive) {
        setTabs(newTabs);
        return;
      }
      const nextId = newTabs[Math.max(0, idx - 1)]!.id;
      const nextTab = newTabs.find((t) => t.id === nextId)!;
      flushSync(() => {
        setTabs(newTabs);
        setActiveTabId(nextId);
      });
      if (!nextTab.path) {
        ignoreScrollRef.current = true;
        setStatusText("");
        setShowWelcome(true);
        setMarkdownHtml("");
        clearBaseHref();
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = nextTab.scrollTop;
          }
          requestAnimationFrame(() => {
            ignoreScrollRef.current = false;
          });
        });
      } else {
        void loadPath(nextTab.path);
      }
    },
    [clearBaseHref, loadPath],
  );

  const closeActiveTabOrWindow = useCallback(() => {
    closeTab(activeTabIdRef.current);
  }, [closeTab]);

  const handleMarkdownLinkClick = useCallback(
    async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const a = target.closest("a");
      const root = markdownBodyRef.current?.getRoot();
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
    [openFilePathSmart],
  );

  useEffect(() => {
    injectHighlighterTheme();
  }, []);

  useEffect(() => {
    if (navigator.userAgent.toLowerCase().includes("mac")) {
      document.body.classList.add("platform-mac");
    }
  }, []);

  useEffect(() => {
    const t = tabs.find((x) => x.id === activeTabId);
    if (t?.path) {
      document.title = `${tabLabel(t)} — Markedly`;
    } else {
      document.title = "Markedly";
    }
  }, [tabs, activeTabId]);

  useEffect(() => {
    const root = markdownBodyRef.current?.getRoot();
    if (!root || showWelcome) return;
    const handler = (e: MouseEvent) => {
      void handleMarkdownLinkClick(e);
    };
    root.addEventListener("click", handler, true);
    return () => root.removeEventListener("click", handler, true);
  }, [showWelcome, markdownHtml, handleMarkdownLinkClick]);

  useEffect(() => {
    const unsubs = [
      window.markedly.onOpenPath((p) => void openFilePathSmart(p)),
      window.markedly.onOpenPathNewTab((p) => void openPathInNewTab(p)),
      window.markedly.onFileChanged((p) => {
        for (const t of tabsRef.current) {
          if (t.path !== p) continue;
          if (t.id === activeTabIdRef.current) void loadPath(p);
          else
            setTabs((prev) =>
              prev.map((x) => (x.id === t.id ? { ...x, stale: true } : x)),
            );
        }
      }),
      window.markedly.onThemeChanged(() => {
        const path = activePathRef.current;
        if (path) void loadPath(path);
      }),
      window.markedly.onNewTab(() => addTab()),
      window.markedly.onCloseTab(() => closeActiveTabOrWindow()),
      window.markedly.onRequestOpenFolder(() => {
        void pickFolderForFileTree();
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [
    addTab,
    closeActiveTabOrWindow,
    loadPath,
    openFilePathSmart,
    openPathInNewTab,
    pickFolderForFileTree,
  ]);

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

  useLayoutEffect(() => {
    if (showWelcome || !markdownHtml.trim()) {
      setTocEntries([]);
      return;
    }
    const root = markdownBodyRef.current?.getRoot();
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
  }, [markdownHtml, showWelcome]);

  const activateTocEntry = useCallback((index: number) => {
    const root = markdownBodyRef.current?.getRoot();
    const scrollParent = scrollContainerRef.current;
    if (!root || !scrollParent) return;
    const headings = getMarkdownHeadingElements(root);
    const el = headings[index];
    if (!el) return;
    scrollElementIntoScrollParent(el, scrollParent, {
      behavior: "smooth",
      marginTop: 8,
    });
  }, []);

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
              {filePanelExpanded ? (
                <SidebarCollapse {...titlebarIconProps} />
              ) : (
                <SidebarExpand {...titlebarIconProps} />
              )}
            </button>
          </div>
          <div className={appStyles.titlebarFlexSpacer} aria-hidden />
          <div className={appStyles.titlebarCluster}>
            <button
              type="button"
              className={appStyles.titlebarIconButton}
              onClick={toggleTocPanel}
              title={tocPanelExpanded ? "Hide outline" : "Show outline"}
              aria-expanded={tocPanelExpanded}
              aria-controls="toc-panel"
            >
              {tocPanelExpanded ? (
                <SidebarCollapse {...titlebarIconProps} />
              ) : (
                <SidebarExpand {...titlebarIconProps} />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className={appStyles.app}>
        <div className={appStyles.bodyRow}>
          <FileTreePanel
            id="file-tree-panel"
            panelExpanded={filePanelExpanded}
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
          <div className={appStyles.mainColumn}>
            <TabStrip
              tabs={tabStripTabs}
              activeTabId={activeTabId}
              onSelect={activateTab}
              onClose={closeTab}
              onNew={addTab}
            />
            <div ref={scrollContainerRef} className={appStyles.contentWrapper}>
              <main
                id="content"
                className={`${appStyles.main} ${showWelcome ? appStyles.mainEmpty : ""}`}
                tabIndex={-1}
              >
                {showWelcome ? <Welcome onOpenFile={onOpenDialog} /> : null}
                <MarkdownBody
                  ref={markdownBodyRef}
                  html={markdownHtml}
                  hidden={showWelcome}
                  onDiagramError={onDiagramError}
                />
              </main>
            </div>
            {!showWelcome && (
              <footer className={statusStyles.status} aria-live="polite">
                {statusText}
              </footer>
            )}
          </div>
          <TocPanel
            id="toc-panel"
            panelExpanded={tocPanelExpanded}
            documentOpen={!showWelcome}
            entries={tocEntries}
            onActivateEntry={activateTocEntry}
          />
        </div>
      </div>
    </>
  );
}
