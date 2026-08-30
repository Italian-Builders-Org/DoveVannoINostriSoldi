"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { relativeChangeLabel, signed } from "./government-scorecard-format";
import styles from "./government-indicator-chart.module.css";

type CountryKey = "italy" | "france" | "germany" | "spain";

type Indicator = {
  id: string;
  label: string;
  limitations: string;
  direction: "higher" | "lower";
  transformation: "log-change" | "point-change";
  unit: string;
  sourceCodes: Readonly<Record<CountryKey, readonly string[]>>;
  series: readonly {
    year: number;
    italy: number;
    france: number;
    germany: number;
    spain: number;
  }[];
};

const countries = [
  { key: "italy", label: "Italia", color: "var(--chart-primary)", width: 3, dash: undefined },
  { key: "france", label: "Francia", color: "var(--chart-secondary)", width: 1.8, dash: "8 5" },
  { key: "germany", label: "Germania", color: "var(--chart-tertiary)", width: 1.8, dash: "2 4" },
  { key: "spain", label: "Spagna", color: "var(--chart-quaternary)", width: 1.8, dash: "12 4 2 4" },
] as const;

function axisValue(value: number) {
  return signed(value, 1);
}

function changeFromBaseline(indicator: Indicator, current: number, baseline: number) {
  const direction = indicator.direction === "higher" ? 1 : -1;
  return indicator.transformation === "log-change"
    ? direction * 100 * (Math.log(current) - Math.log(baseline))
    : direction * (current - baseline);
}

const italianUnitLabels: Readonly<Record<string, string>> = {
  "National currency: 2020 = 100": "indice in valuta nazionale, 2020 = 100",
  "Percentage of active population": "% della popolazione attiva",
  "1000 national currency, 2020 reference levels": "migliaia di unità monetarie nazionali, prezzi 2020",
  "Percentage of GDP at current prices (excessive deficit procedure)": "% del PIL a prezzi correnti (procedura per disavanzi eccessivi)",
  "Percentage of GDP at current prices": "% del PIL a prezzi correnti",
};

function unitLabel(unit: string) {
  return italianUnitLabels[unit] ?? unit;
}

function originalValue(value: number, unit: string) {
  const formatted = value.toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${formatted} · ${unitLabel(unit)}`;
}

function sourceCodesLabel(indicator: Indicator) {
  const codes = [...new Set(Object.values(indicator.sourceCodes).flat())];
  return `AMECO · codici ${codes.join(", ")}`;
}

export function GovernmentIndicatorChart({ indicators }: { indicators: readonly Indicator[] }) {
  const [selectedId, setSelectedId] = useState(indicators[0]?.id ?? "");
  const selected = indicators.find((indicator) => indicator.id === selectedId) ?? indicators[0];
  if (!selected) return null;
  const baseline = selected.series[0];
  const latest = selected.series.at(-1);
  if (!baseline || !latest) return null;
  const chartData = selected.series.map((point) => {
    const transformed = Object.fromEntries(countries.flatMap((country) => {
      const current = point[country.key];
      const start = baseline[country.key];
      const change = changeFromBaseline(selected, current, start);
      return [[country.key, change], [`${country.key}Raw`, current]];
    }));
    return { year: point.year, ...transformed };
  });
  const changeUnit = selected.transformation === "log-change"
    ? "miglioramento normalizzato dall’inizio (variazione logaritmica, ≈%)"
    : "miglioramento normalizzato dall’inizio (punti)";
  const sourceLabel = sourceCodesLabel(selected);
  const chartLabel = `${selected.label}: miglioramento annuale dalla baseline, ${changeUnit}, dal ${baseline.year} al ${latest.year}; Italia, Francia, Germania e Spagna; fonte ${sourceLabel}`;

  return (
    <figure className={styles.figure}>
      <div className={styles.header}>
        <div>
          <span>ANDAMENTO ANNUALE</span>
          <h3>{selected.label}: andamento osservato dall’inizio</h3>
        </div>
        <div className={styles.selector} role="group" aria-label="Scegli l’indicatore del grafico">
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
      <p className={styles.metadata}>
        <span>Periodo: <strong>{baseline.year} → {latest.year}</strong></span>
        <span>Unità del confronto: <strong>{changeUnit}</strong></span>
        <span>Unità originale: <strong>{unitLabel(selected.unit)}</strong></span>
        <span>Direzione: <strong>{selected.direction === "higher" ? "un valore più alto è migliore" : "un valore più basso è migliore"}</strong></span>
        <span>Fonte: <a href="https://economy-finance.ec.europa.eu/economic-research-and-databases/economic-databases/ameco-database/download-annual-data-set-macro-economic-database-ameco_en" target="_blank" rel="noreferrer">{sourceLabel}</a></span>
      </p>
      <div className={styles.chart} role="img" aria-label={chartLabel}>
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
                return [`Andamento: ${relativeChangeLabel({ relativeChange: Number(value), transformation: selected.transformation })} · valore osservato ${originalValue(raw, selected.unit)}`, String(name)];
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
                strokeDasharray={country.dash}
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
        Lo zero è l’anno di partenza ({baseline.year}); sopra zero significa miglioramento dopo aver tenuto conto della direzione dell’indicatore.
        Il grafico confronta variazioni ({changeUnit}), non livelli assoluti né punti del voto e non dimostra un effetto causale del governo. {selected.limitations}
      </figcaption>
      <ChartDataTable
        label={`${selected.label}: valori annuali per paese, ${changeUnit}; periodo ${baseline.year}-${latest.year}; fonte ${sourceLabel}`}
        columns={countries.map((country) => `${country.label} · andamento (${changeUnit})`)}
        rows={selected.series.map((point) => ({
          label: `Anno ${point.year}`,
          values: countries.map((country) => {
            const change = changeFromBaseline(selected, point[country.key], baseline[country.key]);
            return `${relativeChangeLabel({ relativeChange: change, transformation: selected.transformation })} · valore osservato ${originalValue(point[country.key], selected.unit)}`;
          }),
        }))}
      />
    </figure>
  );
}
