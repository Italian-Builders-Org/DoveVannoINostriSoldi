"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { signed, sourceValue } from "./government-scorecard-format";
import styles from "./government-indicator-chart.module.css";

type Indicator = {
  id: string;
  label: string;
  limitations: string;
  direction: "higher" | "lower";
  transformation: "log-change" | "point-change";
  series: readonly {
    year: number;
    italy: number;
    france: number;
    germany: number;
    spain: number;
  }[];
};

const countries = [
  { key: "italy", label: "Italia", color: "#a43b18", width: 3 },
  { key: "france", label: "Francia", color: "#2563eb", width: 1.8 },
  { key: "germany", label: "Germania", color: "#111827", width: 1.8 },
  { key: "spain", label: "Spagna", color: "#d97706", width: 1.8 },
] as const;

function axisValue(value: number) {
  return signed(value, 1);
}

export function GovernmentIndicatorChart({ indicators }: { indicators: readonly Indicator[] }) {
  const [selectedId, setSelectedId] = useState(indicators[0]?.id ?? "");
  const selected = indicators.find((indicator) => indicator.id === selectedId) ?? indicators[0];
  if (!selected) return null;
  const baseline = selected.series[0];
  if (!baseline) return null;
  const direction = selected.direction === "higher" ? 1 : -1;
  const chartData = selected.series.map((point) => {
    const transformed = Object.fromEntries(countries.flatMap((country) => {
      const current = point[country.key];
      const start = baseline[country.key];
      const change = selected.transformation === "log-change"
        ? direction * 100 * (Math.log(current) - Math.log(start))
        : direction * (current - start);
      return [[country.key, change], [`${country.key}Raw`, current]];
    }));
    return { year: point.year, ...transformed };
  });
  const changeSuffix = selected.transformation === "log-change" ? "%" : " punti";

  return (
    <figure className={styles.figure}>
      <div className={styles.header}>
        <div>
          <span>ANDAMENTO ANNUALE</span>
          <h3>{selected.label}: miglioramento dall’inizio</h3>
        </div>
        <div className={styles.selector} aria-label="Scegli l’indicatore del grafico">
          {indicators.map((indicator) => (
            <button
              key={indicator.id}
              type="button"
              aria-pressed={indicator.id === selected.id}
              onClick={() => setSelectedId(indicator.id)}
            >
              {indicator.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chart} role="img" aria-label={`${selected.label}: miglioramento annuale dalla baseline per Italia, Francia, Germania e Spagna`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 2, left: 6 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis dataKey="year" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }} />
            <YAxis domain={["auto", "auto"]} width={64} axisLine={false} tickLine={false} tickFormatter={axisValue} tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }} />
            <Tooltip
              isAnimationActive={false}
              formatter={(value, name, item) => {
                const country = countries.find((candidate) => candidate.label === name);
                const raw = country ? Number((item.payload as Record<string, unknown>)[`${country.key}Raw`]) : Number.NaN;
                return [`${signed(Number(value))}${changeSuffix} · valore ${sourceValue(raw, selected.id)}`, String(name)];
              }}
              labelFormatter={(year) => `Anno ${year}`}
            />
            <Legend verticalAlign="top" align="right" iconType="plainline" />
            {countries.map((country) => (
              <Line
                key={country.key}
                type="monotone"
                dataKey={country.key}
                name={country.label}
                stroke={country.color}
                strokeWidth={country.width}
                dot={chartData.length <= 4}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        Lo zero è l’anno di partenza; sopra zero significa miglioramento, anche per gli indicatori in cui diminuire è positivo.
        Il grafico confronta variazioni, non livelli assoluti né punti del voto. {selected.limitations}
      </figcaption>
      <ChartDataTable
        label={`${selected.label}: valori annuali per paese`}
        columns={countries.map((country) => `${country.label} · valore originale`)}
        rows={selected.series.map((point) => ({
          label: String(point.year),
          values: countries.map((country) => sourceValue(point[country.key], selected.id)),
        }))}
      />
    </figure>
  );
}
