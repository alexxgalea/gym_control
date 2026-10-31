/*
 * PROTOTIP (ramura prototype/ecran-usa-si-meniu): comutatorul dintre variante. Nu ajunge în main.
 * Varianta stă în `?variant=` și, ca să nu se piardă la navigarea din Admin (linkurile nu păstrează `?`), și în
 * sessionStorage. Fără router: merge și pe Ecranul de la ușă, care nu are router.
 */
import { useEffect, useSyncExternalStore } from "react";

const EVENT = "prototype-variant";

/** `door`/`shell` folosesc `?variant=`; orice alt comutator, `?<scope>=` (ex. `?bg=`), ca să nu se calce pe picioare. */
function param(scope: string) {
  return scope === "door" || scope === "shell" ? "variant" : scope;
}

function storageKey(scope: string) {
  return `prototype-variant:${scope}`;
}

function read(scope: string, keys: readonly string[]): string {
  if (import.meta.env.MODE === "test") return "0"; // testele existente verifică ecranul actual
  const fromUrl = new URLSearchParams(window.location.search).get(param(scope));
  if (fromUrl && keys.includes(fromUrl)) {
    try {
      sessionStorage.setItem(storageKey(scope), fromUrl);
    } catch {
      // fără stocare: rămâne doar în adresă
    }
    return fromUrl;
  }
  try {
    const stored = sessionStorage.getItem(storageKey(scope));
    if (stored && keys.includes(stored)) return stored;
  } catch {
    // ignorat
  }
  return keys[0] ?? "";
}

function write(scope: string, value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(param(scope), value);
  window.history.replaceState(window.history.state, "", url);
  try {
    sessionStorage.setItem(storageKey(scope), value);
  } catch {
    // ignorat
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("popstate", listener);
  };
}

export function usePrototypeVariant(scope: string, keys: readonly string[]): string {
  return useSyncExternalStore(subscribe, () => read(scope, keys));
}

/** Bara plutitoare de jos: ← varianta → . Săgețile de pe tastatură o schimbă și ele. */
export function PrototypeSwitcher({
  scope,
  variants,
  position = "bottom",
  offset = 12,
}: {
  scope: string;
  variants: readonly { key: string; name: string }[];
  position?: "bottom" | "top";
  offset?: number;
}) {
  const keys = variants.map((variant) => variant.key);
  const current = usePrototypeVariant(scope, keys);
  const index = Math.max(0, keys.indexOf(current));
  const go = (step: number) => write(scope, keys[(index + step + keys.length) % keys.length] ?? "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, [contenteditable]") || event.metaKey || event.ctrlKey)) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (new URLSearchParams(window.location.search).has("shot")) return null; // capturi de ecran curate

  const button: React.CSSProperties = {
    width: 32,
    height: 32,
    border: 0,
    borderRadius: 999,
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
  };
  return (
    <div
      data-prototype-switcher
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        [position]: offset,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 6,
        borderRadius: 999,
        background: "#ff2d95",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        color: "#fff",
        font: "600 13px/1 system-ui, sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      <button type="button" style={button} onClick={() => go(-1)} aria-label="Varianta anterioară">
        ←
      </button>
      <span style={{ padding: "0 6px" }}>
        PROTOTIP {variants[index]?.key} · {variants[index]?.name}
      </span>
      <button type="button" style={button} onClick={() => go(1)} aria-label="Varianta următoare">
        →
      </button>
    </div>
  );
}
