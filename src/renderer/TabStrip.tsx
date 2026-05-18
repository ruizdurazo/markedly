import { useEffect, useLayoutEffect, useRef, useState } from "react";

import styles from "./TabStrip.module.scss";

export type TabStripTab = {
  id: string;
  label: string;
};

type TabStripProps = {
  tabs: TabStripTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorderTabIds: (orderedIds: string[]) => void;
  onNew: () => void;
};

const DRAG_THRESHOLD_PX = 6;
const EDGE_SCROLL_PX = 40;
const EDGE_SCROLL_STEP_PX = 12;

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
}: TabStripProps) {
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  const onReorderRef = useRef(onReorderTabIds);
  const onSelectRef = useRef(onSelect);
  tabsRef.current = tabs;
  onReorderRef.current = onReorderTabIds;
  onSelectRef.current = onSelect;

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
    if (e.button !== 0) return;
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
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`${styles.tab} ${styles.tabSelect} ${tab.id === activeTabId ? styles.tabActive : ""}`}
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
              <div className={styles.tabLabel}>{tab.label}</div>
              <button
                type="button"
                className={styles.tabClose}
                title="Close tab"
                aria-label="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
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
        <button
          type="button"
          className={styles.tabNew}
          title="New tab"
          aria-label="New tab"
          onClick={onNew}
        >
          +
        </button>
        {horizontalScrollbarVisible ? (
          <div className={styles.tabNewScrollbarSpacer} aria-hidden />
        ) : null}
      </div>
    </div>
  );
}
