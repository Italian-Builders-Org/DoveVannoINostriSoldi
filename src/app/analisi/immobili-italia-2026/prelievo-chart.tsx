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
  points: ReadonlyArray<{ year: number; mld: number; sourceUrl: string }>;
}>;

const mldFormat = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: number;
}) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className={styles.chartTooltip}>
      <strong>{label}</strong>
      <ul>
        {payload.map((entry) => (
          <li key={entry.dataKey} style={{ color: entry.color }}>
            {entry.dataKey}: {mldFormat.format(entry.value ?? 0)} mld €
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PrelievoChart({ series }: { series: readonly PrelievoSeries[] }) {
  const years = series[0]?.points.map((point) => point.year) ?? [];
  const data = years.map((year) => {
    const row: Record<string, number | string> = { year };
    for (const voice of series) {
      const point = voice.points.find((item) => item.year === year);
      if (point) row[voice.voice] = point.mld;
    }
    return row;
  });

  return (
    <figure className={styles.chartFigure} aria-labelledby="prelievo-chart-caption">
      <div className={styles.chart} role="img" aria-label="Prelievo fiscale sugli immobili in Italia 2015-2024, miliardi di euro">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 0 }} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" tickMargin={8} />
            <YAxis tickFormatter={(value) => mldFormat.format(Number(value))} width={48} />
            <Tooltip content={<TooltipContent />} />
            <Legend />
            {series.map((voice) => (
              <Line
                key={voice.voice}
                type="monotone"
                dataKey={voice.voice}
                dot={{ r: 3 }}
                strokeWidth={2}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption id="prelievo-chart-caption">
        Tabella 4.4 · gettito/prelievo pubblicato da AdE (mld €), non cassa comunale.{" "}
        <a href="https://www1.finanze.gov.it/finanze/immobili/public/api/api.php/get_table?id=2026_04_01_05&amp;cq=1">
          Fonte ufficiale ↗
        </a>
      </figcaption>
      <ChartDataTable
        label="Serie prelievo 2015-2024 (mld €)"
        columns={series.map((voice) => voice.voice)}
        rows={data.map((row) => ({
          label: String(row.year),
          values: series.map((voice) => mldFormat.format(Number(row[voice.voice] ?? 0))),
        }))}
      />
    </figure>
  );
}
