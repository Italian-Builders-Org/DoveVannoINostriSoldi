"use client";

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

function quantile(values: number[], fraction: number): number {
  const index = Math.min(values.length - 1, Math.floor(values.length * fraction));
  return values[index] ?? 0;
}

export function ItalyRegionsMap({
  regions,
  period,
  aside,
}: {
  regions: SiopeRegionPoint[];
  period: string;
  /** National figures shown beside the map; owned by the page, not the map. */
  aside?: React.ReactNode;
}) {
  const [selectedCode, setSelectedCode] = useState("03");
  const [automaticSelection, setAutomaticSelection] = useState<"ip" | null>(null);
  const userSelected = useRef(false);
  const regionPathRefs = useRef(new Map<string, SVGPathElement>());
  const { byCode, thresholds } = useMemo(() => {
    const mapped = regionDataByIstatCode(regions);
    const values = regions
      .map((region) => region.perCapita)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    return {
      byCode: mapped,
      thresholds: [0.2, 0.4, 0.6, 0.8].map((fraction) => quantile(values, fraction)),
    };
  }, [regions]);

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
    setAutomaticSelection(null);
    setSelectedCode(code);
  }

  const selected = byCode.get(selectedCode);
  const navigableCodes: string[] = italyRegionGeometry.map(({ code }) => code);

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
    selectRegion(nextCode);
    regionPathRefs.current.get(nextCode)?.focus();
  }

  function level(value: number | null): number | null {
    if (value === null) return null;
    return thresholds.findIndex((threshold) => value <= threshold) === -1
      ? thresholds.length
      : thresholds.findIndex((threshold) => value <= threshold);
  }

  return (
    <div className={styles.layout}>
      <div className={styles.mapColumn}>
        <svg
          className={styles.map}
          viewBox={ITALY_REGIONS_VIEWBOX}
          role="group"
          aria-labelledby="regional-map-title regional-map-description"
        >
          <title id="regional-map-title">Pagamenti comunali per abitante coperto, per regione</title>
          <desc id="regional-map-description">
            Mappa regionale colorata in base ai pagamenti di cassa SIOPE dei Comuni. Usa Tab per
            entrare nella mappa e i tasti freccia per cambiare regione; il valore esatto appare nel
            pannello accanto.
          </desc>
          {italyRegionGeometry.map((geometry) => {
            const region = byCode.get(geometry.code);
            const colorLevel = level(region?.perCapita ?? null);
            const active = selectedCode === geometry.code;
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
                } ${active ? styles.active : ""}`}
                tabIndex={active ? 0 : -1}
                role="button"
                aria-pressed={active}
                aria-label={`${REGION_NAME_BY_ISTAT_CODE[geometry.code]}: ${
                  region?.perCapita === null || region?.perCapita === undefined
                    ? "dato non disponibile"
                    : `${exactEuro(region.perCapita)} per abitante coperto`
                }`}
                onPointerEnter={() => selectRegion(geometry.code)}
                onFocus={() => selectRegion(geometry.code)}
                onClick={() => selectRegion(geometry.code)}
                onKeyDown={(event) => handleRegionKeyDown(event, geometry.code)}
              />
            );
          })}
        </svg>

        <label className={styles.mobileSelector}>
          <span>Scegli una regione</span>
          <select value={selectedCode} onChange={(event) => selectRegion(event.target.value)}>
            {Object.entries(REGION_NAME_BY_ISTAT_CODE).map(([code, name]) => (
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

        <div className={styles.legend} aria-label="Scala dei pagamenti pro capite">
          <span className={styles.legendEnd}>Meno spesa per abitante</span>
          {[0, 1, 2, 3, 4].map((index) => (
            <i
              key={index}
              className={styles[`level${index}`]}
              title={
                index === 0
                  ? `fino a ${integer(thresholds[0])} €`
                  : index === 4
                    ? `oltre ${integer(thresholds[3])} €`
                    : `da ${integer(thresholds[index - 1])} a ${integer(thresholds[index])} €`
              }
            />
          ))}
          <span className={styles.legendEnd}>Più spesa per abitante</span>
        </div>
      </div>

      {aside ? <div className={styles.asideColumn}>{aside}</div> : null}

      <div className={styles.detail} aria-live="polite">
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
