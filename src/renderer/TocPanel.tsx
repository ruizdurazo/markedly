import styles from "./TocPanel.module.scss";

export type TocEntry = {
  level: number;
  text: string;
};

type TocPanelProps = {
  id?: string;
  panelExpanded: boolean;
  panelWidthPx: number;
  /** When false (e.g. welcome), the outline list is not tied to a document. */
  documentOpen: boolean;
  entries: TocEntry[];
  onActivateEntry: (index: number) => void;
};

export function TocPanel({
  id,
  panelExpanded,
  panelWidthPx,
  documentOpen,
  entries,
  onActivateEntry,
}: TocPanelProps) {
  if (!panelExpanded) {
    return (
      <aside
        id={id}
        className={`${styles.panel} ${styles.panelCollapsed}`}
        aria-label="Table of contents"
        aria-hidden
      />
    );
  }

  return (
    <aside
      id={id}
      className={`${styles.panel} ${styles.panelExpanded}`}
      aria-label="Table of contents"
      style={{
        width: panelWidthPx,
        minWidth: panelWidthPx,
        flexShrink: 0,
      }}
    >
      <div className={styles.inner}>
        <div className={styles.toolbar}>
          <h2 className={styles.title}>Outline</h2>
        </div>

        {documentOpen && entries.length === 0 ? (
          <p className={styles.empty}>No headings in this document.</p>
        ) : null}

        {documentOpen && entries.length > 0 ? (
          <nav className={styles.listScroll} aria-label="Document headings">
            {entries.map((entry, index) => {
              const pad = 8 + Math.max(0, entry.level - 1) * 12;
              return (
                <button
                  key={index}
                  type="button"
                  className={styles.row}
                  style={{ paddingLeft: pad }}
                  onClick={() => onActivateEntry(index)}
                >
                  <span className={styles.rowLabel}>{entry.text}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {!documentOpen ? (
          <p className={styles.empty}>Open a document to see the outline.</p>
        ) : null}
      </div>
    </aside>
  );
}
