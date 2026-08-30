"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import styles from "./ssn-accounting-comparison.module.css";

export type SsnAccountingComparisonPoint = Readonly<{
  id: string;
  label: string;
  sourceLabel: string;
  code: string;
  valueCents: number;
  detailPresent: number;
  detailMissing: number;
}>;

type ChartPoint = SsnAccountingComparisonPoint & {
  value: number;
  axisLabel: string;
};

type View = "grafico" | "tabella";

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
  useGrouping: "always",
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
  }
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

function axisLabel(label: string, maxLength = 34): string {
  return label.length > maxLength
    ? `${label.slice(0, maxLength - 1).trimEnd()}…`
    : label;
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
      <span>{point.code}</span>
      <strong>{point.label}</strong>
      <b>{exactEuro.format(point.value)}</b>
    </div>
  );
}

function ComparisonTable({ data }: { data: readonly SsnAccountingComparisonPoint[] }) {
  return (
    <div className="table-scroll" role="region" aria-label="Voci contabili sanità 2024" tabIndex={0}>
      <table className="table">
        <caption className={styles.tableCaption}>Voci contabili del Conto Economico SSN 2024</caption>
        <thead>
          <tr>
            <th scope="col">Voce</th>
            <th scope="col">Codice fonte</th>
            <th scope="col" className="num">Importo</th>
            <th scope="col">Copertura</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.id}>
              <th scope="row">
                <span className={styles.metricName}>{point.label}</span>
                <small>{point.sourceLabel}</small>
              </th>
              <td><code>{point.code}</code></td>
              <td className="num">
                <strong>{compactEuro(point.valueCents / 100)}</strong>
                <small>{exactEuro.format(point.valueCents / 100)}</small>
              </td>
              <td>
                Copertura dettaglio: {point.detailPresent} enti con voce · {point.detailMissing} senza riga
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SsnAccountingComparison({
  data,
}: {
  data: readonly SsnAccountingComparisonPoint[];
}) {
  const [view, setView] = useState<View>("grafico");
  const chartData: ChartPoint[] = data.map((point) => ({
    ...point,
    value: point.valueCents / 100,
    axisLabel: axisLabel(point.label),
  }));

  return (
    <div className={styles.viewBlock}>
      <div className={styles.viewSelector} role="tablist" aria-label="Vista delle voci contabili">
        <button
          type="button"
          role="tab"
          id="ssn-accounting-chart-tab"
          aria-selected={view === "grafico"}
          aria-controls="ssn-accounting-chart-panel"
          onClick={() => setView("grafico")}
        >
          Grafico
        </button>
        <button
          type="button"
          role="tab"
          id="ssn-accounting-table-tab"
          aria-selected={view === "tabella"}
          aria-controls="ssn-accounting-table-panel"
          onClick={() => setView("tabella")}
        >
          Tabella
        </button>
      </div>

      {view === "grafico" ? (
        <div role="tabpanel" id="ssn-accounting-chart-panel" aria-labelledby="ssn-accounting-chart-tab">
          <figure className={styles.figure}>
            <div
              className={styles.chart}
              role="img"
              aria-label="Confronto degli importi delle cinque voci contabili nazionali del Conto Economico SSN 2024"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  accessibilityLayer
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 20, bottom: 5, left: 4 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--color-neutral-300)" />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                    tickFormatter={compactEuro}
                  />
                  <YAxis
                    dataKey="axisLabel"
                    type="category"
                    axisLine={false}
                    tickLine={false}
                    width={205}
                    tick={{ fill: "var(--color-neutral-600)", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-neutral-100)" }}
                    animationDuration={120}
                    content={<TooltipContent />}
                  />
                  <Bar dataKey="value" fill="var(--chart-primary)" radius={0} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className={styles.caption}>
              Importi nazionali a consuntivo 2024, in euro di competenza economica. Le voci non sono parti di un unico totale: il grafico serve a confrontarne l&apos;ordine di grandezza.
            </figcaption>
            <ChartDataTable
              label="Voci contabili sanità 2024: valori esatti"
              columns={["Importo"]}
              rows={chartData.map((point) => ({
                label: `${point.label} (${point.code})`,
                values: [exactEuro.format(point.value)],
              }))}
            />
          </figure>
        </div>
      ) : (
        <div role="tabpanel" id="ssn-accounting-table-panel" aria-labelledby="ssn-accounting-table-tab">
          <ComparisonTable data={data} />
        </div>
      )}
    </div>
  );
}
