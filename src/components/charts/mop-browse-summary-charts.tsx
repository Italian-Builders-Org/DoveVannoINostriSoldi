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
import { ChartDataTable } from "./chart-data-table";
import styles from "./mop-browse-summary-charts.module.css";

export type MopSectorSummary = {
  label: string;
  count: number;
  plannedEuro: number;
  actualEuro: number;
};

export type MopProgressSummary = {
  label: string;
  count: number;
};

const integerFormatter = new Intl.NumberFormat("it-IT", { useGrouping: "always" });
const euroCompact = new Intl.NumberFormat("it-IT", {
  notation: "compact",
  maximumFractionDigits: 1,
  useGrouping: "always",
});
const euroFull = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const tickMuted = { fill: "var(--color-neutral-600)", fontSize: 11 } as const;
const tickInk = { fill: "var(--color-neutral-800)", fontSize: 11 } as const;
const cursorFill = { fill: "var(--color-neutral-100)" } as const;

function positiveEuro(value: number): number {
  return Math.max(1, value);
}

function logDomain(values: number[]): [number, number] {
  const max = Math.max(...values, 1);
  const min = Math.min(...values.filter((value) => value > 0), max);
  const low = Math.max(1, 10 ** Math.floor(Math.log10(min)));
  const high = 10 ** Math.ceil(Math.log10(max));
  return [low, high];
}

function logPercent(value: number, domain: [number, number]): number {
  const [low, high] = domain;
  const safe = positiveEuro(value);
  const start = Math.log10(low);
  const end = Math.log10(high);
  if (end <= start) return 100;
  const ratio = (Math.log10(safe) - start) / (end - start);
  return Math.max(2, Math.min(100, ratio * 100));
}

export function MopBrowseSummaryCharts({
  sectors,
  progress,
}: {
  sectors: readonly MopSectorSummary[];
  progress: readonly MopProgressSummary[];
}) {
  const sectorData = sectors.slice(0, 8);
  const progressData = progress.map((row) => ({
    ...row,
    shortLabel:
      row.label === "in-corso"
        ? "In corso"
        : row.label === "concluso"
          ? "Concluso"
          : "Non determinato",
  }));
  const sectorDomain = logDomain(
    sectorData.flatMap((row) => [positiveEuro(row.plannedEuro), positiveEuro(row.actualEuro)]),
  );
  const progressHeight = 228;

  return (
    <div className={styles.stack}>
      <figure className={`${styles.figure} ${styles.progressFigure}`}>
        <figcaption>
          <strong>Opere per avanzamento</strong>
          <span>
            Un costo effettivo diverso dal previsto su un’opera ancora in corso
            non è un bilancio finale.
          </span>
        </figcaption>
        <div
          className={styles.chart}
          style={{ height: progressHeight }}
          role="img"
          aria-label="Opere per avanzamento"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              accessibilityLayer
              data={progressData}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              barCategoryGap="32%"
            >
              <CartesianGrid vertical={false} stroke="var(--color-neutral-300)" />
              <XAxis
                dataKey="shortLabel"
                tick={tickInk}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tick={tickMuted}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={36}
              />
              <Tooltip
                cursor={cursorFill}
                animationDuration={120}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as (typeof progressData)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div className={styles.tooltip}>
                      <strong>{row.shortLabel}</strong>
                      <b>{integerFormatter.format(row.count)} opere</b>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="count"
                name="Opere"
                fill="var(--chart-data-primary)"
                maxBarSize={64}
                radius={0}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.tableSlot}>
          <ChartDataTable
            label="Opere per avanzamento"
            columns={["Opere"]}
            rows={progressData.map((row) => ({
              label: row.shortLabel,
              values: [integerFormatter.format(row.count)],
            }))}
          />
        </div>
      </figure>

      <figure className={styles.figure}>
        <figcaption>
          <strong>Previsto vs effettivo per settore</strong>
          <span>
            Scala logaritmica: i settori piccoli restano leggibili accanto ai
            grandi. I nomi dei settori sono per intero. Solo il sottoinsieme
            confrontabile di questa pagina, non l’Italia intera.
          </span>
        </figcaption>

        <div className={styles.sectorLegend} aria-hidden>
          <span>
            <i className={`${styles.swatch} ${styles.swatchPlanned}`} />
            Previsto
          </span>
          <span>
            <i className={`${styles.swatch} ${styles.swatchActual}`} />
            Effettivo
          </span>
        </div>

        <ol className={styles.sectorList}>
          {sectorData.map((row) => {
            const plannedWidth = logPercent(row.plannedEuro, sectorDomain);
            const actualWidth = logPercent(row.actualEuro, sectorDomain);
            return (
              <li key={row.label} className={styles.sectorRow}>
                <p className={styles.sectorName}>{row.label}</p>
                <p className={styles.sectorMeta}>
                  {integerFormatter.format(row.count)} opere
                </p>
                <div
                  className={styles.sectorBars}
                  role="img"
                  aria-label={`${row.label}: previsto ${euroFull.format(row.plannedEuro)}, effettivo ${euroFull.format(row.actualEuro)}`}
                >
                  <div className={styles.barRow}>
                    <span className={styles.barLabel}>Previsto</span>
                    <div className={styles.track}>
                      <i
                        className={styles.barPlanned}
                        style={{ width: `${plannedWidth}%` }}
                      />
                    </div>
                    <b className={styles.barValue}>{euroCompact.format(row.plannedEuro)} €</b>
                  </div>
                  <div className={styles.barRow}>
                    <span className={styles.barLabel}>Effettivo</span>
                    <div className={styles.track}>
                      <i
                        className={styles.barActual}
                        style={{ width: `${actualWidth}%` }}
                      />
                    </div>
                    <b className={styles.barValue}>{euroCompact.format(row.actualEuro)} €</b>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className={styles.tableSlot}>
          <ChartDataTable
            label="Costi per settore"
            columns={["Opere", "Previsto", "Effettivo"]}
            rows={sectorData.map((row) => ({
              label: row.label,
              values: [
                integerFormatter.format(row.count),
                `${euroCompact.format(row.plannedEuro)} €`,
                `${euroCompact.format(row.actualEuro)} €`,
              ],
            }))}
          />
        </div>
      </figure>
    </div>
  );
}
