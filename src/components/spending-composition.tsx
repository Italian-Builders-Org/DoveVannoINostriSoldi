"use client";

import { useEffect, useId, useRef, useState } from "react";
import { layoutComposition } from "@/lib/composition-layout";
import { compactEuro, exactEuro, percent } from "@/lib/format";
import styles from "./spending-composition.module.css";

export type CompositionFamily = "services" | "investment" | "pass-through" | "financing" | "other";

export type SpendingCompositionItem = {
  id: string;
  label: string;
  shortLabel?: string;
  valueEuro: number;
  explanation: string;
  family: CompositionFamily;
};

type TooltipPosition = {
  anchor: HTMLElement;
  left: number;
  top: number;
  placement: "above" | "below";
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
  const compositionRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
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

  function activate(itemId: string, event: { currentTarget: HTMLElement }) {
    setActiveId(itemId);
    setAnchor(event.currentTarget);
  }

  function deactivate(itemId: string, event: { currentTarget: HTMLElement }) {
    if (pinnedId === itemId) return;
    setActiveId((current) => (current === itemId ? null : current));
    setAnchor((current) => (current === event.currentTarget ? null : current));
  }

  function toggle(item: SpendingCompositionItem, event: { currentTarget: HTMLElement }) {
    setPinnedId((current) => (current === item.id ? null : item.id));
    setActiveId(item.id);
    setAnchor(event.currentTarget);
  }

  useEffect(() => {
    if (!displayedId || !anchor) {
      return;
    }

    const composition = compositionRef.current;
    const tooltip = tooltipRef.current;
    if (!composition || !tooltip || !anchor.isConnected) {
      return;
    }

    const measure = () => {
      if (!anchor.isConnected) return;

      const compositionRect = composition.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      if (tooltipRect.width === 0 || tooltipRect.height === 0) return;

      const parsedGutter = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--gutter"),
      );
      const gutter = Number.isFinite(parsedGutter) ? parsedGutter : 16;
      const gap = 8;
      const viewportLeft = gutter;
      const viewportRight = Math.max(viewportLeft, window.innerWidth - gutter);
      const preferredLeft = anchorRect.left + (anchorRect.width / 2) - (tooltipRect.width / 2);
      const minLeft = viewportLeft;
      const maxLeft = Math.max(minLeft, viewportRight - tooltipRect.width);
      const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);

      const viewportTop = Math.max(8, gutter);
      const viewportBottom = Math.max(viewportTop, window.innerHeight - gutter);
      const belowTop = anchorRect.bottom + gap;
      const aboveTop = anchorRect.top - tooltipRect.height - gap;
      const fitsBelow = belowTop + tooltipRect.height <= viewportBottom;
      const fitsAbove = aboveTop >= viewportTop;
      const useAbove = !fitsBelow && fitsAbove;
      const preferredTop = useAbove ? aboveTop : belowTop;
      const maxTop = Math.max(viewportTop, viewportBottom - tooltipRect.height);
      const top = Math.min(Math.max(preferredTop, viewportTop), maxTop);

      setTooltipPosition({
        anchor,
        left: left - compositionRect.left,
        top: top - compositionRect.top,
        placement: useAbove ? "above" : "below",
      });
    };

    let frame = window.requestAnimationFrame(measure);
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(composition);
    resizeObserver?.observe(anchor);
    resizeObserver?.observe(tooltip);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("orientationchange", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("orientationchange", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, [anchor, displayedId]);

  useEffect(() => {
    if (!displayedId) return;

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !compositionRef.current?.contains(event.target)) {
        setPinnedId(null);
        setActiveId(null);
        setAnchor(null);
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [displayedId]);

  return (
    <div ref={compositionRef} className={styles.composition} data-composition-state={state.kind}>
      {state.kind === "partial" ? (
        <p className={styles.partial} role="status">
          <strong>Dati parziali.</strong> {state.message} Mancano: {state.missing.join(", ")}.
        </p>
      ) : null}

      <div className={styles.visual} role="group" aria-label={`Composizione di ${denominator}`}>
        {items.map((item, index) => {
          const rectangle = rectangleById.get(item.id);
          if (!rectangle) return null;
          const labelMode = rectangle.width >= 38 && rectangle.height >= 24
            ? "detail"
            : rectangle.width >= 24 && rectangle.height >= 18
              ? "label"
              : "index";
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
              aria-label={`${index + 1}. ${item.label}: ${percent(share(item))}`}
              aria-describedby={displayedId === item.id ? tooltipId : undefined}
              aria-pressed={pinnedId === item.id}
              data-active={displayedId === item.id ? "true" : undefined}
              onFocus={(event) => activate(item.id, event)}
              onBlur={(event) => deactivate(item.id, event)}
              onPointerEnter={(event) => activate(item.id, event)}
              onPointerLeave={(event) => deactivate(item.id, event)}
              onClick={(event) => toggle(item, event)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setPinnedId(null);
                  setActiveId(null);
                  setAnchor(null);
                }
              }}
            >
              {labelMode === "detail" ? (
                <span className={styles.tileCopy}>
                  <b>{item.shortLabel ?? item.label}</b>
                  <small>{compactEuro(item.valueEuro)} · {percent(share(item))}</small>
                </span>
              ) : labelMode === "label" ? (
                <span className={styles.tileCopy}>
                  <b>{item.shortLabel ?? item.label}</b>
                  <small>{percent(share(item))}</small>
                </span>
              ) : <span className={styles.tileIndex}>{index + 1}</span>}
            </button>
          );
        })}
      </div>

      <p className={styles.guide}>
        <span className={styles.guideDesktop}>Più grande è il riquadro, maggiore è la quota sul totale. I valori esatti sono sotto.</span>
        <span className={styles.guideMobile}>Più lunga è la barra, maggiore è la quota sul totale.</span>
      </p>

      <ol className={styles.legend}>
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              aria-describedby={displayedId === item.id ? tooltipId : undefined}
              aria-pressed={pinnedId === item.id}
              onFocus={(event) => activate(item.id, event)}
              onBlur={(event) => deactivate(item.id, event)}
              onPointerEnter={(event) => activate(item.id, event)}
              onPointerLeave={(event) => deactivate(item.id, event)}
              onClick={(event) => toggle(item, event)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setPinnedId(null);
                  setActiveId(null);
                  setAnchor(null);
                }
              }}
            >
              <i className={`${styles.legendSwatch} ${styles[item.family]}`} aria-hidden="true" />
              <span className={styles.legendCopy}>
                <b className={styles.legendLabel}>{index + 1}. {item.label}</b>
                <small className={styles.legendAmount}>{compactEuro(item.valueEuro)}</small>
              </span>
              <strong className={styles.legendShare}>{percent(share(item))}</strong>
            </button>
            <i className={styles.mobileBar} aria-hidden="true">
              <span className={styles[item.family]} style={{ width: `${share(item)}%` }} />
            </i>
          </li>
        ))}
      </ol>

      {displayed ? (
        <div
          ref={tooltipRef}
          className={styles.tooltip}
          id={tooltipId}
          role="tooltip"
          data-positioned={tooltipPosition?.anchor === anchor ? "true" : "false"}
          data-placement={tooltipPosition?.anchor === anchor ? tooltipPosition.placement : undefined}
          style={tooltipPosition?.anchor === anchor ? {
            left: `${tooltipPosition.left}px`,
            top: `${tooltipPosition.top}px`,
          } : undefined}
        >
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
