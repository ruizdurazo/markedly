import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Folder, NavArrowDown, NavArrowRight, Page } from "iconoir-react";
import type { DirTreeNode } from "../shared/types.js";
import styles from "./FileTreePanel.module.scss";

const iconProps = {
  width: 16,
  height: 16,
  strokeWidth: 2,
} as const;

type FileTreePanelProps = {
  id?: string;
  panelExpanded: boolean;
  /** When true, width follows the drag handle with no CSS transition. */
  suppressWidthTransition?: boolean;
  panelWidthPx: number;
  rootFolderPath: string | null;
  tree: DirTreeNode[];
  treeLoading: boolean;
  treeError: string | null;
  onPickFolder: () => void;
  onRefresh: () => void;
  onOpenMarkdown: (path: string) => void;
};

function TreeList(props: {
  nodes: DirTreeNode[];
  depth: number;
  expandedDirs: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}): ReactNode {
  const { nodes, depth, expandedDirs, onToggleDir, onOpenFile } = props;
  const pad = 8 + depth * 12;

  return nodes.map((node) => {
    if (node.type === "file") {
      return (
        <button
          key={node.path}
          type="button"
          className={styles.row}
          style={{
            paddingLeft: pad,
            paddingTop: 4,
            paddingBottom: 4,
            paddingRight: 8,
          }}
          onClick={() => onOpenFile(node.path)}
        >
          <span className={styles.fileIcon} aria-hidden>
            <Page {...iconProps} />
          </span>
          <span className={styles.rowLabel}>{node.name}</span>
        </button>
      );
    }

    const open = expandedDirs.has(node.path);
    return (
      <div key={node.path}>
        <button
          type="button"
          className={`${styles.row} ${styles.rowDir}`}
          style={{
            paddingLeft: Math.max(4, pad - 4),
            paddingTop: 4,
            paddingBottom: 4,
            paddingRight: 8,
          }}
          onClick={() => onToggleDir(node.path)}
          aria-expanded={open}
        >
          <span className={styles.disclosure} aria-hidden>
            {open ? (
              <NavArrowDown {...iconProps} />
            ) : (
              <NavArrowRight {...iconProps} />
            )}
          </span>
          <span className={styles.fileIcon} aria-hidden>
            <Folder {...iconProps} />
          </span>
          <span className={styles.rowLabel}>{node.name}</span>
        </button>
        {open && node.children.length > 0 ? (
          <TreeList
            nodes={node.children}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
          />
        ) : null}
      </div>
    );
  });
}

export function FileTreePanel({
  id,
  panelExpanded,
  suppressWidthTransition = false,
  panelWidthPx,
  rootFolderPath,
  tree,
  treeLoading,
  treeError,
  onPickFolder,
  onRefresh,
  onOpenMarkdown,
}: FileTreePanelProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedDirs(new Set());
  }, [rootFolderPath, tree]);

  const onToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

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
      aria-label="Files"
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
          <h2 className={styles.title}>Files</h2>
        </div>

        {/* {rootFolderPath ? (
          <p className={styles.rootLabel} title={rootFolderPath}>
            {rootFolderPath}
          </p>
        ) : null} */}

        <button type="button" className={styles.cta} onClick={onPickFolder}>
          <Folder {...iconProps} />
          Open folder…
        </button>

        {treeError ? <p className={styles.error}>{treeError}</p> : null}

        {treeLoading ? <p className={styles.loading}>Loading…</p> : null}

        {!treeLoading && rootFolderPath && tree.length === 0 && !treeError ? (
          <p className={styles.loading}>No Markdown files in this folder.</p>
        ) : null}

        {tree.length > 0 ? (
          <div className={styles.treeScroll}>
            <TreeList
              nodes={tree}
              depth={0}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenMarkdown}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
