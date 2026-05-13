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
    <div
      className={styles.tabStrip}
      role="tablist"
      aria-label="Open files"
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`${styles.tab} ${tab.id === activeTabId ? styles.tabActive : ""}`}
          data-tab-id={tab.id}
        >
          <button
            type="button"
            className={styles.tabSelect}
            role="tab"
            aria-selected={tab.id === activeTabId ? "true" : "false"}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
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
        </div>
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
