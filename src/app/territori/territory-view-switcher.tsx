"use client";

import type { ReactNode } from "react";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import styles from "./territori.module.css";

type TerritoryView = "grafico" | "tabella";

export function TerritoryViewSwitcher({
  initialView,
  chart,
  table,
}: {
  initialView: TerritoryView;
  chart: ReactNode;
  table: ReactNode;
}) {
  const idPrefix = useId().replace(/:/g, "");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [view, setView] = useState<TerritoryView>(initialView);

  const tabs: ReadonlyArray<{ value: TerritoryView; label: string }> = [
    { value: "grafico", label: "Grafico" },
    { value: "tabella", label: "Tabella" },
  ];
  const tabId = (value: TerritoryView) => `${idPrefix}-tab-${value}`;
  const panelId = `${idPrefix}-panel`;

  const choose = (next: TerritoryView) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "grafico") url.searchParams.delete("vista");
    else url.searchParams.set("vista", next);
    const query = url.searchParams.toString();
    window.history.replaceState(null, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
  };

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex]?.value;
    if (!next) return;
    choose(next);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={styles.viewBlock}>
      <div
        className={styles.viewSelector}
        role="tablist"
        aria-label="Vista dei dati regionali"
        aria-orientation="horizontal"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={tabId(tab.value)}
            type="button"
            role="tab"
            aria-selected={view === tab.value}
            aria-controls={panelId}
            tabIndex={view === tab.value ? 0 : -1}
            onKeyDown={(event) => moveTab(event, index)}
            onClick={() => choose(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(view)}
      >
        {view === "grafico" ? chart : table}
      </div>
    </div>
  );
}
