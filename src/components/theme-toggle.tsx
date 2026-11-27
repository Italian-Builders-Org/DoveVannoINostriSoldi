"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { getTheme, setTheme, subscribeToTheme } from "@/lib/theme";

function getServerTheme() {
  return "light" as const;
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, getServerTheme);
  const label = theme === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={label}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}
