import styles from "./Welcome.module.scss";

type WelcomeProps = {
  onOpenFile: () => void;
  onNewDocument: () => void;
  /** Extra top space matching the hidden tab strip. */
  reserveTabStripSpace?: boolean;
};

export function Welcome({
  onOpenFile,
  onNewDocument,
  reserveTabStripSpace = false,
}: WelcomeProps) {
  return (
    <div
      className={`${styles.welcome}${reserveTabStripSpace ? ` ${styles.welcomeReserveTabs}` : ""}`}
    >
      <h1>markedly</h1>
      <p>Open a Markdown file, start a new one, or drag one here.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.openButton} onClick={onOpenFile}>
          <span>Open file</span>
          <span className={styles.hint}>
            <kbd>⌘</kbd>
            <kbd>O</kbd>
          </span>
        </button>
        <button
          type="button"
          className={styles.newButton}
          onClick={onNewDocument}
        >
          New document
        </button>
      </div>
    </div>
  );
}
