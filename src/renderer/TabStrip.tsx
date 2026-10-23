import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";

import styles from "./TabStrip.module.scss";
import { Tooltip } from "./Tooltip";

export type TabStripTab = {
  id: string;
  label: string;
  /** Basename of a file on disk. Null when this tab cannot be renamed in place. */
  fileName: string | null;
};

type TabStripProps = {
  tabs: TabStripTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorderTabIds: (orderedIds: string[]) => void;
  onNew: () => void;
  onRenameFile: (tabId: string, nextName: string) => Promise<boolean>;
  onRenameUnavailable: (tabId: string) => void;
};

const DRAG_THRESHOLD_PX = 6;
const EDGE_SCROLL_PX = 40;
const EDGE_SCROLL_STEP_PX = 12;
const MARKDOWN_EXTENSIONS = [".markdown", ".mdown", ".mkd", ".md"] as const;

function splitMarkdownFileName(fileName: string): {
  stem: string;
  extension: string;
} {
  const lower = fileName.toLowerCase();
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(ext) && fileName.length > ext.length) {
      const splitAt = fileName.length - ext.length;
      return {
        stem: fileName.slice(0, splitAt),
        extension: fileName.slice(splitAt),
      };
    }
  }
  return { stem: fileName, extension: "" };
}

function placeCaretAtEnd(input: HTMLInputElement) {
  const end = input.value.length;
  input.focus();
  input.setSelectionRange(end, end);
  input.scrollLeft = input.scrollWidth;
}

function reorderIdsAtPointer(
  ids: readonly string[],
  fromIndex: number,
  clientX: number,
  tabElements: HTMLElement[],
): string[] | null {
  const n = ids.length;
  if (n <= 1 || fromIndex < 0 || fromIndex >= n) return null;
  if (tabElements.length !== n) return null;

  const rects = tabElements.map((el) => el.getBoundingClientRect());
  const centers = rects.map((r) => r.left + r.width / 2);

  let slot = 0;
  for (let i = 0; i < n; i++) {
    if (clientX > centers[i]) slot = i + 1;
  }

  let to = slot;
  if (fromIndex < slot) to -= 1;
  if (to < 0) to = 0;
  if (to > n - 1) to = n - 1;
  if (to === fromIndex) return null;

  const next = [...ids];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return null;
  next.splice(to, 0, item);
  return next;
}

function collectTabStripElements(
  scrollEl: HTMLElement,
  orderedIds: readonly string[],
  draggingId: string,
): HTMLElement[] | null {
  const out: HTMLElement[] = [];
  for (const id of orderedIds) {
    const ph = `[data-tab-placeholder="${CSS.escape(id)}"]`;
    const tab = `[data-tab-id="${CSS.escape(id)}"]`;
    const node =
      id === draggingId
        ? (scrollEl.querySelector(ph) ?? scrollEl.querySelector(tab))
        : scrollEl.querySelector(tab);
    if (!(node instanceof HTMLElement)) return null;
    out.push(node);
  }
  return out;
}

type PendingSession = {
  kind: "pending";
  tabId: string;
  fromIndex: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  pointerId: number;
  tabEl: HTMLElement;
};

type DraggingSession = {
  kind: "dragging";
  tabId: string;
  fromIndex: number;
  startClientX: number;
  startScrollLeft: number;
  pointerId: number;
  tabEl: HTMLElement;
  tabWidth: number;
  tabHeight: number;
  grabOffsetX: number;
  grabOffsetY: number;
};

type PointerSession = PendingSession | DraggingSession;

export function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onReorderTabIds,
  onNew,
  onRenameFile,
  onRenameUnavailable,
}: TabStripProps) {
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  const onReorderRef = useRef(onReorderTabIds);
  const onSelectRef = useRef(onSelect);
  const onRenameFileRef = useRef(onRenameFile);
  const onRenameUnavailableRef = useRef(onRenameUnavailable);
  tabsRef.current = tabs;
  onReorderRef.current = onReorderTabIds;
  onSelectRef.current = onSelect;
  onRenameFileRef.current = onRenameFile;
  onRenameUnavailableRef.current = onRenameUnavailable;

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const renamingTabIdRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFinishingRef = useRef(false);
  /** Ignore the blur that can follow opening the field, until the user edits or focus settles. */
  const renameReadyRef = useRef(false);

  const sessionRef = useRef<PointerSession | null>(null);
  const ignoreNextClickRef = useRef(false);
  const previewOrderRef = useRef<string[] | null>(null);

  type DragUi = {
    draggingTabId: string;
    previewOrderIds: string[];
    floatLeft: number;
    floatTop: number;
    floatWidth: number;
    floatHeight: number;
  };

  const [dragUi, setDragUi] = useState<DragUi | null>(null);

  const [horizontalScrollbarVisible, setHorizontalScrollbarVisible] =
    useState(false);

  const clearWindowPointerListeners = useRef<(() => void) | null>(null);

  const endPointerSession = () => {
    clearWindowPointerListeners.current?.();
    clearWindowPointerListeners.current = null;
    sessionRef.current = null;
    previewOrderRef.current = null;
    setDragUi(null);
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    const session = sessionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;

    if (session.kind === "pending") {
      const dx = e.clientX - session.startClientX;
      const dy = e.clientY - session.startClientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        return;
      }
      const r = session.tabEl.getBoundingClientRect();
      const grabOffsetX = e.clientX - r.left;
      const grabOffsetY = e.clientY - r.top;
      const initialOrder = tabsRef.current.map((t) => t.id);
      previewOrderRef.current = initialOrder;
      sessionRef.current = {
        kind: "dragging",
        tabId: session.tabId,
        fromIndex: session.fromIndex,
        startClientX: session.startClientX,
        startScrollLeft: session.startScrollLeft,
        pointerId: session.pointerId,
        tabEl: session.tabEl,
        tabWidth: r.width,
        tabHeight: r.height,
        grabOffsetX,
        grabOffsetY,
      };
      setDragUi({
        draggingTabId: session.tabId,
        previewOrderIds: initialOrder,
        floatLeft: e.clientX - grabOffsetX,
        floatTop: e.clientY - grabOffsetY,
        floatWidth: r.width,
        floatHeight: r.height,
      });
      return;
    }

    const s = sessionRef.current;
    if (!s || s.kind !== "dragging" || e.pointerId !== s.pointerId) return;

    const scrollEl = tabScrollRef.current;
    const floatLeft = e.clientX - s.grabOffsetX;
    const floatTop = e.clientY - s.grabOffsetY;

    if (scrollEl) {
      const r = scrollEl.getBoundingClientRect();
      let nextLeft = scrollEl.scrollLeft;
      if (e.clientX < r.left + EDGE_SCROLL_PX) {
        nextLeft = Math.max(0, nextLeft - EDGE_SCROLL_STEP_PX);
      } else if (e.clientX > r.right - EDGE_SCROLL_PX) {
        nextLeft = Math.min(
          scrollEl.scrollWidth - scrollEl.clientWidth,
          nextLeft + EDGE_SCROLL_STEP_PX,
        );
      }
      if (nextLeft !== scrollEl.scrollLeft) {
        scrollEl.scrollLeft = nextLeft;
      }
    }

    const ids = previewOrderRef.current ?? tabsRef.current.map((t) => t.id);
    const fromIdx = ids.indexOf(s.tabId);
    if (fromIdx < 0 || !scrollEl) {
      setDragUi((prev) =>
        prev
          ? { ...prev, floatLeft, floatTop }
          : prev,
      );
      return;
    }

    const els = collectTabStripElements(scrollEl, ids, s.tabId);
    let nextPreview = ids;
    if (els) {
      const next = reorderIdsAtPointer(ids, fromIdx, e.clientX, els);
      if (next) {
        previewOrderRef.current = next;
        nextPreview = next;
      }
    }

    setDragUi((prev) => {
      if (!prev) return prev;
      const sameOrder =
        prev.previewOrderIds.length === nextPreview.length &&
        prev.previewOrderIds.every((id, i) => id === nextPreview[i]);
      if (sameOrder && prev.floatLeft === floatLeft && prev.floatTop === floatTop) {
        return prev;
      }
      return {
        ...prev,
        previewOrderIds: nextPreview,
        floatLeft,
        floatTop,
      };
    });
  };

  const onWindowPointerUp = (e: PointerEvent) => {
    const session = sessionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;

    if (session.kind === "pending") {
      endPointerSession();
      if (e.type !== "pointercancel") {
        ignoreNextClickRef.current = true;
        onSelectRef.current(session.tabId);
      }
      return;
    }

    const canonicalIds = tabsRef.current.map((t) => t.id);
    const previewSnapshot = previewOrderRef.current;
    const scrollEl = tabScrollRef.current;

    let committed: string[] | null = null;
    if (e.type !== "pointercancel" && previewSnapshot && scrollEl) {
      const fromIdx = previewSnapshot.indexOf(session.tabId);
      const tabElements = collectTabStripElements(
        scrollEl,
        previewSnapshot,
        session.tabId,
      );
      if (fromIdx >= 0 && tabElements) {
        const step = reorderIdsAtPointer(
          previewSnapshot,
          fromIdx,
          e.clientX,
          tabElements,
        );
        committed =
          step ??
          (previewSnapshot.some((id, i) => id !== canonicalIds[i])
            ? previewSnapshot
            : null);
      }
    }

    ignoreNextClickRef.current = true;
    endPointerSession();

    if (
      committed &&
      committed.length === canonicalIds.length &&
      committed.some((id, i) => id !== canonicalIds[i])
    ) {
      onReorderRef.current(committed);
    } else if (
      e.type !== "pointercancel" &&
      previewSnapshot &&
      previewSnapshot.length === canonicalIds.length &&
      previewSnapshot.some((id, i) => id !== canonicalIds[i])
    ) {
      onReorderRef.current(previewSnapshot);
    }
  };

  const onTabPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    tab: TabStripTab,
    index: number,
  ) => {
    if (e.button !== 0 || e.ctrlKey) return;
    if (renamingTabIdRef.current === tab.id) return;
    if (sessionRef.current) {
      endPointerSession();
    }
    sessionRef.current = {
      kind: "pending",
      tabId: tab.id,
      fromIndex: index,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: tabScrollRef.current?.scrollLeft ?? 0,
      pointerId: e.pointerId,
      tabEl: e.currentTarget,
    };

    const move = (ev: PointerEvent) => onWindowPointerMove(ev);
    const up = (ev: PointerEvent) => onWindowPointerUp(ev);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    clearWindowPointerListeners.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  };

  const endPointerSessionRef = useRef(endPointerSession);
  endPointerSessionRef.current = endPointerSession;

  useEffect(() => {
    return () => {
      endPointerSessionRef.current();
    };
  }, []);

  const finishRename = (commit: boolean) => {
    if (renameFinishingRef.current) return;
    const id = renamingTabIdRef.current;
    if (!id) return;
    const input = renameInputRef.current;
    const current = tabsRef.current.find((t) => t.id === id)?.fileName ?? null;
    const extension = current ? splitMarkdownFileName(current).extension : "";
    let stem = input?.value.trim() ?? "";
    if (
      extension &&
      stem.toLowerCase().endsWith(extension.toLowerCase()) &&
      stem.length > extension.length
    ) {
      stem = stem.slice(0, -extension.length).trim();
    }
    const next = `${stem}${extension}`;
    if (!commit || !stem || !current || next === current) {
      renamingTabIdRef.current = null;
      setRenamingTabId(null);
      return;
    }
    renameFinishingRef.current = true;
    void Promise.resolve(onRenameFileRef.current(id, next))
      .then((ok) => {
        if (!ok) {
          renameFinishingRef.current = false;
          const el = renameInputRef.current;
          if (!el || renamingTabIdRef.current !== id) return;
          el.focus();
          el.select();
          return;
        }
        if (renamingTabIdRef.current !== id) {
          renameFinishingRef.current = false;
          return;
        }
        renamingTabIdRef.current = null;
        renameFinishingRef.current = false;
        setRenamingTabId(null);
      })
      .catch(() => {
        renameFinishingRef.current = false;
      });
  };

  const beginRename = (tab: TabStripTab) => {
    if (sessionRef.current) endPointerSession();
    if (tab.id !== activeTabId) onSelectRef.current(tab.id);
    if (!tab.fileName) {
      onRenameUnavailableRef.current(tab.id);
      return;
    }
    renameReadyRef.current = false;
    renamingTabIdRef.current = tab.id;
    setRenamingTabId(tab.id);
  };

  useLayoutEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;

    const update = () => {
      setHorizontalScrollbarVisible(el.scrollWidth > el.clientWidth + 1);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [tabs, activeTabId]);

  useEffect(() => {
    if (!renamingTabId) return;
    const tab = tabs.find((t) => t.id === renamingTabId);
    if (tab?.fileName) return;
    renamingTabIdRef.current = null;
    renameFinishingRef.current = false;
    setRenamingTabId(null);
  }, [tabs, renamingTabId]);

  useLayoutEffect(() => {
    if (!renamingTabId) return;
    const input = renameInputRef.current;
    const scrollEl = tabScrollRef.current;
    if (!input) return;
    placeCaretAtEnd(input);
    if (scrollEl) {
      const tabEl = input.closest("[data-tab-id]");
      if (tabEl instanceof HTMLElement) {
        const tabRect = tabEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        if (tabRect.left < scrollRect.left) {
          scrollEl.scrollLeft -= scrollRect.left - tabRect.left;
        } else if (tabRect.right > scrollRect.right) {
          scrollEl.scrollLeft += tabRect.right - scrollRect.right;
        }
      }
    }
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (renamingTabIdRef.current === renamingTabId) {
          const el = renameInputRef.current;
          if (!renameReadyRef.current && el) placeCaretAtEnd(el);
          renameReadyRef.current = true;
        }
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
    };
  }, [renamingTabId]);

  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const displayOrder = dragUi?.previewOrderIds ?? tabs.map((t) => t.id);
  const dragFloatTab = dragUi ? tabById.get(dragUi.draggingTabId) : undefined;

  return (
    <div
      className={`${styles.tabStrip}${dragUi ? ` ${styles.tabStripDragging}` : ""}`}
    >
      <div
        ref={tabScrollRef}
        className={styles.tabScroll}
        role="tablist"
        aria-label="Open files"
      >
        {displayOrder.map((id) => {
          if (dragUi && id === dragUi.draggingTabId) {
            return (
              <div
                key={id}
                data-tab-placeholder={id}
                className={styles.tabPlaceholder}
                style={{
                  width: dragUi.floatWidth,
                  minWidth: dragUi.floatWidth,
                  maxWidth: dragUi.floatWidth,
                  height: dragUi.floatHeight,
                }}
                aria-hidden
              />
            );
          }
          const tab = tabById.get(id);
          if (!tab) return null;
          const index = tabs.findIndex((t) => t.id === tab.id);
          const renameParts =
            renamingTabId === tab.id && tab.fileName
              ? splitMarkdownFileName(tab.fileName)
              : null;
          return (
            <ContextMenu.Root
              key={tab.id}
              onOpenChange={(open) => {
                if (!open) return;
                if (sessionRef.current) endPointerSession();
                if (tab.id !== activeTabId) onSelectRef.current(tab.id);
              }}
            >
              <ContextMenu.Trigger asChild>
                <div
                  data-tab-id={tab.id}
                  className={`${styles.tab} ${styles.tabSelect} ${tab.id === activeTabId ? styles.tabActive : ""} ${renamingTabId === tab.id ? styles.tabRenaming : ""}`}
                  role="tab"
                  aria-selected={tab.id === activeTabId ? "true" : "false"}
                  tabIndex={tab.id === activeTabId ? 0 : -1}
                  onClick={(ev) => {
                    if (ignoreNextClickRef.current) {
                      ignoreNextClickRef.current = false;
                      ev.preventDefault();
                      return;
                    }
                    onSelect(tab.id);
                  }}
                  onPointerDown={(e) => onTabPointerDown(e, tab, index)}
                >
                  {renameParts ? (
                    <div
                      className={styles.tabRename}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onContextMenu={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={renameInputRef}
                        type="text"
                        className={styles.tabRenameInput}
                        defaultValue={renameParts.stem}
                        aria-label="File name"
                        spellCheck={false}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        onPointerDown={() => {
                          renameReadyRef.current = true;
                        }}
                        onBlur={() => {
                          if (!renameReadyRef.current) {
                            const el = renameInputRef.current;
                            if (el) placeCaretAtEnd(el);
                            return;
                          }
                          finishRename(true);
                        }}
                        onKeyDown={(e) => {
                          renameReadyRef.current = true;
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            finishRename(false);
                          } else if (e.key === "Enter") {
                            e.preventDefault();
                            finishRename(true);
                          }
                        }}
                      />
                      {renameParts.extension ? (
                        <span className={styles.tabRenameExtension}>
                          {renameParts.extension}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className={styles.tabLabel}>{tab.label}</div>
                  )}
                  <Tooltip content="Close tab">
                    <button
                      type="button"
                      className={styles.tabClose}
                      aria-label="Close tab"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (renamingTabIdRef.current === tab.id) {
                          finishRename(false);
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(tab.id);
                      }}
                    >
                      ×
                    </button>
                  </Tooltip>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className={styles.menuContent}
                  onCloseAutoFocus={(event) => {
                    if (renamingTabIdRef.current === tab.id) {
                      event.preventDefault();
                    }
                  }}
                >
                  <ContextMenu.Item
                    className={styles.menuItem}
                    onSelect={() => beginRename(tab)}
                  >
                    Rename
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={styles.menuItem}
                    onSelect={() => onClose(tab.id)}
                  >
                    Close
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>

      {dragUi && dragFloatTab ? (
        <div
          className={`${styles.tabFloat} ${styles.tab} ${styles.tabSelect} ${dragFloatTab.id === activeTabId ? styles.tabActive : ""}`}
          style={{
            position: "fixed",
            left: dragUi.floatLeft,
            top: dragUi.floatTop,
            width: dragUi.floatWidth,
            minWidth: dragUi.floatWidth,
            maxWidth: dragUi.floatWidth,
            minHeight: dragUi.floatHeight,
            zIndex: 1000,
          }}
          aria-hidden
        >
          <div className={styles.tabLabel}>{dragFloatTab.label}</div>
          <span className={styles.tabCloseMuted} aria-hidden>
            ×
          </span>
        </div>
      ) : null}

      <div
        className={`${styles.tabNewColumn}${horizontalScrollbarVisible ? ` ${styles.tabNewScrollbarVisible}` : ""}`}
      >
        <Tooltip content="New tab">
          <button
            type="button"
            className={styles.tabNew}
            aria-label="New tab"
            onClick={onNew}
          >
            +
          </button>
        </Tooltip>
        {horizontalScrollbarVisible ? (
          <div className={styles.tabNewScrollbarSpacer} aria-hidden />
        ) : null}
      </div>
    </div>
  );
}
