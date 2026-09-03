"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type {
  GovernmentScorecardV6ChartCollection,
  GovernmentScorecardV6ChartSlide,
} from "@/lib/government-scorecard-page";

import {
  getClosestGovernmentChartPointIndex,
  GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX as VIEWBOX,
} from "./chart-geometry";
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
} from "./chart-utils";
import styles from "../government-scorecard.module.css";

type ChartScope = "mandate" | "complete";

function formatChange(value: number, unit: string): string {
  return `${value > 0 ? "+" : ""}${formatGovernmentChartValue(value, unit)}`;
}

function IndicatorChart({
  chart,
  scope,
  position,
  total,
  listView = false,
}: {
  chart: GovernmentScorecardV6ChartSlide;
  scope: ChartScope;
  position: number;
  total: number;
  listView?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const window = scope === "mandate" ? chart.mandate_window : chart.complete_window;
  const visibleSeries = useMemo(() => chart.series.map((series) => ({
    ...series,
    points: series.points.filter((point) => isGovernmentChartPointInWindow(
      point.period_start,
      window.start_date,
      window.end_date,
      window.end_exclusive,
      chart.frequency,
    )),
  })), [chart.frequency, chart.series, window.end_date, window.end_exclusive, window.start_date]);
  const periods = useMemo(() => [...new Set(visibleSeries.flatMap((series) => series.points.map((point) => point.period)))]
    .toSorted((left, right) => Date.parse(`${visibleSeries.flatMap((series) => series.points).find((point) => point.period === left)?.period_start}T00:00:00Z`)
      - Date.parse(`${visibleSeries.flatMap((series) => series.points).find((point) => point.period === right)?.period_start}T00:00:00Z`)), [visibleSeries]);
  const startBoundaryPeriod = scope === "mandate"
    ? visibleSeries.flatMap((series) => series.points).find((point) => isGovernmentChartStartBoundaryPeriod(
      point.period_start,
      window.start_date,
      chart.frequency,
    ))?.period ?? null
    : null;
  const periodIndex = useMemo(() => new Map(periods.map((period, index) => [period, index])), [periods]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const activePeriod = selectedPeriod !== null && periods.includes(selectedPeriod) ? selectedPeriod : periods.at(-1) ?? null;
  const values = visibleSeries.flatMap((series) => series.points.map((point) => point.value));
  const hasTrend = hasGovernmentChartTrend(periods);
  const rawMinimum = values.length > 0 ? Math.min(...values) : 0;
  const rawMaximum = values.length > 0 ? Math.max(...values) : 1;
  const padding = Math.max((rawMaximum - rawMinimum) * 0.12, Math.abs(rawMaximum || 1) * 0.015, 0.1);
  const minimum = rawMinimum - padding;
  const maximum = rawMaximum + padding;
  const plotWidth = VIEWBOX.width - VIEWBOX.left - VIEWBOX.right;
  const plotHeight = VIEWBOX.height - VIEWBOX.top - VIEWBOX.bottom;
  const x = (period: string) => periods.length <= 1
    ? VIEWBOX.left + plotWidth / 2
    : VIEWBOX.left + ((periodIndex.get(period) ?? 0) / (periods.length - 1)) * plotWidth;
  const y = (value: number) => VIEWBOX.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - ((maximum - minimum) * index) / 4);
  const axisPeriods = periods.length <= 2
    ? periods
    : [periods[0]!, periods[Math.floor((periods.length - 1) / 2)]!, periods.at(-1)!];

  const chooseFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (periods.length === 0) return;
    const svg = event.currentTarget;
    const screenMatrix = svg.getScreenCTM();
    if (screenMatrix === null) return;
    const pointer = svg.createSVGPoint();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const closest = getClosestGovernmentChartPointIndex(
      periods.length,
      pointer.matrixTransform(screenMatrix.inverse()).x,
    );
    if (closest === null) return;
    setSelectedPeriod(periods[closest]!);
  };

  const onPlotKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (periods.length === 0) return;
    const currentIndex = Math.max(0, periods.indexOf(activePeriod ?? periods.at(-1)!));
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      setSelectedPeriod(periods[Math.min(periods.length - 1, Math.max(0, currentIndex + delta))]!);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedPeriod(periods[0]!);
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedPeriod(periods.at(-1)!);
    }
  };

  const summaries = visibleSeries.map((series) => {
    const first = series.points[0];
    const last = series.points.at(-1);
    return {
      ...series,
      first,
      last,
      change: first && last && last.period_start > first.period_start ? last.value - first.value : null,
    };
  });

  return (
    <article
      className={styles.timeSeriesCard}
      data-slide-id={chart.indicator_id}
      data-view={listView ? "list" : "carousel"}
      role={listView ? undefined : "group"}
      aria-roledescription={listView ? undefined : "slide"}
      aria-label={listView ? undefined : `${position} di ${total}: ${chart.title}`}
    >
      <header className={styles.timeSeriesHeading}>
        <div>
          <span className={styles.contextPosition}>{position} / {total}</span>
          <h3 id={titleId}>{chart.title}</h3>
          <p>{chart.question}</p>
          <p className={styles.chartMeta}>
            Valori: {chart.unit} · {chart.frequency === "Annuale" ? "un punto per ogni anno" : `un punto per ogni periodo ${chart.frequency.toLowerCase()}`}
          </p>
          {startBoundaryPeriod === null ? null : (
            <p className={styles.chartMeta}>
              Periodo di insediamento: {formatGovernmentChartPeriod(startBoundaryPeriod)} · può includere giorni precedenti al giuramento.
            </p>
          )}
        </div>
      </header>

      <ul className={styles.chartLegend} aria-label="Legenda delle quattro linee">
        {chart.series.map((series) => (
          <li key={series.id}>
            <span style={{ backgroundColor: GOVERNMENT_CHART_COLORS[series.id] }} aria-hidden="true" />
            <b aria-hidden="true">{GOVERNMENT_CHART_MARKERS[series.id]}</b>{series.label}
          </li>
        ))}
      </ul>

      <div className={styles.timeSeriesPlot} data-chart-plot="true">
        {values.length === 0 ? (
          <p className={styles.emptyState} role="status">
            Nessun dato pubblicato nella finestra esatta di questo mandato.
          </p>
        ) : !hasTrend ? (
          <p className={styles.emptyState} role="status">
            Un solo periodo pubblicato nel mandato non basta per mostrare un andamento. Puoi aprire la serie completa.
          </p>
        ) : <svg
          viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          tabIndex={0}
          onPointerMove={chooseFromPointer}
          onPointerDown={chooseFromPointer}
          onKeyDown={onPlotKeyDown}
        >
          <desc id={descriptionId}>
            {`${chart.question} Dati pubblicati dal ${periods[0]} al ${periods.at(-1)}. Usa freccia sinistra e destra per leggere un periodo.`}
          </desc>
          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line className={styles.chartGridLine} x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={tickY} y2={tickY} />
                <text className={styles.chartAxisLabel} x={VIEWBOX.left - 8} y={tickY + 4} textAnchor="end">
                  {formatGovernmentChartValue(tick, chart.unit)}
                </text>
              </g>
            );
          })}
          <line className={styles.chartAxisLine} x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={VIEWBOX.top + plotHeight} y2={VIEWBOX.top + plotHeight} />
          {axisPeriods.map((period) => (
            <text className={styles.chartAxisLabel} key={period} x={x(period)} y={VIEWBOX.height - 14} textAnchor="middle">{formatGovernmentChartPeriod(period)}</text>
          ))}
          {visibleSeries.map((series) => splitGovernmentChartAtMissingPeriods(series.points, periods).map((segment, index) => (
            <path
              className={styles.countryLine}
              d={segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${x(point.period)},${y(point.value)}`).join(" ")}
              key={`${series.id}-${index}`}
              stroke={GOVERNMENT_CHART_COLORS[series.id]}
              strokeDasharray={GOVERNMENT_CHART_PATTERNS[series.id]}
            />
          )))}
          {visibleSeries.flatMap((series) => series.points.map((point) => (
            <circle
              className={styles.countryPoint}
              cx={x(point.period)}
              cy={y(point.value)}
              fill={GOVERNMENT_CHART_COLORS[series.id]}
              key={`${series.id}-${point.period}`}
              r={point.period === activePeriod ? 5 : 2.5}
            />
          )))}
          {activePeriod === null ? null : (
            <line
              className={styles.chartCursor}
              x1={x(activePeriod)}
              x2={x(activePeriod)}
              y1={VIEWBOX.top}
              y2={VIEWBOX.top + plotHeight}
            />
          )}
        </svg>}
      </div>
      {activePeriod === null ? null : (
        <div className={styles.chartTooltip} role="status" aria-live="polite">
          <strong>{formatGovernmentChartPeriod(activePeriod)}</strong>
          {visibleSeries.map((series) => {
            const point = series.points.find((candidate) => candidate.period === activePeriod);
            return (
              <span key={series.id}>
                <i style={{ backgroundColor: GOVERNMENT_CHART_COLORS[series.id] }} aria-hidden="true" />
                <b aria-hidden="true">{GOVERNMENT_CHART_MARKERS[series.id]}</b>{series.label}: {point ? `${formatGovernmentChartValue(point.value, chart.unit)}${formatGovernmentChartPointStatus(point)}` : "n.d."}
              </span>
            );
          })}
        </div>
      )}

      <div className={styles.seriesSummary} aria-label="Valori iniziali, finali e variazioni">
        {summaries.map((series) => (
          <article key={series.id}>
            <h4><span style={{ backgroundColor: GOVERNMENT_CHART_COLORS[series.id] }} aria-hidden="true" /><b aria-hidden="true">{GOVERNMENT_CHART_MARKERS[series.id]}</b>{series.label}</h4>
            {series.first && series.last && series.change !== null ? (
              <dl>
                <div><dt>Inizio del periodo · {formatGovernmentChartPeriod(series.first.period)}</dt><dd>{formatGovernmentChartValue(series.first.value, chart.unit)}{formatGovernmentChartPointStatus(series.first)}</dd></div>
                <div><dt>Fine del periodo · {formatGovernmentChartPeriod(series.last.period)}</dt><dd>{formatGovernmentChartValue(series.last.value, chart.unit)}{formatGovernmentChartPointStatus(series.last)}</dd></div>
                <div><dt>Variazione</dt><dd>{formatChange(series.change, chart.unit)}</dd></div>
              </dl>
            ) : <p>Servono almeno due periodi pubblicati per calcolare una variazione.</p>}
          </article>
        ))}
      </div>

      <details className={styles.chartTableDetails}>
        <summary>Apri la tabella equivalente</summary>
        <div className={styles.tableRegion} role="region" aria-label={`Tabella di ${chart.title}`} tabIndex={0}>
          <table>
            <caption>{chart.title}, dati {chart.frequency.toLowerCase()} pubblicati</caption>
            <thead>
              <tr>
                <th scope="col">Paese</th>
                {periods.map((period) => <th scope="col" key={period}>{formatGovernmentChartPeriod(period)}</th>)}
                <th scope="col">Variazione</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((series) => (
                <tr key={series.id}>
                  <th scope="row">{series.label}</th>
                  {periods.map((period) => {
                    const point = series.points.find((candidate) => candidate.period === period);
                    return <td key={period}>{point ? `${formatGovernmentChartValue(point.value, chart.unit)}${formatGovernmentChartPointStatus(point)}` : "n.d."}</td>;
                  })}
                  <td>{series.change === null ? "n.d." : formatChange(series.change, chart.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className={styles.chartNote}>{chart.note}</p>
      <p className={styles.chartSource}>
        Fonte: <a href={chart.source.url} target="_blank" rel="noreferrer" aria-label={`Apri la fonte ${chart.source.owner} in una nuova scheda`}>{chart.source.owner} ↗</a>
        {` · Versione dei dati: ${chart.source.data_version} · recuperato il ${chart.source.retrieved_at.slice(0, 10)}`}
      </p>
    </article>
  );
}

export function IndicatorCarousel({ charts }: { charts: GovernmentScorecardV6ChartCollection }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [scope, setScope] = useState<ChartScope>(charts.status === "ready" ? charts.default_scope : "mandate");
  const [listView, setListView] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  if (charts.status === "empty") return <p className={styles.emptyState}>{charts.message}</p>;
  const total = charts.slides.length;
  const activeSlide = charts.slides[activeIndex];
  if (!activeSlide) return null;

  const move = (delta: number) => setActiveIndex((current) => (current + delta + total) % total);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(total - 1);
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[data-chart-plot="true"]')) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY)) move(deltaX < 0 ? 1 : -1);
  };

  return (
    <div className={styles.indicatorCarousel} aria-label="Grafici degli indicatori">
      <div className={styles.chartToolbar}>
        <div className={styles.toolbarActions}>
          <div className={styles.scopeControl} role="group" aria-label="Intervallo dei grafici">
            <button type="button" aria-pressed={scope === "mandate"} onClick={() => setScope("mandate")}>Mandato</button>
            <button type="button" aria-pressed={scope === "complete"} onClick={() => setScope("complete")}>Serie completa</button>
          </div>
          <button type="button" className={styles.viewToggle} aria-pressed={listView} onClick={() => setListView((current) => !current)}>
            {listView ? "Vista carosello" : "Vista elenco"}
          </button>
        </div>
      </div>

      {listView ? (
        <ol className={styles.indicatorList} aria-label="Tutti i grafici degli indicatori">
          {charts.slides.map((chart, index) => (
            <li key={chart.indicator_id}>
              <IndicatorChart chart={chart} scope={scope} position={index + 1} total={total} listView />
            </li>
          ))}
        </ol>
      ) : (
        <div
          className={styles.indicatorViewport}
          role="group"
          aria-roledescription="carosello"
          aria-label={`Grafico ${activeIndex + 1} di ${total}: ${activeSlide.title}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { pointerStart.current = null; }}
        >
          <IndicatorChart chart={activeSlide} scope={scope} position={activeIndex + 1} total={total} />
        </div>
      )}

      <div className={styles.carouselControls} aria-label="Controlli dei grafici">
        <button type="button" onClick={() => move(-1)} aria-label="Grafico precedente">←</button>
        <div className={styles.carouselIndicators} aria-label="Scegli un indicatore">
          {charts.slides.map((chart, index) => (
            <button
              type="button"
              key={chart.indicator_id}
              aria-label={`Vai a ${chart.title}`}
              aria-current={index === activeIndex ? "step" : undefined}
              onClick={() => setActiveIndex(index)}
            >
              <span>{chart.title}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => move(1)} aria-label="Grafico successivo">→</button>
      </div>
    </div>
  );
}
