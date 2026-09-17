"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./public-debt-history-chart.module.css";

type Point = { referenceDate: string; totalCents: number };
const exact = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" });
const month = new Intl.DateTimeFormat("it-IT", { month: "short", year: "2-digit", timeZone: "UTC" });

export function PublicDebtHistoryChart({ data }: { data: Point[] }) {
  const points = data.map((point) => ({ ...point, euro: point.totalCents / 100, label: month.format(new Date(`${point.referenceDate}T00:00:00Z`)) }));
  return <figure className={styles.figure}>
    <div className={styles.chart} role="img" aria-label="Andamento del debito pubblico negli ultimi tredici mesi">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 16, right: 16, left: 8, bottom: 4 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }} />
          <YAxis domain={["dataMin", "dataMax"]} tickFormatter={(value) => `${(value / 1_000_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} mila mld`} width={82} axisLine={false} tickLine={false} tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }} />
          <Tooltip isAnimationActive={false} formatter={(value) => [exact.format(Number(value)), "Debito"]} labelFormatter={(label) => String(label)} />
          <Line type="monotone" dataKey="euro" stroke="var(--chart-primary)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <figcaption>Debito lordo della PA a fine mese. L’asse parte dal minimo osservato, non da zero.</figcaption>
    <ChartDataTable label="Debito pubblico mensile" columns={["Debito convertito in euro"]} rows={points.map((point) => ({ label: point.label, values: [exact.format(point.euro)] }))} />
  </figure>;
}
