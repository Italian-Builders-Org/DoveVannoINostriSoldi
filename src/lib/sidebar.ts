/**
 * Preferenza di ancoraggio della sidebar desktop.
 *
 * Rispecchia `src/lib/theme.ts`: la preferenza viene scritta su
 * `document.documentElement` da uno script eseguito durante il parsing, prima
 * che il browser dipinga. È ciò che permette di ricordare la scelta senza lo
 * spostamento di layout in fase di idratazione che il resto della navigazione
 * evita deliberatamente.
 */

export type SidebarState = "pinned" | "rail";

let sessionState: SidebarState | null = null;

const STORAGE_KEY = "sidebar";

// Eseguito durante il parsing, prima che il browser dipinga il contenuto.
export const SIDEBAR_INIT_SCRIPT = `(() => {
  let sidebar;
  try { sidebar = localStorage.getItem("${STORAGE_KEY}"); } catch {}
  document.documentElement.dataset.sidebar = sidebar === "pinned" ? "pinned" : "rail";
})();`;

/**
 * Lo stato dipinto adesso. Sul server, e prima che lo script sia eseguito, vale
 * `rail`: è lo stesso valore che il markup del server assume, quindi client e
 * server partono d'accordo.
 */
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
    // Storage negato (navigazione privata, cookie di terze parti bloccati): la
    // preferenza vale comunque per questa scheda, invece di non valere affatto.
    sessionState = state;
  }
}

/** La preferenza salvata, che può differire da quella dipinta in un'altra scheda. */
export function readStoredSidebarState(): SidebarState {
  if (sessionState !== null) return sessionState;
  try {
    return localStorage.getItem(STORAGE_KEY) === "pinned" ? "pinned" : "rail";
  } catch {
    return "rail";
  }
}
