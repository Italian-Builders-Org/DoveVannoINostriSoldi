"use client";

import {
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
import styles from "./home-monthly-chart.module.css";

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function compactEuro(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld`;
  }
  return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln`;
}

function TooltipCard({ point }: { point: SiopeMunicipalMonthlyPoint }) {
  return (
    <div className={styles.tooltip}>
      <span>{point.label}</span>
      <strong>Pagamenti di cassa del mese</strong>
      <b>{exactEuro.format(point.flow)}</b>
    </div>
  );
}

export function HomeMonthlyChart({ data }: { data: SiopeMunicipalMonthlyPoint[] }) {
  if (data.length === 0) {
    return <div className={styles.empty}>Serie mensile SIOPE non disponibile.</div>;
  }

  return (
    <>
      <div
        className={styles.chart}
        role="img"
        aria-label="Pagamenti mensili di cassa dei Comuni italiani registrati in SIOPE"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
          >
            <CartesianGrid vertical={false} stroke="rgba(145, 174, 192, 0.12)" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#8fa6b3", fontSize: 11 }}
              tickFormatter={(label: string) => label.slice(0, 3)}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={58}
              tick={{ fill: "#8fa6b3", fontSize: 11 }}
              tickFormatter={compactEuro}
            />
            <Tooltip
              cursor={{ fill: "rgba(255, 255, 255, 0.025)" }}
              animationDuration={120}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as SiopeMunicipalMonthlyPoint | undefined;
                return point ? <TooltipCard point={point} /> : null;
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

      <div className={styles.srOnly}>
        <table>
          <caption>Valori mensili esatti dei pagamenti di cassa SIOPE dei Comuni</caption>
          <thead><tr><th>Mese</th><th>Pagamenti</th></tr></thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.month}><th>{point.label}</th><td>{exactEuro.format(point.flow)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
