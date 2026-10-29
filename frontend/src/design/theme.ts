import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "gymctrl-theme";
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** „Sistem” lasă tema pe seama setării din sistem (fără atribut); celelalte o forțează. */
function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

/** Aplică tema ținută minte; se cheamă înainte de prima randare, ca să nu pâlpâie tema greșită. */
export function initTheme() {
  applyTheme(readPreference());
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // browser fără stocare: alegerea ține doar până la reîncărcare
  }
  applyTheme(preference);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Alegerea curentă de temă (ținută minte în browser) și funcția de schimbare; ține <html> la zi. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);
  useEffect(() => applyTheme(preference), [preference]);
  return [preference, setThemePreference] as const;
}
