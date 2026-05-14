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
  return (
    <div className={styles.tabStrip} role="tablist" aria-label="Open files">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-tab-id={tab.id}
          className={`${styles.tab} ${styles.tabSelect} ${tab.id === activeTabId ? styles.tabActive : ""}`}
          onClick={() => onSelect(tab.id)}
          type="button"
          // className={styles.tabSelect}
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
      <button
        type="button"
        className={styles.tabNew}
        title="New tab"
        aria-label="New tab"
        onClick={onNew}
      >
        +
      </button>
    </div>
  );
}
