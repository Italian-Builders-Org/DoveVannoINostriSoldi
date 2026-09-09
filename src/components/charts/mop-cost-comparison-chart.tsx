"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "./chart-data-table";
import styles from "./mop-cost-comparison-chart.module.css";

export type MopCostComparisonPoint = {
  label: string;
  plannedEuro: number;
  actualEuro: number;
};

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  useGrouping: "always",
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mila €`;
  }
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

/** Side-by-side MOP planned vs actual costs; same money family only. */
export function MopCostComparisonChart({
  points,
  ariaLabel,
  height = 280,
}: {
  points: readonly MopCostComparisonPoint[];
  ariaLabel: string;
  height?: number;
}) {
  const chartData = points.filter(
    (point) => point.plannedEuro > 0 || point.actualEuro > 0,
  );

  if (chartData.length === 0) {
    return (
      <div className={styles.empty}>
        Nessun importo MOP previsto o effettivo da confrontare su questa opera.
      </div>
    );
  }

  return (
    <figure className={styles.figure}>
      <div className={styles.chart} style={{ height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 16, bottom: 8, left: 4 }}
            barCategoryGap="18%"
            barGap={4}
          >
            <CartesianGrid horizontal={false} stroke="var(--color-neutral-300)" />
            <XAxis
              type="number"
              tickFormatter={(value: number) => compactEuro(value)}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-neutral-400)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={118}
              tick={{ fill: "var(--color-neutral-800)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--color-neutral-100)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className={styles.tooltip}>
                    <strong>{label}</strong>
                    {payload.map((entry) => (
                      <span key={String(entry.dataKey)}>
                        {entry.name}: {exactEuro.format(Number(entry.value ?? 0))}
                      </span>
                    ))}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="square"
              wrapperStyle={{ fontSize: 12, color: "var(--color-neutral-700)" }}
            />
            <Bar
              dataKey="plannedEuro"
              name="Previsto"
              fill="var(--color-neutral-700)"
              maxBarSize={18}
              radius={[0, 2, 2, 0]}
            />
            <Bar
              dataKey="actualEuro"
              name="Effettivo"
              fill="var(--chart-data-primary)"
              maxBarSize={18}
              radius={[0, 2, 2, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        label={ariaLabel}
        columns={["Previsto", "Effettivo"]}
        rows={chartData.map((point) => ({
          label: point.label,
          values: [exactEuro.format(point.plannedEuro), exactEuro.format(point.actualEuro)],
        }))}
      />
    </figure>
  );
}
