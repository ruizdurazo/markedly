export const STATUS_BAR_STORAGE_KEY = "markedly:status-bar";

export function readStoredStatusBarVisible(): boolean {
  try {
    return localStorage.getItem(STATUS_BAR_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

export function writeStoredStatusBarVisible(visible: boolean): void {
  try {
    localStorage.setItem(
      STATUS_BAR_STORAGE_KEY,
      visible ? "visible" : "hidden",
    );
  } catch {
    /* ignore quota / private mode */
  }
}
