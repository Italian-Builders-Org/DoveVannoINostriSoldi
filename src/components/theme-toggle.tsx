"use client";

import { useEffect } from "react";

type Theme = "light" | "dark";

function getPreferredTheme(): Theme {
  const savedTheme = localStorage.getItem("theme");

  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  useEffect(() => {
    applyTheme(getPreferredTheme());
  }, []);

  const toggleTheme = () => {
    const currentTheme =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";

    const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";

    applyTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
  };

  return (
    <button
      type="button"
      className="header-action header-action-icon theme-toggle"
      onClick={toggleTheme}
      aria-label="Cambia tema"
      title="Cambia tema"
    >
      <span className="theme-toggle__moon" aria-hidden="true">
        ☾
      </span>

      <span className="theme-toggle__sun" aria-hidden="true">
        ☀
      </span>
    </button>
  );
}
