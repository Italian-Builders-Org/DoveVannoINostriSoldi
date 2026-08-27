"use client";

import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import {
  THEME_CHANGE_EVENT,
  applyTheme,
  getEffectiveTheme,
  setTheme,
  type Theme,
} from "@/lib/theme";

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const syncTheme = () => {
    applyTheme(getEffectiveTheme());
    callback();
  };
  mediaQuery.addEventListener("change", syncTheme);
  window.addEventListener("storage", syncTheme);
  window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
  return () => {
    mediaQuery.removeEventListener("change", syncTheme);
    window.removeEventListener("storage", syncTheme);
    window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
  };
}

function getThemeSnapshot(): Theme {
  return getEffectiveTheme();
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const currentTheme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  function handleToggle() {
    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  }

  const isDark = currentTheme === "dark";
  const label = isDark ? "Attiva tema chiaro" : "Attiva tema scuro";

  return (
    <button
      type="button"
      className="header-action header-action-icon theme-toggle"
      onClick={handleToggle}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
    >
      <span className="theme-toggle-icon-dark" aria-hidden="true">
        <HugeiconsIcon icon={Moon02Icon} size={19} strokeWidth={1.7} />
      </span>
      <span className="theme-toggle-icon-light" aria-hidden="true">
        <HugeiconsIcon icon={Sun02Icon} size={19} strokeWidth={1.7} />
      </span>
    </button>
  );
}
