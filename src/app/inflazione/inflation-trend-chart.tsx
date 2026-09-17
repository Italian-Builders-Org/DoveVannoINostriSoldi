"use client";

import {
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
import styles from "./inflazione.module.css";

export type InflationTrendPoint = Readonly<{
  period: string;
  label: string;
  shortLabel: string;
  index: number;
  annualRate: number;
  monthlyRate: number;
  estimated: boolean;
}>;

const rate = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const indexValue = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function rateLabel(value: number): string {
  return `${rate.format(value)}%`;
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload?: InflationTrendPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className={styles.chartTooltip}>
      <strong>{point.label}{point.estimated ? " · stima Eurostat" : ""}</strong>
      <dl>
        <div><dt>Variazione annua</dt><dd>{rateLabel(point.annualRate)}</dd></div>
        <div><dt>Variazione mensile</dt><dd>{rateLabel(point.monthlyRate)}</dd></div>
        <div><dt>Indice 2025=100</dt><dd>{indexValue.format(point.index)}</dd></div>
      </dl>
    </div>
  );
}

export function InflationTrendChart({ data }: { data: readonly InflationTrendPoint[] }) {
  const shortLabelByPeriod = new Map(data.map((point) => [point.period, point.shortLabel] as const));

  return (
    <figure className={styles.trendFigure} aria-labelledby="inflation-trend-caption">
      <div className={styles.chart} role="img" aria-label="IPCA Italia: variazione annua e mensile da gennaio 2022">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
            <XAxis
              dataKey="period"
              axisLine={false}
              tickLine={false}
              minTickGap={42}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              tickFormatter={(period: string) => shortLabelByPeriod.get(period) ?? period}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={50}
              tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
              tickFormatter={(value: number) => `${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`}
            />
            <ReferenceLine y={0} stroke="var(--color-neutral-500)" strokeDasharray="3 3" />
            <Tooltip isAnimationActive={false} cursor={{ stroke: "var(--color-neutral-400)" }} content={<TooltipContent />} />
            <Line
              type="monotone"
              dataKey="annualRate"
              name="Variazione annua"
              stroke="var(--chart-primary)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "var(--chart-primary)", stroke: "var(--color-raised)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="monthlyRate"
              name="Variazione mensile"
              stroke="var(--chart-secondary)"
              strokeWidth={1.8}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, fill: "var(--chart-secondary)", stroke: "var(--color-raised)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.chartLegend} aria-hidden="true">
        <span><i className={styles.annualLegend} />Variazione annua</span>
        <span><i className={styles.monthlyLegend} />Variazione mensile</span>
      </div>
      <figcaption id="inflation-trend-caption">
        Tassi IPCA mensili Eurostat. La linea continua confronta ogni mese con lo stesso mese dell’anno prima; la tratteggiata con il mese precedente.
      </figcaption>
      <ChartDataTable
        label="Serie IPCA Italia: valori esatti pubblicati"
        columns={["Variazione annua", "Variazione mensile", "Indice 2025=100", "Stato"]}
        rows={data.map((point) => ({
          label: point.label,
          values: [rateLabel(point.annualRate), rateLabel(point.monthlyRate), indexValue.format(point.index), point.estimated ? "Stima Eurostat" : "Pubblicato"],
        }))}
      />
    </figure>
  );
}
