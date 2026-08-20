"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OpenCoesioneDimension } from "@/lib/data/opencoesione-contract";
import { chartColor } from "@/lib/chart-colors";
import styles from "./cohesion-explorer-chart.module.css";

type View = "themes" | "natures" | "statuses";

const views: Array<{ id: View; label: string }> = [
  { id: "themes", label: "Temi" },
  { id: "natures", label: "Natura" },
  { id: "statuses", label: "Stato" },
];

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function compactEuro(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mld €`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
  }
  return exactEuro.format(value);
}

function shortLabel(label: string): string {
  return label.length > 27 ? `${label.slice(0, 26).trimEnd()}…` : label;
}

function TooltipCard({ point }: { point: OpenCoesioneDimension }) {
  return (
    <div className={styles.tooltip}>
      <strong>{point.label}</strong>
      <span>Costo pubblico <b>{exactEuro.format(point.publicCostCents / 100)}</b></span>
      <span>Pagamenti <b>{exactEuro.format(point.paymentsCents / 100)}</b></span>
      <span>Progetti <b>{integer.format(point.projects)}</b></span>
    </div>
  );
}

export function CohesionExplorerChart({
  themes,
  natures,
  statuses,
}: {
  themes: OpenCoesioneDimension[];
  natures: OpenCoesioneDimension[];
  statuses: OpenCoesioneDimension[];
}) {
  const [view, setView] = useState<View>("themes");
  const datasets = { themes, natures, statuses };
  const data = [...datasets[view]]
    .sort((left, right) => right.publicCostCents - left.publicCostCents)
    .map((point) => ({
      ...point,
      axisLabel: shortLabel(point.label),
      publicCostEuro: point.publicCostCents / 100,
    }));
  const activeLabel = views.find((item) => item.id === view)?.label ?? "Temi";

  return (
    <div className={styles.explorer}>
      <div className={styles.controls} role="group" aria-label="Scegli come leggere i progetti">
        {views.map((item) => (
          <button
            className={item.id === view ? styles.active : undefined}
            key={item.id}
            type="button"
            aria-pressed={item.id === view}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        className={styles.chart}
        role="img"
        aria-label={`Costo pubblico dei progetti OpenCoesione per ${activeLabel.toLocaleLowerCase("it-IT")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 18, bottom: 4, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke="rgba(145, 174, 192, 0.12)" />
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#8198a6", fontSize: 11 }}
              tickFormatter={compactEuro}
            />
            <YAxis
              dataKey="axisLabel"
              type="category"
              axisLine={false}
              tickLine={false}
              width={190}
              tick={{ fill: "#bfd0d8", fontSize: 11 }}
            />
            <Tooltip
              animationDuration={120}
              cursor={{ fill: "rgba(255,255,255,0.022)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as OpenCoesioneDimension | undefined;
                return point ? <TooltipCard point={point} /> : null;
              }}
            />
            <Bar
              dataKey="publicCostEuro"
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
            >
              {data.map((point, index) => (
                <Cell key={point.slug} fill={chartColor(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <caption className={styles.srOnly}>Dati OpenCoesione per {activeLabel.toLocaleLowerCase("it-IT")}</caption>
          <thead>
            <tr>
              <th scope="col">{activeLabel}</th>
              <th scope="col">Costo pubblico</th>
              <th scope="col">Pagamenti</th>
              <th scope="col">Progetti</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.slug}>
                <th scope="row">
                  {point.sourceUrl ? (
                    <a href={point.sourceUrl} target="_blank" rel="noreferrer">{point.label} ↗</a>
                  ) : point.label}
                </th>
                <td>{exactEuro.format(point.publicCostCents / 100)}</td>
                <td>{exactEuro.format(point.paymentsCents / 100)}</td>
                <td>{integer.format(point.projects)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
