"use client";

import { useId, useState } from "react";
import { layoutComposition } from "@/lib/composition-layout";
import { compactEuro, exactEuro, percent } from "@/lib/format";
import styles from "./spending-composition.module.css";

export type CompositionFamily = "services" | "investment" | "pass-through" | "financing" | "other";

export type SpendingCompositionItem = {
  id: string;
  label: string;
  valueEuro: number;
  explanation: string;
  family: CompositionFamily;
};

type CompositionState =
  | { kind: "ready"; totalEuro: number; items: readonly SpendingCompositionItem[] }
  | {
      kind: "partial";
      totalEuro: number;
      items: readonly SpendingCompositionItem[];
      missing: readonly string[];
      message: string;
    };

export function SpendingComposition({
  state,
  period,
  scope,
  denominator,
  source,
}: {
  state: CompositionState;
  period: string;
  scope: string;
  denominator: string;
  source: { label: string; href: string; observedAt: string };
}) {
  const tooltipId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const listedTotal = state.items.reduce((total, item) => total + item.valueEuro, 0);
  const residual = Math.max(0, state.totalEuro - listedTotal);

  if (!Number.isFinite(state.totalEuro) || state.totalEuro <= 0) {
    throw new Error("Composition total must be positive");
  }
  if (state.kind === "ready" && Math.abs(listedTotal - state.totalEuro) > 0.01) {
    throw new Error("Ready composition must reconcile with its total");
  }
  if (state.kind === "partial" && listedTotal > state.totalEuro + 0.01) {
    throw new Error("Partial composition cannot exceed its canonical total");
  }

  const items: SpendingCompositionItem[] = [
    ...state.items,
    ...(state.kind === "partial" && residual > 0
      ? [{
          id: "unallocated",
          label: "Quota non ripartita",
          valueEuro: residual,
          explanation: state.message,
          family: "other" as const,
        }]
      : []),
  ];
  const rectangles = layoutComposition(items.map((item) => ({ id: item.id, value: item.valueEuro })));
  const rectangleById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
  const displayedId = pinnedId ?? activeId;
  const displayed = items.find((item) => item.id === displayedId) ?? null;
  const share = (item: SpendingCompositionItem) => (item.valueEuro / state.totalEuro) * 100;

  function toggle(item: SpendingCompositionItem) {
    setPinnedId((current) => (current === item.id ? null : item.id));
    setActiveId(item.id);
  }

  return (
    <div className={styles.composition} data-composition-state={state.kind}>
      {state.kind === "partial" ? (
        <p className={styles.partial} role="status">
          <strong>Dati parziali.</strong> {state.message} Mancano: {state.missing.join(", ")}.
        </p>
      ) : null}

      <div className={styles.visual} role="group" aria-label={`Composizione di ${denominator}`}>
        {items.map((item, index) => {
          const rectangle = rectangleById.get(item.id);
          if (!rectangle) return null;
          const labelMode = rectangle.areaShare >= 0.08 ? "full" : rectangle.areaShare >= 0.03 ? "index" : "none";
          return (
            <button
              type="button"
              key={item.id}
              className={`${styles.tile} ${styles[item.family]}`}
              style={{
                left: `${rectangle.x}%`,
                top: `${(rectangle.y / 62) * 100}%`,
                width: `${rectangle.width}%`,
                height: `${(rectangle.height / 62) * 100}%`,
              }}
              tabIndex={-1}
              aria-label={`${index + 1}. ${item.label}: ${percent(share(item))}`}
              aria-describedby={displayedId === item.id ? tooltipId : undefined}
              data-active={displayedId === item.id ? "true" : undefined}
              onPointerEnter={() => setActiveId(item.id)}
              onPointerLeave={() => setActiveId(null)}
              onClick={() => toggle(item)}
            >
              {labelMode === "full" ? (
                <span><b>{item.label}</b><strong>{percent(share(item))}</strong></span>
              ) : labelMode === "index" ? <span className={styles.tileIndex}>{index + 1}</span> : null}
            </button>
          );
        })}
      </div>

      <ol className={styles.legend}>
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              aria-describedby={displayedId === item.id ? tooltipId : undefined}
              aria-pressed={pinnedId === item.id}
              onFocus={() => setActiveId(item.id)}
              onBlur={() => setActiveId(null)}
              onPointerEnter={() => setActiveId(item.id)}
              onPointerLeave={() => setActiveId(null)}
              onClick={() => toggle(item)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPinnedId(null);
                  setActiveId(null);
                }
              }}
            >
              <i className={styles[item.family]} aria-hidden="true" />
              <span><b>{index + 1}. {item.label}</b><small>{compactEuro(item.valueEuro)}</small></span>
              <strong>{percent(share(item))}</strong>
            </button>
            <i className={styles.mobileBar} aria-hidden="true">
              <span className={styles[item.family]} style={{ width: `${share(item)}%` }} />
            </i>
          </li>
        ))}
      </ol>

      {displayed ? (
        <div className={styles.tooltip} id={tooltipId} role="tooltip">
          <strong>{displayed.label} · {percent(share(displayed))}</strong>
          <span>{exactEuro(displayed.valueEuro)}</span>
          <p>{displayed.explanation}</p>
        </div>
      ) : null}

      <p className={styles.meta}>
        <strong>{period}</strong> · {scope}. Denominatore: {denominator}. Fonte:{" "}
        <a href={source.href} target="_blank" rel="noreferrer">{source.label}</a>, acquisita il {source.observedAt}.
      </p>

      <details className={styles.tableDetails}>
        <summary>Dati esatti della composizione</summary>
        <div className="table-scroll" role="region" aria-label="Dati esatti della composizione" tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">Voce</th><th scope="col" className="num">Importo</th><th scope="col" className="num">Quota</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}><th scope="row">{item.label}</th><td className="num">{exactEuro(item.valueEuro)}</td><td className="num">{percent(share(item))}</td></tr>
              ))}
              <tr><th scope="row">Totale</th><td className="num">{exactEuro(state.totalEuro)}</td><td className="num">100%</td></tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
