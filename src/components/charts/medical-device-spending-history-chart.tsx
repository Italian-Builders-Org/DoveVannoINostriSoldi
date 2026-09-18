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
import { ChartDataTable } from "./chart-data-table";
import styles from "./medical-device-spending-history-chart.module.css";

export type MedicalDeviceSpendingHistoryPoint = Readonly<{
  year: number;
  spending: string;
}>;

type ChartPoint = MedicalDeviceSpendingHistoryPoint & Readonly<{ value: number }>;

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

function exactEuro(value: string): string {
  const negative = value.startsWith("-");
  const [whole, cents] = (negative ? value.slice(1) : value).split(".");
  return `${negative ? "−" : ""}${BigInt(whole).toLocaleString("it-IT")},${cents} €`;
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
      <span>Anno {point.year}</span>
      <strong>Spesa rilevata</strong>
      <b>{exactEuro(point.spending)}</b>
    </div>
  );
}

export function MedicalDeviceSpendingHistoryChart({
  data,
}: {
  data: readonly MedicalDeviceSpendingHistoryPoint[];
}) {
  const chartData: ChartPoint[] = data.map((point) => ({
    ...point,
    value: Number(point.spending),
  }));

  if (chartData.length === 0) {
    return <div className={styles.empty}>Serie annuale non disponibile.</div>;
  }

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label={`Spesa nazionale rilevata per dispositivi medici dal ${chartData[0]?.year} al ${chartData.at(-1)?.year}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 12, right: 20, bottom: 4, left: 4 }}
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
              width={72}
              domain={[0, "auto"]}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              tickFormatter={compactEuro}
            />
            <Tooltip
              content={<TooltipContent />}
              cursor={{ stroke: "var(--color-neutral-400)" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--chart-primary)"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "var(--chart-primary)", strokeWidth: 0 }}
              activeDot={{
                r: 4,
                fill: "var(--chart-primary)",
                stroke: "var(--color-raised)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        Euro correnti. Il dato misura la spesa sostenuta dalle aziende sanitarie nel perimetro pubblicato dal Ministero della Salute.
      </figcaption>
      <ChartDataTable
        label="Spesa nazionale rilevata per dispositivi medici"
        columns={["Spesa rilevata"]}
        rows={chartData.map((point) => ({
          label: String(point.year),
          values: [exactEuro(point.spending)],
        }))}
      />
    </figure>
  );
}
