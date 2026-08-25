"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./territory-metric-chart.module.css";

export type TerritoryMetricHistoryPoint = Readonly<{
  year: number;
  value: number | null;
  formattedValue: string;
  periodLabel: string;
  partial: boolean;
}>;

export type TerritoryMetricChartPoint = Readonly<{
  label: string;
  value: number;
  formattedValue: string;
  exactValue: string;
  total: string;
  perCapita: string;
  perSquareKm: string;
  population: string;
  surface: string;
  detailHref: string | null;
  history: readonly TerritoryMetricHistoryPoint[];
}>;

function Trend({ point }: { point: TerritoryMetricChartPoint }) {
  const values = point.history.flatMap((item) => item.value === null ? [] : [item.value]);
  const maximum = Math.max(...values, 1);

  return (
    <section className={styles.trend} aria-labelledby="territory-trend-title">
      <div>
        <h3 id="territory-trend-title">Valori pubblicati nel tempo</h3>
        <p>Il tratteggio identifica un anno ancora parziale: confronta sempre periodi equivalenti.</p>
      </div>
      <ol>
        {point.history.map((item) => (
          <li key={item.year}>
            <span>{item.year}</span>
            <span className={styles.trendTrack} aria-hidden="true">
              <i
                className={item.partial ? styles.partialTrendBar : undefined}
                style={{ "--trend-width": `${item.value === null ? 0 : Math.max(2, item.value / maximum * 100)}%` } as CSSProperties}
              />
            </span>
            <strong>{item.formattedValue}</strong>
            <small>{item.periodLabel}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TerritoryMetricChart({
  points,
  title,
  description,
  reference,
  initialRegion = null,
  initialComparison = [],
}: {
  points: readonly TerritoryMetricChartPoint[];
  title: string;
  description: string;
  reference: Readonly<{ label: string; value: number; formattedValue: string }> | null;
  initialRegion: string | null;
  initialComparison: readonly string[];
}) {
  const router = useRouter();
  const pointByLabel = useMemo(() => new Map(points.map((point) => [point.label, point])), [points]);
  const fallbackRegion = pointByLabel.has(initialRegion ?? "") ? initialRegion : null;
  const [selectedRegion, setSelectedRegion] = useState<string | null>(fallbackRegion);
  const [comparison, setComparison] = useState<string[]>(
    initialComparison.filter((region) => pointByLabel.has(region)).slice(0, 3),
  );
  const maximum = Math.max(...points.map((point) => point.value), reference?.value ?? 0, 1);
  const referencePosition = reference ? `${Math.min(100, reference.value / maximum * 100)}%` : "0%";
  const selected = selectedRegion ? pointByLabel.get(selectedRegion) ?? null : null;

  const updateUrl = (region: string | null, regionsToCompare: readonly string[]) => {
    const url = new URL(window.location.href);
    if (region) url.searchParams.set("regione", region);
    else url.searchParams.delete("regione");
    if (regionsToCompare.length > 0) url.searchParams.set("confronta", regionsToCompare.join(","));
    else url.searchParams.delete("confronta");
    router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
  };

  const focus = (region: string) => {
    setSelectedRegion(region);
    updateUrl(region, comparison);
  };

  const toggleComparison = (region: string) => {
    const next = comparison.includes(region)
      ? comparison.filter((item) => item !== region)
      : comparison.length < 3 ? [...comparison, region] : comparison;
    setComparison(next);
    updateUrl(selectedRegion, next);
  };

  return (
    <figure className={styles.figure} aria-labelledby="territory-chart-title">
      <div className={styles.heading}>
        <div>
          <h2 className="panel-title" id="territory-chart-title">{title}</h2>
          <p>{description}</p>
        </div>
        {reference ? (
          <div className={styles.referenceLabel}>
            <i aria-hidden="true" />
            <span>{reference.label}</span>
            <strong>{reference.formattedValue}</strong>
          </div>
        ) : null}
      </div>

      <label className={styles.regionSearch}>
        <span>Trova una regione</span>
        <select value={selectedRegion ?? ""} onChange={(event) => event.target.value && focus(event.target.value)}>
          <option value="">Seleziona una regione</option>
          {[...points].sort((left, right) => left.label.localeCompare(right.label, "it-IT")).map((point) => (
            <option key={point.label} value={point.label}>{point.label}</option>
          ))}
        </select>
      </label>

      <ol className={styles.chart}>
        {points.map((point) => (
          <li key={point.label} data-selected={selectedRegion === point.label || undefined}>
            <button type="button" className={styles.regionName} onClick={() => focus(point.label)}>
              {point.label}
            </button>
            <button
              type="button"
              className={styles.track}
              onClick={() => focus(point.label)}
              style={{
                "--bar-width": `${Math.max(1, point.value / maximum * 100)}%`,
                "--reference-position": referencePosition,
              } as CSSProperties}
              aria-label={`${point.label}: ${point.exactValue}. Apri il dettaglio nel grafico.`}
            >
              <i className={styles.bar} aria-hidden="true" />
              {reference ? <i className={styles.reference} aria-hidden="true" /> : null}
            </button>
            <strong className={styles.value} title={point.exactValue}>{point.formattedValue}</strong>
          </li>
        ))}
      </ol>

      {selected ? (
        <div className={styles.selectedPanel} aria-live="polite">
          <div className={styles.selectedHeading}>
            <div>
              <span>Regione selezionata</span>
              <h3>{selected.label}</h3>
            </div>
            <button
              type="button"
              onClick={() => toggleComparison(selected.label)}
              disabled={!comparison.includes(selected.label) && comparison.length >= 3}
            >
              {comparison.includes(selected.label) ? "Rimuovi dal confronto" : "Aggiungi al confronto"}
            </button>
          </div>
          <dl className={styles.selectedStats}>
            <div><dt>Totale</dt><dd>{selected.total}</dd></div>
            <div><dt>Per abitante</dt><dd>{selected.perCapita}</dd></div>
            <div><dt>Per km²</dt><dd>{selected.perSquareKm}</dd></div>
            <div><dt>Territorio</dt><dd>{selected.population} · {selected.surface}</dd></div>
          </dl>
          {selected.detailHref ? <a href={selected.detailHref}>Apri entrate, spese e saldo della regione →</a> : null}
          <Trend point={selected} />
        </div>
      ) : (
        <p className={styles.selectionHint}>Seleziona una barra o cerca una regione per vedere tutte le misure e la serie disponibile.</p>
      )}

      {comparison.length > 0 ? (
        <section className={styles.comparison} aria-labelledby="territory-comparison-title">
          <div>
            <h3 id="territory-comparison-title">Confronto diretto</h3>
            <p>Fino a tre regioni, con gli stessi denominatori.</p>
          </div>
          <div className={styles.comparisonGrid}>
            {comparison.map((region) => {
              const point = pointByLabel.get(region);
              if (!point) return null;
              return (
                <article key={region}>
                  <button type="button" onClick={() => toggleComparison(region)} aria-label={`Rimuovi ${region} dal confronto`}>×</button>
                  <h4>{region}</h4>
                  <dl>
                    <div><dt>Totale</dt><dd>{point.total}</dd></div>
                    <div><dt>Per abitante</dt><dd>{point.perCapita}</dd></div>
                    <div><dt>Per km²</dt><dd>{point.perSquareKm}</dd></div>
                    <div><dt>Superficie</dt><dd>{point.surface}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <figcaption>
        Le regioni sono ordinate secondo la misura selezionata. I valori abbreviati facilitano la lettura;
        il valore completo è disponibile nel dettaglio e nella tabella.
      </figcaption>
    </figure>
  );
}
