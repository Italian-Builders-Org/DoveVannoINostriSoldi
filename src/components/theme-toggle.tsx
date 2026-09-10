"use client";

import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { getTheme, setTheme, subscribeToTheme } from "@/lib/theme";

function getServerTheme() { return "light" as const; }

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, getServerTheme);
  const label = theme === "dark" ? "Attiva modalità chiara" : "Attiva modalità scura";

  return (
    <button
      type="button"
      className="header-action header-action-icon"
      onClick={() => setTheme(getTheme() === "dark" ? "light" : "dark")}
      aria-label={label}
      title={label}
    >
      <HugeiconsIcon icon={theme === "dark" ? Sun03Icon : Moon02Icon} size={19} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}
