"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme | null;

    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
      return;
    }

    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;

    const initialTheme: Theme = prefersDark ? "dark" : "light";

    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);
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
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
