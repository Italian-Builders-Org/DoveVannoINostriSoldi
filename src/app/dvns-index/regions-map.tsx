"use client";

import Link from "next/link";
import { useState } from "react";

import { ITALY_REGIONS_VIEWBOX, italyRegionGeometry } from "@/data/generated/italy-regions";
import type { Band, RegionSummary } from "@/lib/dvns-index";

import styles from "./dvns-index.module.css";

type Mode = "median" | "weighted";
const BANDS: Band[] = ["A", "B", "C", "D", "E"];
const one = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });

const MODE_NOTE: Record<Mode, string> = {
  median: "Comune tipico: il punteggio mediano dei Comuni in classifica. Ogni Comune conta uno, piccolo o grande.",
  weighted: "Per abitante: la media dei punteggi pesata sulla popolazione. Conta di più dove vive più gente, quindi le grandi città spostano molto il risultato.",
};

function shortName(name: string): string {
  if (name.startsWith("Trentino")) return "Trentino-Alto Adige";
  if (name.startsWith("Friuli")) return "Friuli-Venezia Giulia";
  if (name.startsWith("Valle")) return "Valle d'Aosta";
  return name;
}

function Distribution({ bands, total, labels }: { bands: Record<Band, number>; total: number; labels: boolean }) {
  return (
    <span className={styles.regionDist} aria-hidden={!labels}>
      {BANDS.map((band) =>
        bands[band] ? (
          <span key={band} data-band={band} style={{ flexGrow: bands[band] }} title={`Fascia ${band}: ${bands[band]} Comuni`}>
            {labels && bands[band] / total >= 0.08 ? `${band} ${Math.round((100 * bands[band]) / total)}%` : ""}
          </span>
        ) : null,
      )}
    </span>
  );
}

/**
 * Regions coloured by the band of their typical Comune, with the same
 * cut-offs as the national ranking. Special-statute regions are hatched:
 * OpenCivitas does not cover them, so they have no score.
 */
export function RegionsMap({ regions, cutoffs }: { regions: RegionSummary[]; cutoffs: number[] }) {
  const [mode, setMode] = useState<Mode>("median");
  const [selected, setSelected] = useState("05");
  const byCode = new Map(regions.map((region) => [region.code, region]));
  const value = (region: RegionSummary | undefined) => (region?.ranked ? region[mode] : null);
  const band = (region: RegionSummary | undefined) => (region?.ranked ? (mode === "median" ? region.bandMedian : region.bandWeighted) : null);
  const names = new Map<string, string>(italyRegionGeometry.map((geometry) => [geometry.code, shortName(geometry.name)]));
  const order = regions.filter((region) => region.ranked).sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0));
  const current = byCode.get(selected);
  const position = order.findIndex((region) => region.code === selected) + 1;
  const legend = [`da ${one.format(cutoffs[0])}`, `${one.format(cutoffs[1])}-${one.format(cutoffs[0])}`, `${one.format(cutoffs[2])}-${one.format(cutoffs[1])}`, `${one.format(cutoffs[3])}-${one.format(cutoffs[2])}`, `sotto ${one.format(cutoffs[3])}`];

  return (
    <div className={styles.regions}>
      <div className={styles.modeToggle} role="group" aria-label="Come riassumere la Regione">
        {(["median", "weighted"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)} data-region-mode={item}>
            {item === "median" ? "Comune tipico" : "Per abitante"}
          </button>
        ))}
      </div>
      <p className={styles.lede}>{MODE_NOTE[mode]}</p>
      <div className={styles.regionLayout}>
        <div>
          <svg className={styles.regionSvg} viewBox={ITALY_REGIONS_VIEWBOX} role="group" aria-label="Mappa delle Regioni colorate per fascia">
            <defs>
              <pattern id="dvns-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--color-raised)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-neutral-400)" strokeWidth="1.2" />
              </pattern>
            </defs>
            {italyRegionGeometry.map((geometry) => {
              const region = byCode.get(geometry.code);
              const regionBand = band(region);
              const label = `${shortName(geometry.name)}: ${regionBand ? `${one.format(value(region) ?? 0)}, fascia ${regionBand}` : "non valutabile"}`;
              return (
                <path
                  key={geometry.code}
                  d={geometry.path}
                  data-region={geometry.code}
                  data-band={regionBand ?? "none"}
                  data-selected={geometry.code === selected ? "true" : undefined}
                  tabIndex={regionBand ? 0 : -1}
                  role={regionBand ? "button" : undefined}
                  aria-label={label}
                  aria-pressed={regionBand ? geometry.code === selected : undefined}
                  onClick={() => regionBand && setSelected(geometry.code)}
                  onKeyDown={(event) => {
                    if (regionBand && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      setSelected(geometry.code);
                    }
                  }}
                >
                  <title>{label}</title>
                </path>
              );
            })}
          </svg>
          <ul className={styles.regionLegend} aria-label="Legenda">
            {BANDS.map((item, index) => (
              <li key={item}><i data-band={item} aria-hidden="true" />{item} {legend[index]}</li>
            ))}
            <li><i data-band="none" aria-hidden="true" />Statuto speciale, non valutabile</li>
          </ul>
        </div>
        <div className={styles.regionSide}>
          {current && current.ranked && current.median !== null && current.weighted !== null ? (
            <div className={styles.regionCard} aria-live="polite" data-region-card={current.code}>
              <h3>
                {names.get(current.code)} <span className={styles.band} data-band={band(current) ?? undefined}>{band(current)}</span>
              </h3>
              <p className={styles.regionScore}>{one.format(value(current) ?? 0)}<small>/100</small></p>
              <p>
                <strong>{position}ª su {order.length}</strong> · Comune tipico {one.format(current.median)}, per abitante {one.format(current.weighted)}
              </p>
              <Distribution bands={current.bands} total={current.ranked} labels />
              <p>
                {BANDS.map((item) => `${item}: ${current.bands[item]}`).join(" · ")} Comuni.
                {current.best && current.worst ? (
                  <> Migliore: <strong>{current.best.name}</strong> ({one.format(current.best.score)}); peggiore: <strong>{current.worst.name}</strong> ({one.format(current.worst.score)}).</>
                ) : null}
              </p>
              <p>
                In classifica {integer.format(current.ranked)} Comuni su {integer.format(current.comuni)} ({Math.round(current.coverage * 100)}%), dove vive il{" "}
                {Math.round(current.populationCoverage * 100)}% degli abitanti.
                {current.coverage < 0.75 ? " Copertura bassa: il valore della Regione va letto con cautela." : ""}
              </p>
              <Link href={`/dvns-index?regione=${current.code}#classifica`} prefetch={false} className={styles.regionGo}>
                Vedi questi Comuni in classifica
              </Link>
            </div>
          ) : null}
          <ol className={styles.regionList} aria-label="Regioni in ordine di punteggio">
            {order.map((region, index) => (
              <li key={region.code}>
                <button type="button" aria-pressed={region.code === selected} onClick={() => setSelected(region.code)} data-region-row={region.code}>
                  <span className={styles.regionPos}>{index + 1}</span>
                  <span>{names.get(region.code)}</span>
                  <span className={styles.regionValue}>{one.format(value(region) ?? 0)}</span>
                  <span className={styles.band} data-band={band(region) ?? undefined}>{band(region)}</span>
                  <Distribution bands={region.bands} total={region.ranked} labels={false} />
                </button>
              </li>
            ))}
            {regions.filter((region) => !region.ranked).sort((a, b) => a.code.localeCompare(b.code)).map((region) => (
              <li key={region.code}>
                <span className={styles.regionNa}>
                  <span className={styles.regionPos}>·</span>
                  <span>{names.get(region.code)}</span>
                  <span>non valutabile</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
