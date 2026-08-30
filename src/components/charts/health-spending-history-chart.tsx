"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compactEuro, exactEuro } from "@/lib/format";
import type { SsnNationalHistoryYear } from "@/lib/ssn-national-history";
import styles from "./health-spending-history-chart.module.css";

export type HealthSpendingChartSeriesKey =
  | "productionCosts"
  | "purchasedServices"
  | "personnelCost"
  | "healthcareWorkServices"
  | "nonHealthcareWorkServices";

export type HealthSpendingSeriesMeta = {
  key: HealthSpendingChartSeriesKey;
  label: string;
  shortLabel: string;
  code: string;
  colorVar: string;
  strokeWidth: number;
  strokeDasharray?: string;
  lineClass: string;
};

export const HEALTH_SPENDING_SERIES: readonly HealthSpendingSeriesMeta[] = [
  {
    key: "productionCosts",
    label: "Totale costi della produzione",
    shortLabel: "Totale costi produzione",
    code: "BZ9999",
    colorVar: "var(--chart-primary)",
    strokeWidth: 2.5,
    lineClass: styles.lineProductionCosts,
  },
  {
    key: "purchasedServices",
    label: "Acquisti di servizi",
    shortLabel: "Acquisti servizi",
    code: "BA0390",
    colorVar: "var(--chart-secondary)",
    strokeWidth: 2,
    lineClass: styles.linePurchasedServices,
  },
  {
    key: "personnelCost",
    label: "Costo del personale",
    shortLabel: "Costo personale",
    code: "BA2080",
    colorVar: "var(--chart-tertiary)",
    strokeWidth: 2,
    lineClass: styles.linePersonnelCost,
  },
  {
    key: "healthcareWorkServices",
    label: "Prestazioni di lavoro sanitarie",
    shortLabel: "Prestazioni sanitarie",
    code: "BA1350",
    colorVar: "var(--color-accent-600)",
    strokeWidth: 1.5,
    lineClass: styles.lineHealthcareWorkServices,
  },
  {
    key: "nonHealthcareWorkServices",
    label: "Prestazioni di lavoro non sanitarie",
    shortLabel: "Prestazioni non sanitarie",
    code: "BA1750",
    colorVar: "var(--chart-quaternary)",
    strokeWidth: 1.5,
    strokeDasharray: "4 4",
    lineClass: styles.lineNonHealthcareWorkServices,
  },
] as const;

type ChartPoint = {
  year: number;
  productionCosts: number;
  purchasedServices: number;
  personnelCost: number;
  healthcareWorkServices: number;
  nonHealthcareWorkServices: number;
};

function formatAxisEuro(value: number): string {
  if (value === 0) return "0 €";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
  }
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

function TooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHeader}>
        <strong>Anno {point.year}</strong>
        <span>{compactEuro(point.productionCosts)}</span>
      </div>
      <ul className={styles.tooltipList}>
        {HEALTH_SPENDING_SERIES.map((series) => (
          <li key={series.key} className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>
              <i className={`${styles.swatch} ${series.lineClass}`} aria-hidden="true" />
              <span>
                {series.shortLabel} <code>{series.code}</code>
              </span>
            </span>
            <span className={styles.tooltipValue}>
              <b>{compactEuro(point[series.key])}</b>
              <small>{exactEuro(point[series.key])}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HealthSpendingHistoryChart({
  data,
}: {
  data: readonly SsnNationalHistoryYear[];
}) {
  if (!data || data.length === 0) {
    return <div className={styles.empty}>Serie storica della spesa sanitaria non disponibile.</div>;
  }

  const chartData: ChartPoint[] = data.map((entry) => ({
    year: entry.year,
    productionCosts: entry.values.productionCosts / 100,
    purchasedServices: entry.values.purchasedServices / 100,
    personnelCost: entry.values.personnelCost / 100,
    healthcareWorkServices: entry.values.healthcareWorkServices / 100,
    nonHealthcareWorkServices: entry.values.nonHealthcareWorkServices / 100,
  }));

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label="Serie storica della spesa sanitaria nazionale 2012-2024 per voce contabile"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 12, right: 16, bottom: 4, left: 4 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={76}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              tickFormatter={formatAxisEuro}
            />
            <Tooltip
              animationDuration={120}
              cursor={{ stroke: "var(--color-neutral-400)" }}
              content={<TooltipContent />}
            />
            {HEALTH_SPENDING_SERIES.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                stroke={series.colorVar}
                strokeWidth={series.strokeWidth}
                strokeDasharray={series.strokeDasharray}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: series.colorVar,
                  stroke: "var(--color-raised)",
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.legend} aria-label="Legenda delle voci contabili">
        {HEALTH_SPENDING_SERIES.map((series) => (
          <span key={series.key} className={styles.legendItem}>
            <i
              className={`${styles.legendLine} ${series.lineClass} ${
                series.strokeDasharray ? styles.dashed : ""
              }`}
              aria-hidden="true"
            />
            <span className={styles.legendLabel}>
              {series.label} <code>{series.code}</code>
            </span>
          </span>
        ))}
      </div>

      <figcaption className={styles.caption}>
        Valori nominali a consuntivo in euro di competenza economica del Conto Economico SSN
        (OpenBDAP RGS). La serie non è corretta per l&apos;inflazione e non misura efficienza,
        qualità dell&apos;assistenza o dotazioni organiche. Le voci con importi più contenuti possono
        risultare meno leggibili nella scala comune: tooltip e tabella riportano i valori puntuali.
      </figcaption>
    </figure>
  );
}
