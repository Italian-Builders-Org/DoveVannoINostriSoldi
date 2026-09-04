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
import { useRef, useState, type KeyboardEvent } from "react";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { compactEuro, exactEuro, integer } from "@/lib/format";
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

const VIEW_OPTIONS = [
  {
    id: "grafico",
    label: "Grafico",
    tabId: "ssn-accounting-chart-tab",
    panelId: "ssn-accounting-chart-panel",
  },
  {
    id: "tabella",
    label: "Tabella",
    tabId: "ssn-accounting-table-tab",
    panelId: "ssn-accounting-table-panel",
  },
] as const;

type View = (typeof VIEW_OPTIONS)[number]["id"];

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
      <b>{exactEuro(point.value)}</b>
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
                <small>{exactEuro(point.valueCents / 100)}</small>
              </td>
              <td>
                Copertura dettaglio: {integer(point.detailPresent)} enti con voce · {integer(point.detailMissing)} senza riga
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chartData: ChartPoint[] = data.map((point) => ({
    ...point,
    value: point.valueCents / 100,
    axisLabel: axisLabel(point.label),
  }));

  const selectView = (next: View, focus = false) => {
    if (focus) {
      const nextIndex = VIEW_OPTIONS.findIndex((option) => option.id === next);
      tabRefs.current[nextIndex]?.focus();
    }
    setView(next);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = VIEW_OPTIONS.findIndex((option) => option.id === view);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % VIEW_OPTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + VIEW_OPTIONS.length) % VIEW_OPTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = VIEW_OPTIONS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectView(VIEW_OPTIONS[nextIndex].id, true);
  };

  return (
    <div className={styles.viewBlock}>
      <div
        className={styles.viewSelector}
        role="tablist"
        aria-label="Vista delle voci contabili"
        aria-orientation="horizontal"
      >
        {VIEW_OPTIONS.map((option, index) => (
          <button
            type="button"
            role="tab"
            id={option.tabId}
            aria-selected={view === option.id}
            aria-controls={option.panelId}
            tabIndex={view === option.id ? 0 : -1}
            ref={(element) => { tabRefs.current[index] = element; }}
            onClick={() => selectView(option.id)}
            onKeyDown={handleTabKeyDown}
            key={option.id}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="ssn-accounting-chart-panel"
        aria-labelledby="ssn-accounting-chart-tab"
        hidden={view !== "grafico"}
      >
        {view === "grafico" ? (
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
                    domain={[0, "auto"]}
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
                    position={{ x: 8 }}
                    content={<TooltipContent />}
                  />
                  <Bar dataKey="value" fill="var(--chart-primary)" radius={0} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className={styles.caption}>
              Scala lineare da zero. Importi nazionali a consuntivo 2024, in euro di competenza economica.
              Le voci non sono parti di un unico totale e quelle minori appaiono più corte: usa la
              tabella per i valori esatti.
            </figcaption>
            <ChartDataTable
              label="Voci contabili sanità 2024: valori esatti"
              columns={["Importo"]}
              rows={chartData.map((point) => ({
                label: `${point.label} (${point.code})`,
                values: [exactEuro(point.value)],
              }))}
            />
          </figure>
        ) : null}
      </div>
      <div
        role="tabpanel"
        id="ssn-accounting-table-panel"
        aria-labelledby="ssn-accounting-table-tab"
        hidden={view !== "tabella"}
      >
        {view === "tabella" ? <ComparisonTable data={data} /> : null}
      </div>
    </div>
  );
}
