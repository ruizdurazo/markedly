export type FontPreference = "sans" | "serif";

export const FONT_PREFERENCE_STORAGE_KEY = "markedly:font";

export function parseFontPreference(raw: string | null): FontPreference {
  return raw === "serif" ? "serif" : "sans";
}

export function readStoredFontPreference(): FontPreference {
  try {
    return parseFontPreference(localStorage.getItem(FONT_PREFERENCE_STORAGE_KEY));
  } catch {
    return "sans";
  }
}

export function writeStoredFontPreference(pref: FontPreference): void {
  try {
    localStorage.setItem(FONT_PREFERENCE_STORAGE_KEY, pref);
  } catch {
    /* ignore quota / private mode */
  }
}

export function applyFontPreferenceToDocument(pref: FontPreference): void {
  const root = document.documentElement;
  if (pref === "sans") {
    root.removeAttribute("data-font");
  } else {
    root.setAttribute("data-font", pref);
  }
}
