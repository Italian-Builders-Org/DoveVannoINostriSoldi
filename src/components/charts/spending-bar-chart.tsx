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
import styles from "./spending-bar-chart.module.css";
import { chartColor } from "@/lib/chart-colors";

export type SpendingChartPoint = {
  label: string;
  value: number;
  code?: string | null;
};

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
  if (absolute >= 1_000) return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mila €`;
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

function shortLabel(label: string, maxLength = 38): string {
  const normalized = label
    .toLocaleLowerCase("it-IT")
    .replace(/(^|[.!?]\s+)([a-zà-ú])/g, (match) => match.toLocaleUpperCase("it-IT"));

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
    : normalized;
}

export function SpendingBarChart({
  data,
  ariaLabel,
  maxItems = 10,
  height = 420,
}: {
  data: SpendingChartPoint[];
  ariaLabel: string;
  maxItems?: number;
  height?: number;
}) {
  const chartData = data.slice(0, maxItems).map((point) => ({
    ...point,
    axisLabel: shortLabel(point.label),
  }));

  if (chartData.length === 0) {
    return <div className={styles.empty}>Dati non disponibili per questa dimensione.</div>;
  }

  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 20, bottom: 5, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="rgba(145, 174, 192, 0.12)" />
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#8198a6", fontSize: 11 }}
              tickFormatter={compactEuro}
            />
            <YAxis
              dataKey="axisLabel"
              type="category"
              axisLine={false}
              tickLine={false}
              width={205}
              tick={{ fill: "#b8c8d0", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.022)" }}
              animationDuration={120}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as SpendingChartPoint | undefined;
                if (!point) return null;

                return (
                  <div className={styles.tooltip}>
                    {point.code && <span className={styles.code}>{point.code}</span>}
                    <strong>{point.label}</strong>
                    <b>{exactEuro.format(point.value)}</b>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
            >
              {chartData.map((point, index) => (
                <Cell key={`${point.code ?? point.label}-${index}`} fill={chartColor(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
