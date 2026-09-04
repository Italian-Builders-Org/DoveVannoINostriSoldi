"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type {
  GovernmentScorecardV6ChartSlide,
  GovernmentScorecardV6ComparisonDetail,
  GovernmentScorecardV6Ui,
} from "@/lib/government-scorecard-page";

import {
  formatGovernmentChartPeriod,
  formatGovernmentChartPointStatus,
  formatGovernmentChartValue,
  GOVERNMENT_CHART_COLORS,
  GOVERNMENT_CHART_MARKERS,
  GOVERNMENT_CHART_PATTERNS,
  hasGovernmentChartTrend,
  isGovernmentChartPointInWindow,
  isGovernmentChartStartBoundaryPeriod,
  splitGovernmentChartAtMissingPeriods,
} from "../_components/chart-utils";
import styles from "../government-scorecard.module.css";

type ComparisonOption = GovernmentScorecardV6Ui["compare"]["options"][number];
const VIEWBOX = { width: 560, height: 220, left: 54, right: 18, top: 16, bottom: 36 } as const;

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function scoreCopy(option: ComparisonOption): string {
  if (option.score_state === "scored_final" || option.score_state === "scored_provisional") {
    if (option.score_display === null) throw new Error(`voto mancante per ${option.id}`);
    return `${option.score_display}/100 · ${option.score_state === "scored_final" ? "storico" : "provvisorio"}`;
  }
  return "Voto non calcolato";
}

function ComparisonChart({
  chart,
  option,
}: {
  chart: GovernmentScorecardV6ChartSlide;
  option: GovernmentScorecardV6ComparisonDetail;
}) {
  const titleId = useId();
  const window = option.chart_windows.find((candidate) => candidate.indicator_id === chart.indicator_id);
  if (!window) throw new Error(`intervallo mancante per ${option.id}:${chart.indicator_id}`);
  const series = chart.series.map((country) => ({
    ...country,
    points: country.points.filter((point) => isGovernmentChartPointInWindow(
      point.period_start,
      window.start_date,
      window.end_date,
      window.end_exclusive,
      chart.frequency,
    )),
  }));
  const periods = [...new Set(series.flatMap((country) => country.points.map((point) => point.period)))].toSorted();
  const values = series.flatMap((country) => country.points.map((point) => point.value));
  const startBoundaryPeriod = series.flatMap((country) => country.points).find((point) => isGovernmentChartStartBoundaryPeriod(
    point.period_start,
    window.start_date,
    chart.frequency,
  ))?.period ?? null;

  if (periods.length === 0 || values.length === 0) {
    return <p className={styles.emptyState}>Nessun dato pubblicato nel mandato.</p>;
  }
  if (!hasGovernmentChartTrend(periods)) {
    return <p className={styles.emptyState}>Un solo periodo pubblicato nel mandato non basta per mostrare un andamento. Apri la scheda completa per consultare la serie completa.</p>;
  }

  const periodIndexes = new Map(periods.map((period, index) => [period, index]));
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.12, Math.abs(rawMaximum || 1) * 0.015, 0.1);
  const minimum = rawMinimum - padding;
  const maximum = rawMaximum + padding;
  const plotWidth = VIEWBOX.width - VIEWBOX.left - VIEWBOX.right;
  const plotHeight = VIEWBOX.height - VIEWBOX.top - VIEWBOX.bottom;
  const x = (period: string) => periods.length <= 1
    ? VIEWBOX.left + plotWidth / 2
    : VIEWBOX.left + ((periodIndexes.get(period) ?? 0) / (periods.length - 1)) * plotWidth;
  const y = (value: number) => VIEWBOX.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const ticks = Array.from({ length: 4 }, (_, index) => maximum - ((maximum - minimum) * index) / 3);
  const axisStep = Math.max(1, Math.ceil(periods.length / 5));
  const axisPeriods = periods.filter((_, index) => index % axisStep === 0 || index === periods.length - 1);

  return (
    <div className={styles.comparisonChart}>
      <h3 id={titleId}>Grafico per {option.label}</h3>
      <p>Dal {formatGovernmentChartPeriod(periods[0]!)} al {formatGovernmentChartPeriod(periods.at(-1)!)} · {chart.frequency} · {chart.unit}</p>
      {startBoundaryPeriod === null ? null : (
        <p>Periodo di insediamento: {formatGovernmentChartPeriod(startBoundaryPeriod)} · può includere giorni precedenti al giuramento.</p>
      )}
      <ul className={styles.comparisonLegend} aria-label={`Legenda del grafico per ${option.label}`}>
        {series.map((country) => (
          <li key={country.id}><i style={{ background: GOVERNMENT_CHART_COLORS[country.id] }} /><b aria-hidden="true">{GOVERNMENT_CHART_MARKERS[country.id]}</b>{country.label}</li>
        ))}
      </ul>
      <div
        className={styles.comparisonPlotViewport}
        role="region"
        aria-label={`Andamento di ${chart.title} durante ${option.label}`}
        tabIndex={0}
      >
        <svg
          className={styles.comparisonPlot}
          viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
          role="img"
          aria-labelledby={titleId}
        >
          <desc>{`${chart.title}: dati ${chart.frequency.toLowerCase()} pubblicati per ${option.label}, dal ${periods[0]} al ${periods.at(-1)}.`}</desc>
          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line className={styles.chartGridLine} x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={tickY} y2={tickY} />
                <text className={styles.chartAxisLabel} x={VIEWBOX.left - 7} y={tickY + 4} textAnchor="end">{formatGovernmentChartValue(tick, chart.unit)}</text>
              </g>
            );
          })}
          <line className={styles.chartAxisLine} x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={VIEWBOX.top + plotHeight} y2={VIEWBOX.top + plotHeight} />
          {axisPeriods.map((period) => (
            <text className={styles.chartAxisLabel} x={x(period)} y={VIEWBOX.height - 10} textAnchor="middle" key={period}>{formatGovernmentChartPeriod(period)}</text>
          ))}
          {series.map((country) => splitGovernmentChartAtMissingPeriods(country.points, periods).map((segment, index) => (
            <path
              className={styles.countryLine}
              d={segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${x(point.period)},${y(point.value)}`).join(" ")}
              key={`${country.id}-${index}`}
              stroke={GOVERNMENT_CHART_COLORS[country.id]}
              strokeDasharray={GOVERNMENT_CHART_PATTERNS[country.id]}
            />
          )))}
          {series.flatMap((country) => country.points.map((point) => (
            <circle cx={x(point.period)} cy={y(point.value)} fill={GOVERNMENT_CHART_COLORS[country.id]} key={`${country.id}-${point.period}`} r="3" />
          )))}
        </svg>
      </div>
      <h4>Variazioni nel periodo</h4>
      <dl className={styles.comparisonChanges}>
        {series.map((country) => {
          const first = country.points[0];
          const last = country.points.at(-1);
          const change = first && last && last.period_start > first.period_start ? last.value - first.value : null;
          return (
            <div key={country.id}>
              <dt><i style={{ background: GOVERNMENT_CHART_COLORS[country.id] }} /><b aria-hidden="true">{GOVERNMENT_CHART_MARKERS[country.id]}</b>{country.label}</dt>
              <dd>{change === null ? "n.d." : `${change > 0 ? "+" : ""}${formatGovernmentChartValue(change, chart.unit)}`}</dd>
            </div>
          );
        })}
      </dl>
      <details className={styles.comparisonTable}>
        <summary>Apri i dati pubblicati</summary>
        <div role="region" aria-label={`Valori di ${chart.title} per ${option.label}`} tabIndex={0}>
          <table>
            <caption>{chart.title} · {option.label}</caption>
            <thead><tr><th scope="col">Paese</th><th scope="col">Inizio</th><th scope="col">Fine</th></tr></thead>
            <tbody>
              {series.map((country) => (
                <tr key={country.id}>
                  <th scope="row">{country.label}</th>
                  <td>{country.points[0] ? `${formatGovernmentChartPeriod(country.points[0].period)}: ${formatGovernmentChartValue(country.points[0].value, chart.unit)}${formatGovernmentChartPointStatus(country.points[0])}` : "n.d."}</td>
                  <td>{country.points.at(-1) ? `${formatGovernmentChartPeriod(country.points.at(-1)!.period)}: ${formatGovernmentChartValue(country.points.at(-1)!.value, chart.unit)}${formatGovernmentChartPointStatus(country.points.at(-1)!)}` : "n.d."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ComparisonPanel({ option, chart }: { option: GovernmentScorecardV6ComparisonDetail; chart: GovernmentScorecardV6ChartSlide }) {
  return (
    <article className={styles.comparisonPanel}>
      <header>
        <span>{formatDate(option.start_date)} → {option.current ? "in corso" : formatDate(option.end_date!)}</span>
        <h2>{option.label}</h2>
        <strong>{scoreCopy(option)}</strong>
      </header>
      <ComparisonChart chart={chart} option={option} />
      <section className={styles.comparisonContext} aria-labelledby={`context-${option.id}`}>
        <h3 id={`context-${option.id}`}>Contesto documentato</h3>
        <ul>
          {option.context.map((slide) => (
            <li key={slide.context_item_id}>
              <strong>{slide.title}</strong>
              <span>{slide.status === "ready" ? slide.summary.join(" ") : slide.message}</span>
            </li>
          ))}
        </ul>
      </section>
      <a className={styles.comparisonDetailLink} href={option.href}>Apri la scheda completa di {option.label}</a>
    </article>
  );
}

export function GovernmentComparison({
  compare,
  charts,
  left,
  right,
}: {
  compare: GovernmentScorecardV6Ui["compare"];
  charts: GovernmentScorecardV6Ui["charts"];
  left: GovernmentScorecardV6ComparisonDetail;
  right: GovernmentScorecardV6ComparisonDetail;
}) {
  const [leftSelection, setLeftSelection] = useState(left.id);
  const [rightSelection, setRightSelection] = useState(right.id);
  const [indicatorId, setIndicatorId] = useState(charts.status === "ready" ? charts.slides[0]?.indicator_id ?? "" : "");
  const chart = charts.status === "ready" ? charts.slides.find((candidate) => candidate.indicator_id === indicatorId) : undefined;

  if (!chart || charts.status !== "ready") {
    return <main className={`${styles.page} ${styles.comparisonPage}`}><p className={styles.emptyState}>Confronto non disponibile.</p></main>;
  }

  return (
    <main className={`${styles.page} ${styles.comparisonPage}`} id="contenuto-principale">
      <header className={styles.comparisonPageHeader}>
        <Link href="/governi">← Torna alla pagella dei governi</Link>
        <span className={styles.sectionEyebrow}>Confronto tra governi</span>
        <h1>{left.label} e {right.label}</h1>
        <p>Stesso indicatore, dati pubblicati nei rispettivi mandati.</p>
      </header>

      <form className={styles.comparisonForm} action="/governi/confronta" method="get">
        <label>
          Primo governo
          <select name="sinistra" value={leftSelection} onChange={(event) => setLeftSelection(event.target.value)}>
            {compare.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Secondo governo
          <select name="destra" value={rightSelection} onChange={(event) => setRightSelection(event.target.value)}>
            {compare.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={leftSelection === rightSelection}>Aggiorna confronto</button>
        {leftSelection === rightSelection ? <p role="status">Scegli due governi diversi.</p> : null}
      </form>

      <section className={styles.comparisonResult} aria-label="Confronto per indicatore">
        <div className={styles.comparisonIndicatorPicker}>
          <label htmlFor="comparison-indicator">Indicatore da confrontare</label>
          <select id="comparison-indicator" value={indicatorId} onChange={(event) => setIndicatorId(event.target.value)}>
            {charts.slides.map((candidate) => <option key={candidate.indicator_id} value={candidate.indicator_id}>{candidate.title}</option>)}
          </select>
        </div>
        <div className={styles.comparisonGrid}>
          <ComparisonPanel option={left} chart={chart} />
          <ComparisonPanel option={right} chart={chart} />
        </div>
      </section>
    </main>
  );
}
