"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OpenCoesioneAnnualPoint } from "@/lib/data/opencoesione-contract";
import styles from "./cohesion-history-chart.module.css";

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function compactEuro(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mld`;
  }
  return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln`;
}

export function CohesionHistoryChart({ data }: { data: OpenCoesioneAnnualPoint[] }) {
  const chartData = data.slice(-17).map((point) => ({
    ...point,
    commitmentsEuro: point.commitmentsCents / 100,
    paymentsEuro: point.paymentsCents / 100,
  }));

  return (
    <figure className={styles.figure}>
      <div
        className={styles.chart}
        role="img"
        aria-label="Serie annuale cumulativa di impegni e pagamenti dei progetti OpenCoesione"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 12, right: 16, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="rgba(145, 174, 192, 0.12)" />
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#8198a6", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={66}
              tick={{ fill: "#8198a6", fontSize: 11 }}
              tickFormatter={compactEuro}
            />
            <Tooltip
              animationDuration={120}
              cursor={{ stroke: "rgba(171, 204, 221, 0.24)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as (OpenCoesioneAnnualPoint & {
                  commitmentsEuro: number;
                  paymentsEuro: number;
                }) | undefined;
                if (!point) return null;
                return (
                  <div className={styles.tooltip}>
                    <strong>{point.year}</strong>
                    <span>Impegni fino all&apos;anno <b>{exactEuro.format(point.commitmentsEuro)}</b></span>
                    <span>Pagamenti fino all&apos;anno <b>{exactEuro.format(point.paymentsEuro)}</b></span>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="commitmentsEuro"
              stroke="var(--chart-secondary)"
              strokeWidth={1.5}
              fill="var(--chart-secondary)"
              fillOpacity={0.035}
              isAnimationActive={false}
              activeDot={{ r: 3, fill: "var(--chart-secondary)", stroke: "#071827", strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="paymentsEuro"
              stroke="var(--chart-primary)"
              strokeWidth={2}
              fill="var(--chart-primary)"
              fillOpacity={0.09}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: "var(--chart-primary)", stroke: "#071827", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span><i className={styles.commitments} /> Impegni fino all&apos;anno</span>
        <span><i className={styles.payments} /> Pagamenti fino all&apos;anno</span>
      </div>
      <figcaption>
        Ogni punto contiene il totale registrato fino a quell&apos;anno, non il valore del solo anno indicato.
      </figcaption>
      <div className={styles.tableWrap}>
        <table>
          <caption>Totali annuali pubblicati da OpenCoesione</caption>
          <thead>
            <tr>
              <th scope="col">Anno</th>
              <th scope="col">Impegni fino all&apos;anno</th>
              <th scope="col">Pagamenti fino all&apos;anno</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((point) => (
              <tr key={point.year}>
                <th scope="row">{point.year}</th>
                <td>{exactEuro.format(point.commitmentsEuro)}</td>
                <td>{exactEuro.format(point.paymentsEuro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
