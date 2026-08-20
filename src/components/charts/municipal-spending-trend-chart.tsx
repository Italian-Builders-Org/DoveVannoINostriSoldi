"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SiopeMunicipalMonthlyPoint } from "@/lib/siope-snapshot";
import { chartColor } from "@/lib/chart-colors";
import styles from "./municipal-spending-trend-chart.module.css";

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
  }
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

function TooltipCard({
  point,
  mode,
}: {
  point: SiopeMunicipalMonthlyPoint;
  mode: "flow" | "cumulative";
}) {
  return (
    <div className={styles.tooltip}>
      <span>{point.label}</span>
      <strong>{mode === "flow" ? "Pagamenti del mese" : "Totale da gennaio"}</strong>
      <b>{exactEuro.format(mode === "flow" ? point.flow : point.cumulative)}</b>
    </div>
  );
}

export function MunicipalSpendingTrendChart({
  data,
}: {
  data: SiopeMunicipalMonthlyPoint[];
}) {
  if (data.length === 0) {
    return <div className={styles.empty}>Serie SIOPE non disponibile.</div>;
  }

  return (
    <div className={styles.grid}>
      <figure className={styles.figure}>
        <div className={styles.figureHeader}>
          <div>
            <span>FLUSSO DI CASSA</span>
            <h3>Pagamenti effettivi per mese</h3>
          </div>
          <b>dato SIOPE diretto</b>
        </div>
        <div
          className={styles.chart}
          role="img"
          aria-label="Pagamenti mensili SIOPE dei Comuni italiani"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              accessibilityLayer
              data={data}
              margin={{ top: 8, right: 14, bottom: 0, left: 4 }}
            >
              <CartesianGrid vertical={false} stroke="rgba(145, 174, 192, 0.12)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#829aa8", fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={74}
                tick={{ fill: "#829aa8", fontSize: 11 }}
                tickFormatter={compactEuro}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.025)" }}
                animationDuration={120}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as SiopeMunicipalMonthlyPoint | undefined;
                  return point ? <TooltipCard point={point} mode="flow" /> : null;
                }}
              />
              <Bar
                dataKey="flow"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              >
                {data.map((point, index) => (
                  <Cell key={point.month} fill={chartColor(index)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <figcaption>
          SIOPE pubblica direttamente i movimenti di ogni mese. Non dobbiamo stimarli.
        </figcaption>
      </figure>

      <figure className={styles.figure}>
        <div className={styles.figureHeader}>
          <div>
            <span>PROGRESSIONE ANNUALE</span>
            <h3>Totale dei pagamenti da gennaio</h3>
          </div>
          <b>somma dei flussi</b>
        </div>
        <div
          className={styles.chart}
          role="img"
          aria-label="Pagamenti SIOPE cumulati da gennaio dei Comuni italiani"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer
              data={data}
              margin={{ top: 8, right: 14, bottom: 0, left: 4 }}
            >
              <CartesianGrid vertical={false} stroke="rgba(145, 174, 192, 0.12)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#829aa8", fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={74}
                tick={{ fill: "#829aa8", fontSize: 11 }}
                tickFormatter={compactEuro}
              />
              <Tooltip
                cursor={{ stroke: "rgba(171, 204, 221, 0.24)" }}
                animationDuration={120}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as SiopeMunicipalMonthlyPoint | undefined;
                  return point ? <TooltipCard point={point} mode="cumulative" /> : null;
                }}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="var(--chart-primary)"
                strokeWidth={2}
                fill="var(--chart-primary)"
                fillOpacity={0.1}
                isAnimationActive={false}
                activeDot={{
                  r: 4,
                  fill: "var(--chart-primary)",
                  stroke: "#071827",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <figcaption>
          Il totale cresce sommando, mese dopo mese, i movimenti ufficiali.
        </figcaption>
      </figure>
    </div>
  );
}
