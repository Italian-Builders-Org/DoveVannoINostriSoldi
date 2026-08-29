"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import type { ReportFigure, ReportValue } from "@/lib/monthly-reports-contract";
import styles from "./monthly-report.module.css";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function numericValue(value: ReportValue): number {
  if (value.kind === "count") return value.value;
  if (value.kind === "money") return value.cents / 100;
  if (value.kind === "percentage") return value.basisPoints / 100;
  if (value.kind === "ratio") return Number(value.decimal);
  return Number.NaN;
}

export function formatReportValue(value: ReportValue): string {
  if (value.kind === "count") return `${integer.format(value.value)} ${value.unit}`;
  if (value.kind === "money") return money.format(value.cents / 100);
  if (value.kind === "percentage") return `${(value.basisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
  if (value.kind === "ratio") return `${Number(value.decimal).toLocaleString("it-IT")} ${value.unit}`;
  return value.text;
}

export function MonthlyReportFigure({ figure }: { figure: ReportFigure }) {
  const visualSeries = figure.series.find((series) => series.id === figure.visualSeriesId)!;
  const chartData = figure.rows.map((row) => ({
    key: row.key,
    label: row.label,
    value: numericValue(row.values[figure.visualSeriesId]!),
    formatted: formatReportValue(row.values[figure.visualSeriesId]!),
  }));

  return (
    <figure className={styles.figure} aria-labelledby={`${figure.id}-title`}>
      <h2 id={`${figure.id}-title`}>{figure.title}</h2>
      <p className={styles.takeaway}>{figure.takeaway}</p>
      <p className="sr-only">{figure.accessibleSummary}</p>
      <div
        className={figure.kind === "ranked-bars" ? styles.rankingChart : styles.timelineChart}
        role="img"
        aria-label={figure.accessibleSummary}
      >
        <ResponsiveContainer width="100%" height="100%">
          {figure.kind === "time-series" ? (
            <LineChart data={chartData} margin={{ top: 16, right: 18, bottom: 8, left: 18 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tickFormatter={(value) => integer.format(Number(value))} tickLine={false} axisLine={false} width={82} domain={["dataMin", "dataMax"]} />
              <Tooltip isAnimationActive={false} formatter={(_, __, item) => [item.payload.formatted, visualSeries.label]} />
              <Line dataKey="value" type="monotone" stroke="var(--chart-primary)" strokeWidth={3} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 8 }} accessibilityLayer>
              <CartesianGrid horizontal={false} stroke="var(--color-neutral-300)" />
              <XAxis type="number" tickFormatter={(value) => integer.format(Number(value))} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={128} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
              <ReferenceLine x={0} stroke="var(--color-neutral-700)" />
              <Tooltip isAnimationActive={false} formatter={(_, __, item) => [item.payload.formatted, visualSeries.label]} />
              <Bar dataKey="value" fill="var(--chart-primary)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <figcaption>
        {figure.caveat} Perimetro: {figure.perimeter}
        {figure.denominator ? ` Denominatore: ${figure.denominator}.` : ""}
      </figcaption>
      <ChartDataTable
        label={figure.title}
        columns={figure.series.map((series) => series.label)}
        rows={figure.rows.map((row) => ({
          label: row.label,
          values: figure.series.map((series) => formatReportValue(row.values[series.id]!)),
        }))}
      />
    </figure>
  );
}
