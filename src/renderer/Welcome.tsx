import styles from "./Welcome.module.scss";

type WelcomeProps = {
  onOpenFile: () => void;
};

export function Welcome({ onOpenFile }: WelcomeProps) {
  return (
    <div className={styles.welcome}>
      <h1>Markedly</h1>
      <p>Open a Markdown file or drag one here.</p>
      <button type="button" className={styles.openButton} onClick={onOpenFile}>
        <span>Open file</span>
        <span className={styles.hint}>
          <kbd>⌘</kbd>
          <kbd>O</kbd>
        </span>
      </button>
    </div>
  );
}
