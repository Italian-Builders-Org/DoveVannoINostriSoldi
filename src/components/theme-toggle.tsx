"use client";

import { useEffect, useState } from "react";

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
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initialTheme = getPreferredTheme();

    applyTheme(initialTheme);

    const timeout = window.setTimeout(() => {
      setTheme(initialTheme);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";

    applyTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  };

  return (
    <button
      type="button"
      className="header-action header-action-icon theme-toggle"
      onClick={toggleTheme}
      aria-label={
        theme === "dark" ? "Attiva modalità chiara" : "Attiva modalità scura"
      }
      title={theme === "dark" ? "Modalità chiara" : "Modalità scura"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
