import { useLayoutEffect, useRef, useState } from "react";

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
  onNew: () => void;
};

export function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: TabStripProps) {
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [horizontalScrollbarVisible, setHorizontalScrollbarVisible] =
    useState(false);

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

  return (
    <div className={styles.tabStrip}>
      {/* Tabs */}
      <div
        ref={tabScrollRef}
        className={styles.tabScroll}
        role="tablist"
        aria-label="Open files"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-tab-id={tab.id}
            className={`${styles.tab} ${styles.tabSelect} ${tab.id === activeTabId ? styles.tabActive : ""}`}
            onClick={() => onSelect(tab.id)}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId ? "true" : "false"}
          >
            <div className={styles.tabLabel}>{tab.label}</div>
            <button
              type="button"
              className={styles.tabClose}
              title="Close tab"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              ×
            </button>
          </button>
        ))}
      </div>

      {/* New tab button */}
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
