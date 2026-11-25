"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartDataTable } from "@/components/charts/chart-data-table";

import styles from "./indennita.module.css";

export type IndemnityWagesChartRow = {
  year: number;
  indemnityNominal: number;
  contractualNominal: number;
  prices: number;
  indemnityReal: number;
  contractualReal: number;
};

type Mode = "nominal" | "real";

const index = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const SERIES = {
  nominal: [
    { key: "indemnityNominal", label: "Indennità lorda dei deputati", color: "var(--chart-primary)", dash: undefined },
    { key: "contractualNominal", label: "Retribuzioni contrattuali", color: "var(--chart-category-amber)", dash: "6 4" },
    { key: "prices", label: "Prezzi al consumo (FOI)", color: "var(--chart-tertiary)", dash: "2 4" },
  ],
  real: [
    { key: "indemnityReal", label: "Indennità lorda dei deputati", color: "var(--chart-primary)", dash: undefined },
    { key: "contractualReal", label: "Retribuzioni contrattuali", color: "var(--chart-category-amber)", dash: "6 4" },
  ],
} as const;

export function IndemnityWagesChart({ rows, baseYear }: { rows: readonly IndemnityWagesChartRow[]; baseYear: number }) {
  const [mode, setMode] = useState<Mode>("nominal");
  const series = SERIES[mode];
  const last = rows.at(-1)!;
  const summary = mode === "nominal"
    ? `Dal ${baseYear} al ${last.year}, con ${baseYear} uguale a 100: indennità ${index.format(last.indemnityNominal)}, retribuzioni contrattuali ${index.format(last.contractualNominal)}, prezzi ${index.format(last.prices)}.`
    : `Dal ${baseYear} al ${last.year}, al netto dei prezzi e con ${baseYear} uguale a 100: indennità ${index.format(last.indemnityReal)}, retribuzioni contrattuali ${index.format(last.contractualReal)}.`;

  return (
    <figure className={styles.figure}>
      <div className={styles.modeControl} role="group" aria-label="Valori del grafico">
        <button type="button" aria-pressed={mode === "nominal"} onClick={() => setMode("nominal")}>Valori nominali</button>
        <button type="button" aria-pressed={mode === "real"} onClick={() => setMode("real")}>Al netto dei prezzi</button>
      </div>
      <div className={styles.chart} role="img" aria-label={summary} data-chart-mode={mode}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows as IndemnityWagesChartRow[]} margin={{ top: 12, right: 16, left: 0, bottom: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis domain={["auto", "auto"]} width={40} axisLine={false} tickLine={false} tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }} tickFormatter={(value) => String(Math.round(Number(value)))} />
            <ReferenceLine y={100} stroke="var(--color-neutral-600)" strokeWidth={1} />
            <Tooltip
              isAnimationActive={false}
              formatter={(value, name) => [index.format(Number(value)), String(name)]}
              labelFormatter={(label) => `Anno ${label}`}
            />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            {series.map((line) => (
              <Line
                key={line.key}
                type="linear"
                dataKey={line.key}
                name={line.label}
                stroke={line.color}
                strokeWidth={line.key.startsWith("indemnity") ? 2.5 : 2}
                strokeDasharray={line.dash}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        {mode === "nominal"
          ? `Indici con ${baseYear} = 100. La linea a 100 è il livello del ${baseYear}: sopra è cresciuto, sotto è sceso.`
          : `Indici con ${baseYear} = 100, divisi per l'andamento dei prezzi FOI: misurano il potere d'acquisto rispetto al ${baseYear}.`}
      </figcaption>
      <ChartDataTable
        label={mode === "nominal" ? `Indici nominali, ${baseYear} = 100` : `Indici al netto dei prezzi FOI, ${baseYear} = 100`}
        columns={series.map((line) => line.label)}
        rows={rows.map((row) => ({ label: String(row.year), values: series.map((line) => index.format(row[line.key])) }))}
      />
    </figure>
  );
}
