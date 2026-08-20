"use client";

import { useMemo, useState } from "react";
import {
  ITALY_REGIONS_VIEWBOX,
  italyRegionGeometry,
} from "@/data/generated/italy-regions";
import type { SiopeRegionPoint } from "@/lib/siope-snapshot";
import {
  REGION_NAME_BY_ISTAT_CODE,
  regionDataByIstatCode,
} from "@/lib/italy-regions";
import styles from "./italy-regions-map.module.css";

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function compactEuro(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} mld €`;
  }
  return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} mln €`;
}

function quantile(values: number[], fraction: number): number {
  const index = Math.min(values.length - 1, Math.floor(values.length * fraction));
  return values[index] ?? 0;
}

export function ItalyRegionsMap({
  regions,
  period,
}: {
  regions: SiopeRegionPoint[];
  period: string;
}) {
  const [selectedCode, setSelectedCode] = useState("03");
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

  const selected = byCode.get(selectedCode) ?? regions[0];

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
            Coropleta regionale dei pagamenti di cassa SIOPE dei Comuni. Usa Tab per
            selezionare una regione e leggere il valore esatto nel pannello accanto.
          </desc>
          {italyRegionGeometry.map((geometry) => {
            const region = byCode.get(geometry.code);
            const colorLevel = level(region?.perCapita ?? null);
            const active = selectedCode === geometry.code;
            return (
              <path
                key={geometry.code}
                d={geometry.path}
                className={`${styles.region} ${
                  colorLevel === null ? styles.noData : styles[`level${colorLevel}`]
                } ${active ? styles.active : ""}`}
                tabIndex={0}
                role="button"
                aria-pressed={active}
                aria-label={`${REGION_NAME_BY_ISTAT_CODE[geometry.code]}: ${
                  region?.perCapita === null || region?.perCapita === undefined
                    ? "dato non disponibile"
                    : `${euro.format(region.perCapita)} per abitante coperto`
                }`}
                onPointerEnter={() => setSelectedCode(geometry.code)}
                onFocus={() => setSelectedCode(geometry.code)}
                onClick={() => setSelectedCode(geometry.code)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedCode(geometry.code);
                  }
                }}
              />
            );
          })}
        </svg>

        <label className={styles.mobileSelector}>
          <span>Scegli una regione</span>
          <select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}>
            {Object.entries(REGION_NAME_BY_ISTAT_CODE).map(([code, name]) => (
              <option value={code} key={code}>{name}</option>
            ))}
          </select>
        </label>

        <div className={styles.legend} aria-label="Scala dei pagamenti pro capite">
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index}>
              <i className={styles[`level${index}`]} />
              {index === 0
                ? `fino a ${integer.format(thresholds[0])} €`
                : index === 4
                  ? `oltre ${integer.format(thresholds[3])} €`
                  : `da ${integer.format(thresholds[index - 1])} a ${integer.format(thresholds[index])} €`}
            </span>
          ))}
        </div>
      </div>

      <aside className={styles.detail} aria-live="polite">
        <span>Regione selezionata</span>
        <h3>{selected?.region ?? "Dato non disponibile"}</h3>
        <strong>{selected?.perCapita === null || !selected ? "Non disponibile" : euro.format(selected.perCapita)}</strong>
        <small>per abitante della popolazione coperta</small>
        <dl>
          <div><dt>Totale pagato</dt><dd>{selected ? compactEuro(selected.value) : "Non disponibile"}</dd></div>
          <div><dt>Comuni inclusi</dt><dd>{selected ? integer.format(selected.municipalities) : "Non disponibile"}</dd></div>
          <div><dt>Periodo</dt><dd>{period}</dd></div>
        </dl>
        <p>
          Pagamenti dei Comuni con sede nella regione; non tutta la spesa effettuata
          fisicamente nel territorio.
        </p>
      </aside>

      <div className={styles.srOnly}>
        <table>
          <caption>Valori regionali esatti dei pagamenti comunali SIOPE</caption>
          <thead><tr><th>Regione</th><th>Totale</th><th>Per abitante coperto</th><th>Comuni</th></tr></thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.region}>
                <th>{region.region}</th>
                <td>{euro.format(region.value)}</td>
                <td>{region.perCapita === null ? "Non disponibile" : euro.format(region.perCapita)}</td>
                <td>{integer.format(region.municipalities)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
