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
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { percent } from "@/lib/format";
import styles from "./education-trend-chart.module.css";

type EducationTrendPoint = Readonly<{
  period: string;
  periodLabel: string;
  value: number | null;
  femaleCount: number | null;
}>;

type ChartPoint = EducationTrendPoint & { students: number | null };

const exactStudents = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

function compactStudents(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mila`;
  }
  return exactStudents.format(value);
}

function exactStudentLabel(value: number | null): string {
  return value === null ? "n.d." : `${exactStudents.format(value)} studenti`;
}

function femaleLabel(point: EducationTrendPoint): string {
  if (point.femaleCount === null || point.value === null || point.value === 0) return "n.d.";
  const share = (point.femaleCount / point.value) * 100;
  return `${exactStudents.format(point.femaleCount)} (${percent(share)})`;
}

function periodRangeLabel(points: readonly EducationTrendPoint[]): string {
  const first = points[0]?.periodLabel;
  const last = points.at(-1)?.periodLabel;
  if (!first || !last) return "per gli anni disponibili";
  if (first === last) return `nell'anno scolastico ${first}`;
  return `dal ${first} al ${last}`;
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
      <strong>{point.periodLabel}</strong>
      <dl>
        <div>
          <dt>Studenti osservati</dt>
          <dd>{exactStudentLabel(point.value)}</dd>
        </div>
        <div>
          <dt>Ragazze</dt>
          <dd>{femaleLabel(point)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function EducationTrendChart({
  data,
}: {
  data: readonly EducationTrendPoint[];
}) {
  const chartData: ChartPoint[] = data.map((point) => ({
    ...point,
    students: point.value,
  }));
  const periodRange = periodRangeLabel(chartData);

  if (!chartData.some((point) => point.value !== null)) {
    return <div className={styles.empty}>Trend non disponibile per il perimetro selezionato.</div>;
  }

  return (
    <figure className={styles.figure} aria-labelledby="education-trend-chart-title">
      <div className={styles.chart} role="img" aria-label={`Studenti osservati per anno scolastico ${periodRange}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis
              dataKey="periodLabel"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={62}
              domain={[0, "auto"]}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              tickFormatter={compactStudents}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--color-neutral-400)" }}
              content={<TooltipContent />}
            />
            <Line
              type="monotone"
              dataKey="students"
              stroke="var(--chart-primary)"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "var(--chart-primary)", stroke: "var(--color-raised)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "var(--chart-primary)", stroke: "var(--color-raised)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption id="education-trend-chart-title">
        Studenti osservati nel perimetro selezionato. Il confronto descrive la serie pubblicata dal MIM, non un andamento della qualità scolastica.
      </figcaption>
      <ChartDataTable
        label="Trend degli studenti osservati per anno scolastico"
        columns={["Studenti osservati", "Ragazze"]}
        rows={chartData.map((point) => ({
          label: point.periodLabel,
          values: [exactStudentLabel(point.value), femaleLabel(point)],
        }))}
      />
    </figure>
  );
}
