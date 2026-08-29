"use client";

import { useMemo, useState } from "react";
import { compactEuro } from "@/lib/format";
import type { SiopeMunicipalMonthlyPoint } from "@/lib/siope-snapshot";
import styles from "@/app/home.module.css";

type TrendMetric = "cumulative" | "monthly";

function chartPoints(values: readonly number[]): Array<{ x: number; y: number }> {
  const maximum = Math.max(...values, 1);
  return values.map((value, index) => ({
    x: 36 + (index / Math.max(values.length - 1, 1)) * 414,
    y: 124 - (value / maximum) * 104,
  }));
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
  const values = useMemo(
    () => monthly.map((point) => metric === "cumulative" ? point.cumulative : point.flow),
    [metric, monthly],
  );
  const plotted = chartPoints(values);
  const maximum = Math.max(...values, 0);
  const linePoints = plotted.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const metricLabel = metric === "cumulative" ? "cumulato" : "mensile";
  const accessibleSeries = monthly
    .map((point, index) => `${point.label}: ${compactEuro(values[index] ?? 0)}`)
    .join("; ");

  return (
    <section className={`${styles.panel} ${styles.trendPanel}`}>
      <div className={styles.panelHead}>
        <div><h2>Trend pagamenti comunali</h2><small className={styles.panelContext}>SIOPE · {period}</small></div>
        <div className={styles.segmented} role="group" aria-label="Metrica del trend">
          <button type="button" aria-pressed={metric === "cumulative"} onClick={() => setMetric("cumulative")}>Cumulato</button>
          <button type="button" aria-pressed={metric === "monthly"} onClick={() => setMetric("monthly")}>Mensile</button>
        </div>
      </div>
      <p className={styles.srOnly} role="status" aria-live="polite">
        Andamento {metricLabel}. Valore massimo {compactEuro(maximum)}. {accessibleSeries}
      </p>
      <svg className={styles.trendChart} viewBox="0 0 460 150" role="img" aria-label={`Pagamenti comunali SIOPE nel ${year}, andamento ${metricLabel}, ${period}. ${accessibleSeries}`}>
        <defs><linearGradient id="home-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c8ced9" stopOpacity=".55"/><stop offset="1" stopColor="#f7f8fa" stopOpacity=".1"/></linearGradient></defs>
        <path className={styles.trendGrid} d="M36 20H450 M36 72H450 M36 124H450" />
        <polygon className={styles.trendFill} points={`36,124 ${linePoints} 450,124`} />
        <polyline className={styles.trendLine} points={linePoints} />
        {monthly.map((point, index) => <g key={point.month}><circle cx={plotted[index].x} cy={plotted[index].y} r="3"/><text x={plotted[index].x} y="143">{point.label.slice(0, 3)}</text></g>)}
        <text x="4" y="24">{compactEuro(maximum)}</text><text x="7" y="76">{compactEuro(maximum / 2)}</text><text x="25" y="128">0</text>
      </svg>
    </section>
  );
}
