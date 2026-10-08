"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ITALY_REGIONS_VIEWBOX,
  italyRegionGeometry,
} from "@/data/generated/italy-regions";
import {
  formatPaycheckEuro,
  type PaycheckMissionShare,
  type PaycheckMonthCount,
  type PaycheckRegionRates,
} from "@/lib/paycheck-counter";
import {
  comparePaycheckNetsByRegion,
  paycheckNetColorLevels,
  paycheckNetLevel,
} from "@/lib/paycheck-region-comparison";
import styles from "./paycheck-regions-map.module.css";

type PaycheckRegionsMapProps = {
  annualGrossEur: number;
  payMonths: PaycheckMonthCount;
  regions: readonly PaycheckRegionRates[];
  missions: readonly PaycheckMissionShare[];
  selectedRegionCode: string;
  onSelectRegion: (code: string) => void;
  taxYear: number;
};

function shortRegionName(name: string): string {
  if (name.startsWith("Trentino")) return "Trentino-Alto Adige";
  if (name.startsWith("Friuli")) return "Friuli-Venezia Giulia";
  if (name.startsWith("Valle")) return "Valle d'Aosta";
  return name;
}

export function PaycheckRegionsMap({
  annualGrossEur,
  payMonths,
  regions,
  missions,
  selectedRegionCode,
  onSelectRegion,
  taxYear,
}: PaycheckRegionsMapProps) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const pathRefs = useRef(new Map<string, SVGPathElement>());

  const comparison = useMemo(
    () =>
      comparePaycheckNetsByRegion({
        annualGrossEur,
        payMonths,
        regions,
        missions,
      }),
    [annualGrossEur, payMonths, regions, missions],
  );

  const byCode = useMemo(
    () => new Map(comparison.rows.map((row) => [row.code, row])),
    [comparison.rows],
  );

  const thresholds = useMemo(
    () => paycheckNetColorLevels(comparison.rows.map((row) => row.monthlyNetCents)),
    [comparison.rows],
  );

  const displayedCode = hoveredCode ?? selectedRegionCode;
  const selected = byCode.get(displayedCode) ?? byCode.get(selectedRegionCode);
  const navigableCodes: string[] = italyRegionGeometry.map((geometry) => geometry.code);
  const outlinedCodes = [selectedRegionCode, hoveredCode].filter(
    (code, index, codes): code is string => code !== null && codes.indexOf(code) === index,
  );

  function handleKeyDown(event: KeyboardEvent<SVGPathElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectRegion(code);
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
    if (nextIndex == null) return;
    event.preventDefault();
    const nextCode = navigableCodes[nextIndex];
    setFocusedCode(nextCode);
    setHoveredCode(nextCode);
    pathRefs.current.get(nextCode)?.focus();
  }

  const spreadCents = comparison.maxNetCents - comparison.minNetCents;

  return (
    <section
      className={styles.root}
      aria-labelledby="busta-mappa-title"
      data-testid="paycheck-regions-map"
    >
      <h2 id="busta-mappa-title" className="panel-title">
        Netto per Regione
      </h2>
      <p className={styles.intro}>
        Stessa RAL ({formatPaycheckEuro(Math.round(annualGrossEur * 100))}) e{" "}
        {payMonths} mensilità in tutte le Regioni: IRPEF e contributi restano uguali; cambia il
        mix di addizionale regionale (scaglioni MEF {taxYear}) e comunale (media regionale MEF).
        Clicca una Regione per aggiornare il contatore.
      </p>

      <div className={styles.layout}>
        <div className={styles.mapColumn}>
          <svg
            className={styles.map}
            viewBox={ITALY_REGIONS_VIEWBOX}
            preserveAspectRatio="xMinYMin meet"
            role="group"
            aria-labelledby="paycheck-map-title paycheck-map-desc"
          >
            <title id="paycheck-map-title">Netto mensile stimato per Regione</title>
            <desc id="paycheck-map-desc">
              Mappa colorata dal netto più basso al più alto. Usa Tab e le frecce per esplorare;
              Invio o clic selezionano la Regione nel contatore.
            </desc>
            {italyRegionGeometry.map((geometry) => {
              const row = byCode.get(geometry.code);
              const level = row ? paycheckNetLevel(row.monthlyNetCents, thresholds) : 0;
              const selected = selectedRegionCode === geometry.code;
              const focusable = (focusedCode ?? selectedRegionCode) === geometry.code;
              const hovered = hoveredCode === geometry.code;
              return (
                <path
                  key={geometry.code}
                  ref={(node) => {
                    if (node) pathRefs.current.set(geometry.code, node);
                    else pathRefs.current.delete(geometry.code);
                  }}
                  d={geometry.path}
                  className={`${styles.region} ${styles[`level${level}`]}`}
                  tabIndex={focusable ? 0 : -1}
                  role="button"
                  aria-pressed={selected}
                  aria-label={`${shortRegionName(geometry.name)}: ${
                    row ? formatPaycheckEuro(row.monthlyNetCents) : "n/d"
                  } netti`}
                  data-hovered={hovered ? "true" : undefined}
                  data-selected={selected ? "true" : undefined}
                  onPointerEnter={() => setHoveredCode(geometry.code)}
                  onPointerLeave={() =>
                    setHoveredCode((current) => (current === geometry.code ? null : current))
                  }
                  onFocus={() => {
                    setFocusedCode(geometry.code);
                    setHoveredCode(geometry.code);
                  }}
                  onBlur={() =>
                    setHoveredCode((current) => (current === geometry.code ? null : current))
                  }
                  onClick={() => onSelectRegion(geometry.code)}
                  onKeyDown={(event) => handleKeyDown(event, geometry.code)}
                />
              );
            })}
            {outlinedCodes.map((code) => {
              const geometry = italyRegionGeometry.find((item) => item.code === code);
              if (!geometry) return null;
              return (
                <path
                  key={`outline-${code}`}
                  d={geometry.path}
                  className={`${styles.outline} ${
                    code === selectedRegionCode ? styles.selectedOutline : ""
                  } ${code === hoveredCode ? styles.hoverOutline : ""}`}
                  aria-hidden="true"
                  focusable="false"
                />
              );
            })}
          </svg>

          <div className={styles.legend} aria-label="Scala del netto mensile">
            <span className={styles.legendEnd}>Netto più basso</span>
            {[0, 1, 2, 3, 4].map((index) => (
              <i key={index} className={styles[`level${index}`]} />
            ))}
            <span className={styles.legendEnd}>Netto più alto</span>
          </div>
        </div>

        <div className={styles.side}>
          {selected ? (
            <div className={styles.detail} data-testid="paycheck-map-detail" aria-live="polite">
              <p className={styles.detailName}>{shortRegionName(selected.name)}</p>
              <p className={styles.detailNet}>{formatPaycheckEuro(selected.monthlyNetCents)}</p>
              <p className={styles.detailMeta}>
                netto / cedolino · spread nazionale {formatPaycheckEuro(spreadCents)}
              </p>
              <dl className={styles.detailGrid}>
                <div>
                  <dt>Add. regionale</dt>
                  <dd>{formatPaycheckEuro(selected.monthlyRegionalCents)}</dd>
                </div>
                <div>
                  <dt>Add. comunale</dt>
                  <dd>{formatPaycheckEuro(selected.monthlyMunicipalCents)}</dd>
                </div>
                <div>
                  <dt>IRPEF</dt>
                  <dd>{formatPaycheckEuro(selected.monthlyIrpefCents)}</dd>
                </div>
                <div>
                  <dt>Contributi</dt>
                  <dd>{formatPaycheckEuro(selected.monthlySscCents)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <ol className={styles.rankList} data-testid="paycheck-map-ranking">
            {comparison.rows.map((row, index) => (
              <li key={row.code} data-selected={row.code === selectedRegionCode ? "true" : undefined}>
                <button type="button" onClick={() => onSelectRegion(row.code)}>
                  <span className={styles.rankIndex}>{index + 1}</span>
                  <span className={styles.rankName}>{shortRegionName(row.name)}</span>
                  <span className={styles.rankNet}>{formatPaycheckEuro(row.monthlyNetCents)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className={styles.srOnly}>
        <table>
          <caption>Netto mensile stimato per Regione</caption>
          <thead>
            <tr>
              <th scope="col">Regione</th>
              <th scope="col">Netto</th>
              <th scope="col">Addizionale regionale</th>
              <th scope="col">Addizionale comunale</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.code}>
                <th scope="row">{row.name}</th>
                <td>{formatPaycheckEuro(row.monthlyNetCents)}</td>
                <td>{formatPaycheckEuro(row.monthlyRegionalCents)}</td>
                <td>{formatPaycheckEuro(row.monthlyMunicipalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
