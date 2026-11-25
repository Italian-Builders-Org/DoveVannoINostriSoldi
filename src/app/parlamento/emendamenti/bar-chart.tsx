import { ChartDataTable } from "@/components/charts/chart-data-table";

import styles from "./emendamenti.module.css";

export type BarTone = "admissible" | "partial" | "coverage" | "matter" | "plain" | "place";

export type BarRow = {
  key: string;
  label: string;
  note?: string;
  segments: { tone: BarTone; value: number }[];
  /** Number written at the end of the bar: the chart is readable without colours. */
  value: string;
  aside?: string;
};

export const OUTCOME_LEGEND: { tone: BarTone; label: string }[] = [
  { tone: "admissible", label: "Ammesse all'esame" },
  { tone: "partial", label: "In parte inammissibili" },
  { tone: "coverage", label: "Inammissibili per copertura" },
  { tone: "matter", label: "Inammissibili per estraneità di materia" },
];

/**
 * Horizontal bars with the label on the left and the number on the right.
 * Server-rendered markup only: every value is text, the bars are decoration,
 * and the same numbers are repeated in the table below the chart.
 */
export function BarChart({
  title,
  rows,
  legend,
  table,
}: {
  title: string;
  rows: BarRow[];
  legend?: { tone: BarTone; label: string }[];
  table: { columns: string[]; rows: { label: string; values: string[] }[] };
}) {
  const max = Math.max(1, ...rows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0)));
  return (
    <figure className={styles.figure}>
      {legend ? (
        <ul className={styles.legend} aria-label="Legenda">
          {legend.map((item) => (
            <li key={item.tone}>
              <span className={styles.swatch} data-tone={item.tone} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className={styles.bars} aria-label={title}>
        {rows.map((row) => {
          const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
          return (
            <li key={row.key} data-bar={row.key}>
              <span className={styles.barLabel}>
                {row.label}
                {row.note ? <span className={styles.cellNote}>{row.note}</span> : null}
              </span>
              <span className={styles.barTrack} aria-hidden="true">
                <span className={styles.barFill} style={{ width: `${(total / max) * 100}%` }}>
                  {row.segments
                    .filter((segment) => segment.value > 0)
                    .map((segment) => (
                      <span key={segment.tone} data-tone={segment.tone} style={{ flexGrow: segment.value }} />
                    ))}
                </span>
              </span>
              <span className={styles.barValue}>
                <strong>{row.value}</strong>
                {row.aside ? <span className={styles.cellNote}>{row.aside}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <ChartDataTable label={title} columns={table.columns} rows={table.rows} />
    </figure>
  );
}
