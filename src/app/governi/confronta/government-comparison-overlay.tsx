"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { signed } from "../government-scorecard-format";
import styles from "./government-comparison-overlay.module.css";

type ComparisonIndicator = {
  id: string;
  label: string;
  limitations: string;
  direction: "higher" | "lower";
  transformation: "log-change" | "point-change";
  series: readonly {
    year: number;
    italy: number;
  }[];
};

type GovernmentSeries = {
  name: string;
  indicators: readonly ComparisonIndicator[];
};

function changeFromBaseline(indicator: ComparisonIndicator, value: number, baseline: number) {
  const direction = indicator.direction === "higher" ? 1 : -1;
  return indicator.transformation === "log-change"
    ? direction * 100 * (Math.log(value) - Math.log(baseline))
    : direction * (value - baseline);
}

function changeLabel(value: number | null, suffix: string) {
  return value == null ? "n.d." : `${signed(value)}${suffix}`;
}

export function GovernmentComparisonOverlay({ left, right }: { left: GovernmentSeries; right: GovernmentSeries }) {
  const [selectedId, setSelectedId] = useState(left.indicators[0]?.id ?? "");
  const leftIndicator = left.indicators.find((indicator) => indicator.id === selectedId) ?? left.indicators[0];
  const rightIndicator = right.indicators.find((indicator) => indicator.id === selectedId) ?? right.indicators[0];
  if (!leftIndicator || !rightIndicator) return null;

  const maximumLength = Math.max(leftIndicator.series.length, rightIndicator.series.length);
  const leftBaseline = leftIndicator.series[0]?.italy;
  const rightBaseline = rightIndicator.series[0]?.italy;
  if (leftBaseline == null || rightBaseline == null) return null;

  const chartData = Array.from({ length: maximumLength }, (_, mandateYear) => {
    const leftPoint = leftIndicator.series[mandateYear];
    const rightPoint = rightIndicator.series[mandateYear];
    return {
      mandateYear,
      left: leftPoint ? changeFromBaseline(leftIndicator, leftPoint.italy, leftBaseline) : null,
      right: rightPoint ? changeFromBaseline(rightIndicator, rightPoint.italy, rightBaseline) : null,
      leftYear: leftPoint?.year ?? null,
      rightYear: rightPoint?.year ?? null,
    };
  });
  const suffix = leftIndicator.transformation === "log-change" ? "%" : " punti";

  return (
    <figure className={styles.figure}>
      <div className={styles.header}>
        <div>
          <span>Dati sovrapposti</span>
          <h2>{leftIndicator.label}</h2>
          <p>Entrambi partono da zero nel proprio anno iniziale: così confrontiamo la traiettoria durante il mandato, anche se gli anni di calendario sono diversi.</p>
        </div>
        <div className={styles.selector} aria-label="Scegli l’indicatore da sovrapporre">
          {left.indicators.map((indicator) => (
            <button
              key={indicator.id}
              type="button"
              aria-pressed={indicator.id === leftIndicator.id}
              onClick={() => setSelectedId(indicator.id)}
            >
              {indicator.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chart} role="img" aria-label={`${leftIndicator.label}: traiettorie sovrapposte di ${left.name} e ${right.name} dall’inizio dei rispettivi mandati`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 4, left: 5 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <ReferenceLine y={0} stroke="var(--color-neutral-600)" strokeDasharray="4 4" />
            <XAxis
              dataKey="mandateYear"
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `Anno ${value}`}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
            />
            <YAxis
              width={64}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${signed(value, 1)}${suffix}`}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
            />
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(value, payload) => {
                const row = payload[0]?.payload as typeof chartData[number] | undefined;
                return `Anno ${value} del mandato · ${left.name} ${row?.leftYear ?? "n.d."} · ${right.name} ${row?.rightYear ?? "n.d."}`;
              }}
              formatter={(value, name) => [`${signed(Number(value))}${suffix}`, String(name)]}
            />
            <Legend verticalAlign="top" align="right" iconType="plainline" />
            <Line type="monotone" dataKey="left" name={left.name} stroke="var(--chart-primary)" strokeWidth={3} dot activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="right" name={right.name} stroke="var(--chart-secondary)" strokeDasharray="8 5" strokeWidth={3} dot activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <figcaption>
        Sopra zero significa miglioramento rispetto all’inizio del singolo mandato; sotto zero significa peggioramento. Il grafico non prova che la variazione sia stata causata dal governo. {leftIndicator.limitations}
      </figcaption>
      <ChartDataTable
        label={`${leftIndicator.label}: confronto per anno del mandato`}
        columns={[`${left.name} · anno`, `${left.name} · variazione`, `${right.name} · anno`, `${right.name} · variazione`]}
        rows={chartData.map((row) => ({
          label: `Anno ${row.mandateYear}`,
          values: [String(row.leftYear ?? "n.d."), changeLabel(row.left, suffix), String(row.rightYear ?? "n.d."), changeLabel(row.right, suffix)],
        }))}
      />
    </figure>
  );
}
