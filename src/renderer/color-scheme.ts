import type { ColorSchemePreference } from "../shared/types.js";

export const COLOR_SCHEME_STORAGE_KEY = "markedly:color-scheme";

export function parseColorSchemePreference(
  raw: string | null,
): ColorSchemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function readStoredColorSchemePreference(): ColorSchemePreference {
  try {
    return parseColorSchemePreference(
      localStorage.getItem(COLOR_SCHEME_STORAGE_KEY),
    );
  } catch {
    return "system";
  }
}

export function writeStoredColorSchemePreference(
  pref: ColorSchemePreference,
): void {
  try {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, pref);
  } catch {
    /* ignore quota / private mode */
  }
}

export function getResolvedColorScheme(
  pref: ColorSchemePreference,
): "light" | "dark" {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyColorSchemeToDocument(pref: ColorSchemePreference): void {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-color-scheme");
  } else {
    root.setAttribute("data-color-scheme", pref);
  }
}
