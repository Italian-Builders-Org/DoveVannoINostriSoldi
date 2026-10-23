"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./immobili-italia-2026.module.css";

export type PrelievoSeries = Readonly<{
  voice: string;
  points: ReadonlyArray<{ year: number; mld: number | null; sourceUrl: string }>;
}>;

const mldFormat = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

const SERIES_META: Record<string, { label: string; color: string }> = {
  "IMU di cui": { label: "IMU", color: "var(--color-accent-700)" },
  "Cedolare secca": { label: "Cedolare secca", color: "var(--color-neutral-700)" },
  "TASI di cui": { label: "TASI (fino al 2019)", color: "var(--color-neutral-400)" },
};

function formatMldCell(value: unknown): string {
  if (value === null || value === undefined) return "n.d.";
  if (typeof value !== "number" || !Number.isFinite(value)) return "n.d.";
  return mldFormat.format(value);
}

function TooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number | null; color?: string; name?: string }>;
  label?: number;
}) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className={styles.chartTooltip}>
      <strong>{label}</strong>
      <ul>
        {payload.map((entry) => (
          <li key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}:{" "}
            {entry.value === null || entry.value === undefined
              ? "n.d."
              : `${mldFormat.format(entry.value)} mld €`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PrelievoChart({ series }: { series: readonly PrelievoSeries[] }) {
  const years = [...new Set(series.flatMap((voice) => voice.points.map((point) => point.year)))].sort(
    (left, right) => left - right,
  );
  const data = years.map((year) => {
    const row: Record<string, number | null> = { year };
    for (const voice of series) {
      const point = voice.points.find((item) => item.year === year);
      const key = SERIES_META[voice.voice]?.label ?? voice.voice;
      if (point && point.mld !== null) {
        row[key] = point.mld;
      }
    }
    return row;
  });

  const displaySeries = series.map((voice) => ({
    ...voice,
    label: SERIES_META[voice.voice]?.label ?? voice.voice,
    color: SERIES_META[voice.voice]?.color ?? "var(--color-accent-700)",
  }));

  return (
    <figure className={styles.chartFigure} aria-labelledby="prelievo-chart-caption">
      <div
        className={styles.chart}
        role="img"
        aria-label="Prelievo fiscale sugli immobili in Italia 2015-2024, miliardi di euro"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 12, bottom: 8, left: 4 }} accessibilityLayer>
            <CartesianGrid stroke="var(--color-neutral-200)" strokeDasharray="4 6" vertical={false} />
            <XAxis
              dataKey="year"
              tickMargin={10}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 12 }}
              axisLine={{ stroke: "var(--color-neutral-300)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => mldFormat.format(Number(value))}
              width={44}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              unit=""
            />
            <Tooltip content={<TooltipContent />} />
            <Legend wrapperStyle={{ paddingTop: 8 }} />
            {displaySeries.map((voice) => (
              <Line
                key={voice.voice}
                type="monotone"
                name={voice.label}
                dataKey={voice.label}
                stroke={voice.color}
                dot={{ r: 3.5, fill: voice.color, stroke: "var(--color-raised)", strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: voice.color, stroke: "var(--color-raised)", strokeWidth: 2 }}
                strokeWidth={voice.voice === "IMU di cui" ? 3 : 2}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption id="prelievo-chart-caption">
        Tabella 4.4 AdE · gettito nazionale in miliardi di euro (non cassa del singolo Comune).{" "}
        <a href="https://www1.finanze.gov.it/finanze/immobili/public/api/api.php/get_table?id=2026_04_01_05&amp;cq=1">
          Fonte ufficiale ↗
        </a>
      </figcaption>
      <ChartDataTable
        label="Serie prelievo 2015-2024 (mld €)"
        columns={displaySeries.map((voice) => voice.label)}
        rows={data.map((row) => ({
          label: String(row.year),
          values: displaySeries.map((voice) => formatMldCell(row[voice.label])),
        }))}
      />
    </figure>
  );
}
