"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [view, setView] = useState<TerritoryView>(initialView);

  const choose = (next: TerritoryView) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "grafico") url.searchParams.delete("vista");
    else url.searchParams.set("vista", next);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
  };

  return (
    <div className={styles.viewBlock}>
      <div className={styles.viewSelector} role="tablist" aria-label="Vista dei dati regionali">
        <button type="button" role="tab" aria-selected={view === "grafico"} onClick={() => choose("grafico")}>Grafico</button>
        <button type="button" role="tab" aria-selected={view === "tabella"} onClick={() => choose("tabella")}>Tabella</button>
      </div>
      <div role="tabpanel">{view === "grafico" ? chart : table}</div>
    </div>
  );
}
