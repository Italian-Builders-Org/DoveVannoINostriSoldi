"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ITALY_REGIONS_VIEWBOX,
  italyRegionGeometry,
} from "@/data/generated/italy-regions";
import type { SiopeRegionPoint } from "@/lib/siope-snapshot";
import {
  REGION_NAME_BY_ISTAT_CODE,
  regionDataByIstatCode,
} from "@/lib/italy-regions";
import { compactEuro, exactEuro, integer } from "@/lib/format";
import styles from "./italy-regions-map.module.css";

type RegionalMetricDefinition = {
  label: string;
  title: string;
  legendLabel: string;
  legendEnds: readonly [string, string];
  value: (region: SiopeRegionPoint | undefined) => number | null;
  format: (value: number) => string;
  ariaSuffix: string;
};

const regionalMetrics = {
  "per-capita": {
    label: "Per abitante",
    title: "Pagamenti comunali per abitante coperto, per regione",
    legendLabel: "Scala dei pagamenti per abitante coperto",
    legendEnds: ["Meno per abitante", "Più per abitante"],
    value: (region) => region?.perCapita ?? null,
    format: exactEuro,
    ariaSuffix: "per abitante coperto",
  },
  total: {
    label: "Totale pagato",
    title: "Pagamenti comunali totali, per regione",
    legendLabel: "Scala dei pagamenti totali",
    legendEnds: ["Totale minore", "Totale maggiore"],
    value: (region) => region?.value ?? null,
    format: compactEuro,
    ariaSuffix: "pagati",
  },
  municipalities: {
    label: "Comuni inclusi",
    title: "Comuni inclusi nei dati SIOPE, per regione",
    legendLabel: "Scala del numero di Comuni inclusi",
    legendEnds: ["Meno Comuni", "Più Comuni"],
    value: (region) => region?.municipalities ?? null,
    format: integer,
    ariaSuffix: "Comuni inclusi",
  },
} satisfies Record<string, RegionalMetricDefinition>;

type RegionalMetric = keyof typeof regionalMetrics;

const italianRegionCollator = new Intl.Collator("it");
const regionOptions = Object.entries(REGION_NAME_BY_ISTAT_CODE).sort(([, left], [, right]) =>
  italianRegionCollator.compare(left, right),
);
const regionalMetricEntries = Object.entries(regionalMetrics) as Array<
  [RegionalMetric, RegionalMetricDefinition]
>;
const navigableRegionCodes: string[] = italyRegionGeometry.map(({ code }) => code);

function quantile(values: number[], fraction: number): number {
  const index = Math.min(values.length - 1, Math.floor(values.length * fraction));
  return values[index] ?? 0;
}

export function ItalyRegionsMap({
  regions,
  period,
  summary,
  detailsHref,
}: {
  regions: SiopeRegionPoint[];
  period: string;
  summary?: React.ReactNode;
  detailsHref: string;
}) {
  const [metric, setMetric] = useState<RegionalMetric>("per-capita");
  const [selectedCode, setSelectedCode] = useState("03");
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [automaticSelection, setAutomaticSelection] = useState<"ip" | null>(null);
  const userSelected = useRef(false);
  const regionPathRefs = useRef(new Map<string, SVGPathElement>());
  const byCode = useMemo(() => regionDataByIstatCode(regions), [regions]);
  const metricDefinition = regionalMetrics[metric];
  const thresholds = useMemo(() => {
    const values = regions
      .map(metricDefinition.value)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    return [0.2, 0.4, 0.6, 0.8].map((fraction) => quantile(values, fraction));
  }, [metricDefinition, regions]);

  useEffect(() => {
    const controller = new AbortController();

    async function chooseInitialRegion() {
      try {
        const response = await fetch("/api/location", {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Location HTTP ${response.status}`);
        const payload = (await response.json()) as { region?: { code?: string } | null };
        const code = payload.region?.code;
        if (!userSelected.current && code && byCode.get(code)) {
          setSelectedCode(code);
          setAutomaticSelection("ip");
        }
      } catch {
        if (controller.signal.aborted) return;
      }
    }

    void chooseInitialRegion();
    return () => controller.abort();
  }, [byCode]);

  function selectRegion(code: string) {
    userSelected.current = true;
    setSelectionLocked(true);
    setAutomaticSelection(null);
    setFocusedCode(code);
    setHoveredCode(null);
    setSelectedCode(code);
  }

  function previewRegion(code: string) {
    setHoveredCode(code);
  }

  function clearPreview(code: string) {
    setHoveredCode((current) => (current === code ? null : current));
  }

  const displayedCode = selectionLocked ? selectedCode : hoveredCode ?? selectedCode;
  const selected = byCode.get(displayedCode);
  const outlinedCodes = [selectedCode, hoveredCode].filter(
    (code, index, codes): code is string => code !== null && codes.indexOf(code) === index,
  );

  function handleRegionKeyDown(event: React.KeyboardEvent<SVGPathElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectRegion(code);
      return;
    }

    const currentIndex = navigableRegionCodes.indexOf(code);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % navigableRegionCodes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + navigableRegionCodes.length) % navigableRegionCodes.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = navigableRegionCodes.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextCode = navigableRegionCodes[nextIndex];
    setFocusedCode(nextCode);
    previewRegion(nextCode);
    regionPathRefs.current.get(nextCode)?.focus();
  }

  function level(value: number | null): number | null {
    if (value === null) return null;
    const matchingIndex = thresholds.findIndex((threshold) => value <= threshold);
    return matchingIndex === -1 ? thresholds.length : matchingIndex;
  }

  return (
    <div className={styles.layout}>
      <div className={styles.controls}>
        <fieldset className={styles.metricControl}>
          <legend>Misura</legend>
          <div>
            {regionalMetricEntries.map(([value, definition]) => (
              <button
                type="button"
                key={value}
                data-region-metric={value}
                aria-pressed={metric === value}
                onClick={() => setMetric(value)}
              >
                {definition.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className={styles.regionSelector}>
          <span>Territorio</span>
          <select
            data-region-selector="true"
            value={selectedCode}
            onChange={(event) => selectRegion(event.target.value)}
          >
            {regionOptions.map(([code, name]) => (
              <option value={code} key={code}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.mapColumn}>
        <div className={styles.mapHeading}>
          <strong>{metricDefinition.title}</strong>
          <span>{period}</span>
        </div>
        <svg
          className={styles.map}
          viewBox={ITALY_REGIONS_VIEWBOX}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          data-region-map="true"
          aria-labelledby="regional-map-title regional-map-description"
        >
          <title id="regional-map-title">{metricDefinition.title}</title>
          <desc id="regional-map-description">
            Mappa regionale colorata in base alla misura selezionata. Usa Tab per entrare nella
            mappa e i tasti freccia per esplorare le regioni. Passa sopra una regione per
            un’anteprima; fai clic o premi Invio per fissarla nel pannello accanto.
          </desc>
          {italyRegionGeometry.map((geometry) => {
            const region = byCode.get(geometry.code);
            const value = metricDefinition.value(region);
            const colorLevel = level(value);
            const selectedRegion = selectedCode === geometry.code;
            const focusable = (focusedCode ?? selectedCode) === geometry.code;
            const hovered = hoveredCode === geometry.code;
            return (
              <path
                ref={(node) => {
                  if (node) regionPathRefs.current.set(geometry.code, node);
                  else regionPathRefs.current.delete(geometry.code);
                }}
                key={geometry.code}
                d={geometry.path}
                className={`${styles.region} ${
                  colorLevel === null ? styles.noData : styles[`level${colorLevel}`]
                }`}
                tabIndex={focusable ? 0 : -1}
                role="button"
                aria-pressed={selectedRegion}
                aria-label={`${REGION_NAME_BY_ISTAT_CODE[geometry.code]}: ${
                  value === null
                    ? "dato non disponibile"
                    : `${metricDefinition.format(value)} ${metricDefinition.ariaSuffix}`
                }`}
                data-hovered={hovered ? "true" : undefined}
                data-selected={selectedRegion ? "true" : undefined}
                onPointerEnter={() => previewRegion(geometry.code)}
                onPointerLeave={() => clearPreview(geometry.code)}
                onFocus={() => {
                  setFocusedCode(geometry.code);
                  previewRegion(geometry.code);
                }}
                onBlur={() => clearPreview(geometry.code)}
                onClick={() => selectRegion(geometry.code)}
                onKeyDown={(event) => handleRegionKeyDown(event, geometry.code)}
              />
            );
          })}
          {outlinedCodes.map((code) => {
            const geometry = italyRegionGeometry.find((item) => item.code === code);
            if (!geometry) return null;
            const isSelected = code === selectedCode;
            const isHovered = code === hoveredCode;
            return (
              <path
                key={`outline-${code}`}
                d={geometry.path}
                className={`${styles.outline} ${isSelected ? styles.selectedOutline : ""} ${
                  isHovered ? styles.hoverOutline : ""
                }`}
                aria-hidden="true"
                focusable="false"
                pointerEvents="none"
              />
            );
          })}
        </svg>

        <div className={styles.legend} aria-label={metricDefinition.legendLabel}>
          <span className={styles.legendEnd}>{metricDefinition.legendEnds[0]}</span>
          {[0, 1, 2, 3, 4].map((index) => (
            <i
              key={index}
              className={styles[`level${index}`]}
              title={
                index === 0
                  ? `fino a ${metricDefinition.format(thresholds[0])}`
                  : index === 4
                    ? `oltre ${metricDefinition.format(thresholds[3])}`
                    : `da ${metricDefinition.format(thresholds[index - 1])} a ${metricDefinition.format(thresholds[index])}`
              }
            />
          ))}
          <span className={styles.legendEnd}>{metricDefinition.legendEnds[1]}</span>
        </div>

        {automaticSelection ? (
          <p className={styles.geoNote}>
            Regione proposta dalla posizione approssimativa dell’IP; l’indirizzo non viene mostrato
            né salvato.
          </p>
        ) : null}

        {summary ? <div className={styles.summary}>{summary}</div> : null}
      </div>

      <aside className={styles.inspector} data-region-detail="true" aria-live="polite">
        <span className={styles.inspectorLabel}>Regione selezionata</span>
        <b>{selected?.region ?? "Dato non disponibile"}</b>
        <dl>
          <div>
            <dt>Per abitante</dt>
            <dd>{selected?.perCapita === null || !selected ? "n.d." : exactEuro(selected.perCapita)}</dd>
          </div>
          <div>
            <dt>Totale pagato</dt>
            <dd>{selected ? compactEuro(selected.value) : "n.d."}</dd>
          </div>
          <div>
            <dt>Popolazione coperta</dt>
            <dd>{selected?.population == null ? "n.d." : integer(selected.population)}</dd>
          </div>
          <div>
            <dt>Comuni inclusi</dt>
            <dd>{selected ? integer(selected.municipalities) : "n.d."}</dd>
          </div>
          <div>
            <dt>Periodo</dt>
            <dd>{period}</dd>
          </div>
        </dl>
        <Link className="btn btn-block" href={detailsHref}>Vedi il confronto completo</Link>
      </aside>

      <div className={styles.srOnly}>
        <table>
          <caption>Valori regionali esatti dei pagamenti comunali SIOPE</caption>
          <thead><tr><th>Regione</th><th>Totale</th><th>Per abitante coperto</th><th>Comuni</th></tr></thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.region}>
                <th scope="row">{region.region}</th>
                <td>{exactEuro(region.value)}</td>
                <td>{region.perCapita === null ? "Non disponibile" : exactEuro(region.perCapita)}</td>
                <td>{integer(region.municipalities)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
