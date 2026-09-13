export type SidebarState = "pinned" | "rail";

let sessionState: SidebarState | null = null;

const STORAGE_KEY = "sidebar";

// Eseguito durante il parsing, prima che il browser dipinga il contenuto.
export const SIDEBAR_INIT_SCRIPT = `(() => {
  let sidebar;
  try { sidebar = localStorage.getItem("${STORAGE_KEY}"); } catch {}
  document.documentElement.dataset.sidebar = sidebar === "pinned" ? "pinned" : "rail";
})();`;

export function getSidebarState(): SidebarState {
  if (typeof document === "undefined") return "rail";
  return document.documentElement.dataset.sidebar === "pinned" ? "pinned" : "rail";
}

export function setSidebarState(state: SidebarState) {
  document.documentElement.dataset.sidebar = state;
  try {
    localStorage.setItem(STORAGE_KEY, state);
    sessionState = null;
  } catch {
    // Keep the choice in this tab when storage is unavailable.
    sessionState = state;
  }
}

/** La preferenza salvata, che può differire da quella dipinta in un'altra scheda. */
export function readStoredSidebarState(): SidebarState {
  if (sessionState !== null) return sessionState;
  try {
    return localStorage.getItem(STORAGE_KEY) === "pinned" ? "pinned" : "rail";
  } catch {
    return getSidebarState();
  }
}
