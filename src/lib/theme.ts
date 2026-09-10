export type Theme = "light" | "dark";

let sessionTheme: Theme | null = null;

// Eseguito durante il parsing, prima che il browser dipinga il contenuto.
export const THEME_INIT_SCRIPT = `(() => {
  let theme;
  try { theme = localStorage.getItem("theme"); } catch {}
  document.documentElement.dataset.theme = theme === "light" || theme === "dark"
    ? theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();`;

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
    sessionTheme = null;
  } catch {
    sessionTheme = theme;
  }
}

export function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const syncPreference = () => {
    let saved: string | null = sessionTheme;
    if (saved === null) {
      try { saved = localStorage.getItem("theme"); } catch { /* Usa la preferenza di sistema. */ }
    }
    document.documentElement.dataset.theme = saved === "light" || saved === "dark"
      ? saved : media.matches ? "dark" : "light";
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === "theme" || event.key === null) syncPreference();
  };
  media.addEventListener("change", syncPreference);
  window.addEventListener("storage", onStorage);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", syncPreference);
    window.removeEventListener("storage", onStorage);
  };
}
