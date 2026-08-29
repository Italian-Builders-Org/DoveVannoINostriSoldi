"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ITALY_REGIONS_VIEWBOX,
  italyRegionGeometry,
} from "@/data/generated/italy-regions";
import { italyProvinceGeometry } from "@/data/generated/italy-provinces";
import type { SiopeProvincePoint, SiopeRegionPoint } from "@/lib/siope-snapshot";
import {
  REGION_NAME_BY_ISTAT_CODE,
  regionDataByIstatCode,
} from "@/lib/italy-regions";
import { compactEuro, exactEuro, integer } from "@/lib/format";
import styles from "./italy-regions-map.module.css";

const italianRegionCollator = new Intl.Collator("it");
const regionOptions = Object.entries(REGION_NAME_BY_ISTAT_CODE).sort(([, left], [, right]) =>
  italianRegionCollator.compare(left, right),
);

export type MapMetric = "total" | "per-capita";

function quantile(values: number[], fraction: number): number {
  const index = Math.min(values.length - 1, Math.floor(values.length * fraction));
  return values[index] ?? 0;
}

export function ItalyRegionsMap({
  regions,
  period,
  aside,
  compact = false,
  provinces = [],
  metric = "per-capita",
}: {
  regions: SiopeRegionPoint[];
  period: string;
  /** National figures shown beside the map; owned by the page, not the map. */
  aside?: React.ReactNode;
  /** Dense dashboard treatment; interaction and accessible table remain available. */
  compact?: boolean;
  /** Official ISTAT province geometries receive verified SIOPE municipal aggregates. */
  provinces?: SiopeProvincePoint[];
  /** Verified SIOPE measure used for the choropleth and accessible labels. */
  metric?: MapMetric;
}) {
  const [selectedCode, setSelectedCode] = useState("03");
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [automaticSelection, setAutomaticSelection] = useState<"ip" | null>(null);
  const userSelected = useRef(false);
  const regionPathRefs = useRef(new Map<string, SVGPathElement>());
  const showProvinceGeometry = compact && provinces.length > 0;
  const provinceByName = useMemo(
    () => new Map(provinces.map((province) => [province.province, province])),
    [provinces],
  );
  const { byCode, thresholds } = useMemo(() => {
    const mapped = regionDataByIstatCode(regions);
    const values = (showProvinceGeometry ? provinces : regions)
      .map((point) => metric === "total" ? point.value : point.perCapita)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    return {
      byCode: mapped,
      thresholds: [0.2, 0.4, 0.6, 0.8].map((fraction) => quantile(values, fraction)),
    };
  }, [metric, provinces, regions, showProvinceGeometry]);

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
  const navigableCodes: string[] = italyRegionGeometry.map(({ code }) => code);
  const outlinedCodes = [selectedCode, hoveredCode].filter(
    (code, index, codes): code is string => code !== null && codes.indexOf(code) === index,
  );

  function handleRegionKeyDown(event: React.KeyboardEvent<SVGPathElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectRegion(code);
      return;
    }

    const currentIndex = navigableCodes.indexOf(code);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % navigableCodes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + navigableCodes.length) % navigableCodes.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = navigableCodes.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextCode = navigableCodes[nextIndex];
    setFocusedCode(nextCode);
    previewRegion(nextCode);
    regionPathRefs.current.get(nextCode)?.focus();
  }

  function level(value: number | null): number | null {
    if (value === null) return null;
    return thresholds.findIndex((threshold) => value <= threshold) === -1
      ? thresholds.length
      : thresholds.findIndex((threshold) => value <= threshold);
  }

  const metricTitle = metric === "total"
    ? "Pagamenti comunali totali"
    : "Pagamenti comunali per abitante coperto";
  const colorScope = showProvinceGeometry ? "provincia" : "regione";
  const mapTitle = `${metricTitle}, colori per ${colorScope}`;
  const mapDescription = `${showProvinceGeometry
    ? "I colori rappresentano i valori provinciali. Contorni, hover, clic, tastiera e pannello di dettaglio identificano invece le regioni. "
    : "I colori e i contorni rappresentano i valori regionali. "}Mappa colorata in base ai ${
      metric === "total" ? "pagamenti totali" : "pagamenti per abitante coperto"
    } di cassa SIOPE dei Comuni. Usa Tab per entrare nella mappa e i tasti freccia per esplorare le regioni. Passa sopra una regione per un’anteprima; fai clic o premi Invio per fissarla nel pannello accanto.`;
  const compactLegendTitle = `${metric === "total" ? "Pagamenti totali" : "Pagamenti pro capite (€)"} per ${colorScope}`;

  return (
    <div className={`${styles.layout} ${compact ? styles.compact : ""}`}>
      <div className={styles.mapColumn}>
        <svg
          className={styles.map}
          viewBox={ITALY_REGIONS_VIEWBOX}
          role="group"
          data-region-map="true"
          aria-labelledby="regional-map-title regional-map-description"
        >
          <title id="regional-map-title">{mapTitle}</title>
          <desc id="regional-map-description">{mapDescription}</desc>
          {showProvinceGeometry ? italyProvinceGeometry.map((geometry) => {
            const province = provinceByName.get(geometry.name);
            const colorLevel = level(province ? metric === "total" ? province.value : province.perCapita : null);
            return (
              <path
                key={`province-${geometry.code}`}
                d={geometry.path}
                className={`${styles.province} ${
                  colorLevel === null ? styles.noData : styles[`level${colorLevel}`]
                }`}
                aria-hidden="true"
                focusable="false"
                pointerEvents="none"
              />
            );
          }) : null}
          {italyRegionGeometry.map((geometry) => {
            const region = byCode.get(geometry.code);
            const colorLevel = level(region ? metric === "total" ? region.value : region.perCapita : null);
            const selected = selectedCode === geometry.code;
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
                className={`${styles.region} ${showProvinceGeometry ? styles.regionOverlay : ""} ${
                  colorLevel === null ? styles.noData : styles[`level${colorLevel}`]
                }`}
                tabIndex={focusable ? 0 : -1}
                role="button"
                aria-pressed={selected}
                aria-label={`${REGION_NAME_BY_ISTAT_CODE[geometry.code]}: ${
                  !region || (metric === "per-capita" && region.perCapita === null)
                    ? "dato non disponibile"
                    : metric === "total"
                      ? `${exactEuro(region.value)} di pagamenti comunali`
                      : `${exactEuro(region.perCapita!)} per abitante coperto`
                }`}
                data-hovered={hovered ? "true" : undefined}
                data-selected={selected ? "true" : undefined}
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

        <label className={styles.mobileSelector}>
          <span>Scegli una regione</span>
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

        {automaticSelection ? (
          <p className={styles.geoNote}>
            Regione proposta dalla posizione approssimativa dell’IP; l’indirizzo non viene mostrato
            né salvato.
          </p>
        ) : null}

        {compact ? (
          <>
            <div
              className={`${styles.legend} ${styles.compactLegend}`}
              data-map-semantics={showProvinceGeometry ? "province-colors-region-interaction" : "region-colors-region-interaction"}
              aria-label={`Scala dei ${metric === "total" ? "pagamenti totali" : "pagamenti pro capite"} per ${colorScope}; selezione per regione`}
            >
              <strong>{compactLegendTitle}</strong>
              {[4, 3, 2, 1, 0].map((index) => {
                const formatThreshold = (value: number) => metric === "total" ? compactEuro(value) : integer(value);
                const label = index === 4
                  ? `> ${formatThreshold(thresholds[3])}`
                  : index === 0
                    ? `≤ ${formatThreshold(thresholds[0])}`
                    : `da ${formatThreshold(thresholds[index - 1])} a ${formatThreshold(thresholds[index])}`;
                return <span key={index}><i className={styles[`level${index}`]} />{label}</span>;
              })}
              {showProvinceGeometry ? <small className={styles.compactScope}>Selezione per regione</small> : null}
            </div>
            <div className={styles.compactDetail} aria-live="polite">
              <strong>{selected?.region ?? "Regione non disponibile"}</strong>
              <span>{!selected ? "n.d." : metric === "total" ? compactEuro(selected.value) : selected.perCapita === null ? "n.d." : exactEuro(selected.perCapita)}</span>
              <small>{period}</small>
            </div>
          </>
        ) : (
          <div className={styles.legend} aria-label={`Scala dei ${metric === "total" ? "pagamenti totali" : "pagamenti pro capite"}`}>
            <span className={styles.legendEnd}>{metric === "total" ? "Meno pagamenti" : "Meno spesa per abitante"}</span>
            {[0, 1, 2, 3, 4].map((index) => (
              <i key={index} className={styles[`level${index}`]} />
            ))}
            <span className={styles.legendEnd}>{metric === "total" ? "Più pagamenti" : "Più spesa per abitante"}</span>
          </div>
        )}
      </div>

      {aside ? <div className={styles.asideColumn}>{aside}</div> : null}

      <div className={styles.detail} data-region-detail="true" aria-live="polite">
        <b>{selected?.region ?? "Dato non disponibile"}</b>
        <span>
          <small>Totale</small>
          {selected ? compactEuro(selected.value) : "n.d."}
        </span>
        <span>
          <small>Per abitante</small>
          {selected?.perCapita === null || !selected ? "n.d." : exactEuro(selected.perCapita)}
        </span>
        <span>
          <small>Abitanti</small>
          {selected?.population == null ? "n.d." : integer(selected.population)}
        </span>
        <span>
          <small>Comuni</small>
          {selected ? integer(selected.municipalities) : "n.d."}
        </span>
        <span>
          <small>Periodo</small>
          {period}
        </span>
      </div>

      <div className={styles.srOnly}>
        <table>
          <caption>Valori regionali esatti dei pagamenti comunali SIOPE</caption>
          <thead><tr><th>Regione</th><th>Totale</th><th>Per abitante coperto</th><th>Comuni</th></tr></thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.region}>
                <th>{region.region}</th>
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
