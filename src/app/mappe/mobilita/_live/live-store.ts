/**
 * Per-viewer conveniences kept in the browser only: favourite lines.
 * Storage can be unavailable (private mode, blocked site data): every access
 * is guarded and the page works without it.
 */
const KEY = "dvns:roma-live:linee";
const MAX = 12;
const EMPTY: readonly string[] = Object.freeze([]);

let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly string[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && /^[0-9A-Za-z]{1,8}$/.test(v)).slice(0, MAX)
      : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function getFavorites(): readonly string[] {
  return read();
}

export function getServerFavorites(): readonly string[] {
  return EMPTY;
}

export function subscribeFavorites(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function toggleFavorite(routeId: string) {
  const current = read();
  const next = current.includes(routeId)
    ? current.filter((id) => id !== routeId)
    : [routeId, ...current].slice(0, MAX);
  cache = Object.freeze(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept for this page view only.
  }
  for (const listener of listeners) listener();
}
