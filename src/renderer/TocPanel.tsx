import { useMemo } from "react";
import type { CSSProperties } from "react";
import styles from "./TocPanel.module.scss";

export type TocEntry = {
  level: number;
  text: string;
};

type TocPanelProps = {
  id?: string;
  panelExpanded: boolean;
  /** When true, width follows the drag handle with no CSS transition. */
  suppressWidthTransition?: boolean;
  panelWidthPx: number;
  /** When false (e.g. welcome), the outline list is not tied to a document. */
  documentOpen: boolean;
  entries: TocEntry[];
  onActivateEntry: (index: number) => void;
};

export function TocPanel({
  id,
  panelExpanded,
  suppressWidthTransition = false,
  panelWidthPx,
  documentOpen,
  entries,
  onActivateEntry,
}: TocPanelProps) {
  const innerLayoutStyle = useMemo((): CSSProperties => {
    if (suppressWidthTransition) {
      return {
        width: "100%",
        minWidth: 0,
        maxWidth: "none",
        alignSelf: "stretch",
      };
    }
    return {
      width: panelWidthPx,
      minWidth: panelWidthPx,
      maxWidth: panelWidthPx,
      flexShrink: 0,
    };
  }, [panelWidthPx, suppressWidthTransition]);

  return (
    <aside
      id={id}
      className={`${styles.panel} ${panelExpanded ? styles.panelExpanded : styles.panelCollapsed} ${suppressWidthTransition ? styles.panelSnapWidth : ""}`}
      aria-label="Table of contents"
      aria-hidden={!panelExpanded}
      style={{
        width: panelExpanded ? panelWidthPx : 0,
        minWidth: panelExpanded ? panelWidthPx : 0,
        flexShrink: 0,
      }}
    >
      <div
        className={styles.inner}
        style={innerLayoutStyle}
        inert={!panelExpanded ? true : undefined}
      >
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
