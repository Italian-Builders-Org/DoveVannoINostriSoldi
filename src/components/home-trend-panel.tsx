"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { compactEuro } from "@/lib/format";
import type { SiopeMunicipalMonthlyPoint } from "@/lib/siope-snapshot";
import styles from "@/app/home.module.css";
import trendStyles from "./home-trend-panel.module.css";

type TrendMetric = "cumulative" | "monthly";

function chartPoints(values: readonly number[]): Array<{ x: number; y: number }> {
  const maximum = Math.max(...values, 1);
  return values.map((value, index) => ({
    x: 36 + (index / Math.max(values.length - 1, 1)) * 414,
    y: 124 - (value / maximum) * 104,
  }));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function HomeTrendPanel({
  monthly,
  period,
  year,
}: Readonly<{
  monthly: SiopeMunicipalMonthlyPoint[];
  period: string;
  year: number;
}>) {
  const [metric, setMetric] = useState<TrendMetric>("cumulative");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const pointRefs = useRef<Array<SVGCircleElement | null>>([]);
  const instanceId = useId().replace(/:/g, "");
  const tooltipId = "home-trend-tooltip-" + instanceId;
  const gradientId = "home-trend-gradient-" + instanceId;
  const values = useMemo(
    () => monthly.map((point) => metric === "cumulative" ? point.cumulative : point.flow),
    [metric, monthly],
  );
  const plotted = chartPoints(values);
  const maximum = Math.max(...values, 0);
  const linePoints = plotted
    .map(({ x, y }) => [x.toFixed(1), y.toFixed(1)].join(","))
    .join(" ");
  const metricLabel = metric === "cumulative" ? "cumulato" : "mensile";
  const accessibleSeries = monthly
    .map((point, index) => point.label + ": " + compactEuro(values[index] ?? 0))
    .join("; ");
  const safeFocusIndex = monthly.length === 0 ? 0 : clamp(focusIndex, 0, monthly.length - 1);
  const displayedIndex = activeIndex ?? selectedIndex;
  const displayedPoint = displayedIndex === null ? null : monthly[displayedIndex];
  const displayedValue = displayedIndex === null ? null : values[displayedIndex] ?? 0;
  const tooltipWidth = 106;
  const displayedCoordinates = displayedIndex === null ? null : plotted[displayedIndex];
  const tooltipX = displayedCoordinates
    ? clamp(displayedCoordinates.x - tooltipWidth / 2, 4, 460 - tooltipWidth - 4)
    : 0;
  const tooltipY = displayedCoordinates
    ? displayedCoordinates.y > 48 ? displayedCoordinates.y - 43 : displayedCoordinates.y + 8
    : 0;

  const previewPoint = useCallback((index: number) => {
    setFocusIndex(index);
    setActiveIndex(index);
  }, []);

  const selectPoint = useCallback((index: number) => {
    setFocusIndex(index);
    setActiveIndex(index);
    setSelectedIndex(index);
  }, []);

  const clearPointPreview = useCallback((index: number) => {
    setActiveIndex((current) => current === index ? selectedIndex : current);
  }, [selectedIndex]);

  const focusPoint = useCallback((index: number) => {
    setFocusIndex(index);
    setActiveIndex(index);
    pointRefs.current[index]?.focus();
  }, []);

  const handlePointKeyDown = useCallback((
    event: React.KeyboardEvent<SVGCircleElement>,
    index: number,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPoint(index);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedIndex(null);
      setActiveIndex(null);
      return;
    }

    if (monthly.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % monthly.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + monthly.length) % monthly.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = monthly.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    focusPoint(nextIndex);
  }, [focusPoint, monthly.length, selectPoint]);

  const interactionStatus = displayedPoint && displayedValue !== null
    ? displayedPoint.label + ": " + compactEuro(displayedValue) + " (" + metricLabel + ")" +
      (selectedIndex === displayedIndex ? ", selezionato" : "") +
      ". Usa i tasti freccia per cambiare mese, Invio o Spazio per selezionare."
    : "Nessun mese selezionato. Usa Tab per entrare nel grafico.";

  return (
    <section className={styles.panel + " " + styles.trendPanel}>
      <div className={styles.panelHead}>
        <div><h2>Trend pagamenti comunali</h2><small className={styles.panelContext}>SIOPE · {period}</small></div>
        <div className={styles.segmented} role="group" aria-label="Metrica del trend">
          <button type="button" aria-pressed={metric === "cumulative"} onClick={() => setMetric("cumulative")}>Cumulato</button>
          <button type="button" aria-pressed={metric === "monthly"} onClick={() => setMetric("monthly")}>Mensile</button>
        </div>
      </div>
      <p className={styles.srOnly}>
        Andamento {metricLabel}. Valore massimo {compactEuro(maximum)}. {accessibleSeries}
      </p>
      <p className={styles.srOnly} role="status" aria-live="polite">{interactionStatus}</p>
      <svg
        className={styles.trendChart + " " + trendStyles.chart}
        viewBox="0 0 460 150"
        role="group"
        aria-label={
          "Pagamenti comunali SIOPE nel " + year + ", andamento " + metricLabel + ", " + period +
          ". " + accessibleSeries + ". Usa Tab per entrare nel grafico e i tasti freccia per esplorare i mesi."
        }
      >
        <title>Trend pagamenti comunali SIOPE</title>
        <desc>Serie temporale interattiva dei pagamenti comunali, con un punto per ogni mese disponibile.</desc>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c8ced9" stopOpacity=".55"/><stop offset="1" stopColor="#f7f8fa" stopOpacity=".1"/></linearGradient></defs>
        <path className={styles.trendGrid} d="M36 20H450 M36 72H450 M36 124H450" />
        <polygon className={styles.trendFill} fill={"url(#" + gradientId + ")"} points={"36,124 " + linePoints + " 450,124"} />
        <polyline className={styles.trendLine} points={linePoints} />
        {monthly.map((point, index) => {
          const pointValue = values[index] ?? 0;
          const isActive = activeIndex === index;
          const isSelected = selectedIndex === index;
          const isFocusable = safeFocusIndex === index;
          return (
            <g key={point.month}>
              <circle
                ref={(node) => {
                  pointRefs.current[index] = node;
                }}
                className={trendStyles.hitArea}
                cx={plotted[index].x}
                cy={plotted[index].y}
                r="30"
                role="button"
                tabIndex={isFocusable ? 0 : -1}
                aria-pressed={isSelected}
                aria-label={point.label + ": " + compactEuro(pointValue) + " (" + metricLabel + ")"}
                aria-describedby={displayedIndex === index ? tooltipId : undefined}
                data-active={isActive ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
                onPointerEnter={() => previewPoint(index)}
                onPointerLeave={() => clearPointPreview(index)}
                onPointerDown={() => selectPoint(index)}
                onFocus={() => previewPoint(index)}
                onBlur={() => clearPointPreview(index)}
                onClick={() => selectPoint(index)}
                onKeyDown={(event) => handlePointKeyDown(event, index)}
              />
              <circle
                className={trendStyles.point}
                cx={plotted[index].x}
                cy={plotted[index].y}
                r={isActive || isSelected ? 4.5 : 3}
                aria-hidden="true"
                data-active={isActive ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
              />
              <text
                className={isActive || isSelected ? trendStyles.activeLabel : undefined}
                x={plotted[index].x}
                y="143"
              >{point.label.slice(0, 3)}</text>
            </g>
          );
        })}
        {displayedPoint && displayedValue !== null && displayedCoordinates ? (
          <g
            id={tooltipId}
            className={trendStyles.tooltip}
            role="tooltip"
            transform={"translate(" + tooltipX + " " + tooltipY + ")"}
          >
            <rect width={tooltipWidth} height="34" rx="5" />
            <text className={trendStyles.tooltipMonth} x="8" y="13">{displayedPoint.label}</text>
            <text className={trendStyles.tooltipValue} x="8" y="27">{compactEuro(displayedValue)}</text>
          </g>
        ) : null}
        <text x="4" y="24">{compactEuro(maximum)}</text><text x="7" y="76">{compactEuro(maximum / 2)}</text><text x="25" y="128">0</text>
      </svg>
    </section>
  );
}
