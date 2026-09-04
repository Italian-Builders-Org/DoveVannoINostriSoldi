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
  panel: "primary" | "workServices";
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
    panel: "primary",
  },
  {
    key: "purchasedServices",
    label: "Acquisti di servizi",
    shortLabel: "Acquisti servizi",
    code: "BA0390",
    colorVar: "var(--chart-secondary)",
    strokeWidth: 2,
    lineClass: styles.linePurchasedServices,
    panel: "primary",
  },
  {
    key: "personnelCost",
    label: "Costo del personale",
    shortLabel: "Costo personale",
    code: "BA2080",
    colorVar: "var(--chart-tertiary)",
    strokeWidth: 2,
    lineClass: styles.linePersonnelCost,
    panel: "primary",
  },
  {
    key: "healthcareWorkServices",
    label: "Prestazioni di lavoro sanitarie",
    shortLabel: "Prestazioni sanitarie",
    code: "BA1350",
    colorVar: "var(--color-accent-600)",
    strokeWidth: 2,
    lineClass: styles.lineHealthcareWorkServices,
    panel: "workServices",
  },
  {
    key: "nonHealthcareWorkServices",
    label: "Prestazioni di lavoro non sanitarie",
    shortLabel: "Prestazioni non sanitarie",
    code: "BA1750",
    colorVar: "var(--chart-quaternary)",
    strokeWidth: 2,
    strokeDasharray: "4 4",
    lineClass: styles.lineNonHealthcareWorkServices,
    panel: "workServices",
  },
] as const;

export const PRIMARY_SERIES = HEALTH_SPENDING_SERIES.filter(
  (series) => series.panel === "primary",
);

export const WORK_SERVICES_SERIES = HEALTH_SPENDING_SERIES.filter(
  (series) => series.panel === "workServices",
);

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
    const num = value / 1_000_000_000;
    const formatted = num.toLocaleString("it-IT", {
      minimumFractionDigits: Number.isInteger(num) ? 0 : 1,
      maximumFractionDigits: 1,
    });
    return `${formatted} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
  }
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

function TooltipContent({
  active,
  payload,
  seriesList,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  seriesList: readonly HealthSpendingSeriesMeta[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHeader}>
        <strong>Anno {point.year}</strong>
      </div>
      <ul className={styles.tooltipList}>
        {seriesList.map((series) => (
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

function Legend({
  seriesList,
  label,
}: {
  seriesList: readonly HealthSpendingSeriesMeta[];
  label: string;
}) {
  return (
    <div className={styles.legend} role="group" aria-label={label}>
      {seriesList.map((series) => (
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
    <div className={styles.container}>
      <div className={styles.grid}>
        {/* Pannello 1: Grandi aggregati della spesa (scala in miliardi di euro) */}
        <figure className={styles.panelCard}>
          <div className={styles.panelHeader}>
            <span className={styles.panelCategory}>GRANDI AGGREGATI</span>
            <h3 className={styles.panelTitle}>Totale produzione, servizi e personale</h3>
            <span className={styles.panelScaleBadge}>Scala assoluta da zero · mld €</span>
          </div>

          <div
            className={styles.chart}
            role="img"
            aria-label="Serie storica 2012-2024 dei grandi aggregati: totale costi di produzione, acquisti di servizi e costo del personale"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                syncId="ssn-national-history"
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
                  domain={[0, "auto"]}
                  tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                  tickFormatter={formatAxisEuro}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: "var(--color-neutral-400)" }}
                  content={<TooltipContent seriesList={PRIMARY_SERIES} />}
                />
                {PRIMARY_SERIES.map((series) => (
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

          <Legend seriesList={PRIMARY_SERIES} label="Legenda dei grandi aggregati contabili" />

          <figcaption className={styles.panelCaption}>
            Voci macro-economiche del Conto Economico SSN. Mostra l&apos;evoluzione complessiva dei costi di produzione (BZ9999), degli acquisti di servizi (BA0390) e del personale dipendente (BA2080).
          </figcaption>
        </figure>

        {/* Pannello 2: Prestazioni di lavoro e consulenze (scala dedicata) */}
        <figure className={styles.panelCard}>
          <div className={styles.panelHeader}>
            <span className={styles.panelCategory}>PRESTAZIONI DI LAVORO</span>
            <h3 className={styles.panelTitle}>Consulenze, collaborazioni e interinale</h3>
            <span className={styles.panelScaleBadge}>Scala dedicata da zero · mln € / mld €</span>
          </div>

          <div
            className={styles.chart}
            role="img"
            aria-label="Serie storica 2012-2024 delle prestazioni di lavoro: consulenze, collaborazioni e lavoro interinale sanitarie e non sanitarie"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                syncId="ssn-national-history"
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
                  domain={[0, "auto"]}
                  tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                  tickFormatter={formatAxisEuro}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: "var(--color-neutral-400)" }}
                  content={<TooltipContent seriesList={WORK_SERVICES_SERIES} />}
                />
                {WORK_SERVICES_SERIES.map((series) => (
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

          <Legend seriesList={WORK_SERVICES_SERIES} label="Legenda delle prestazioni di lavoro" />

          <figcaption className={styles.panelCaption}>
            Voci relative a prestazioni sanitarie (BA1350) e non sanitarie (BA1750). La scala autonoma rende leggibili le variazioni senza schiacciamento visivo né un doppio asse fuorviante.
          </figcaption>
        </figure>
      </div>

      <p className={styles.overallCaption}>
        Valori nominali a consuntivo in euro di competenza economica del Conto Economico SSN
        (OpenBDAP RGS). La serie è presentata su due grafici a scala separata per consentire il
        confronto simultaneo sia dei grandi aggregati sia delle prestazioni di lavoro, evitando
        le distorsioni di scala di un asse unico o di un doppio asse. La serie non è corretta per
        l&apos;inflazione e non misura efficienza, qualità dell&apos;assistenza o dotazioni organiche.
      </p>
    </div>
  );
}
