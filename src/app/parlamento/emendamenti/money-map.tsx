"use client";

import { useId, useState } from "react";

import { ChartDataTable } from "@/components/charts/chart-data-table";
import { ITALY_REGIONS_VIEWBOX, italyRegionGeometry } from "@/data/generated/italy-regions";
import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";
import type { MoneyMapOption } from "@/lib/manovra-emendamenti";

import styles from "./emendamenti.module.css";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const compact = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function euro(cents: number): string {
  const value = cents / 100;
  if (value >= 1_000_000_000) return `${compact.format(value / 1_000_000_000)} mld €`;
  if (value >= 1_000_000) return `${compact.format(value / 1_000_000)} mln €`;
  return `${integer.format(Math.round(value))} €`;
}

// Fixed classes, the same for every party: colours stay comparable when the selection changes.
const CLASSES = [
  { label: "meno di 1 mln €", below: 1_000_000_00 },
  { label: "da 1 a 10 mln €", below: 10_000_000_00 },
  { label: "da 10 a 50 mln €", below: 50_000_000_00 },
  { label: "da 50 a 200 mln €", below: 200_000_000_00 },
  { label: "200 mln € o più", below: Number.POSITIVE_INFINITY },
] as const;

function classOf(cents: number): number {
  return CLASSES.findIndex((item) => cents < item.below) + 1;
}

const regionName = (code: string) => REGION_NAME_BY_ISTAT_CODE[code as keyof typeof REGION_NAME_BY_ISTAT_CODE] ?? code;

export function MoneyMap({ options }: { options: MoneyMapOption[] }) {
  const [selectedKey, setSelectedKey] = useState(options[0]?.key ?? "tutte");
  const selectId = useId();
  const selected = options.find((option) => option.key === selectedKey) ?? options[0]!;
  const byCode = new Map(selected.regions.map((region) => [region.code, region]));
  const top = selected.regions.slice(0, 6);
  const summary =
    selected.amendments === 0
      ? `${selected.label}: nessuna proposta per un solo Comune con un importo per il 2027-2029.`
      : `${selected.label}: ${integer.format(selected.amendments)} proposte per un solo Comune chiedono in tutto ${euro(selected.totalCents)} nel 2027-2029. ` +
        top.map((region) => `${regionName(region.code)} ${euro(region.cents)}`).join(", ") + ".";

  return (
    <figure className={styles.moneyMap} data-money-map={selected.key}>
      <div className={styles.moneyControl}>
        <label htmlFor={selectId}>Partito del primo firmatario</label>
        <select id={selectId} value={selected.key} onChange={(event) => setSelectedKey(event.target.value)}>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label} ({euro(option.totalCents)})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.moneyLayout}>
        <svg className={styles.moneySvg} viewBox={ITALY_REGIONS_VIEWBOX} role="img" aria-label={summary}>
          {italyRegionGeometry.map((region) => {
            const value = byCode.get(region.code);
            return (
              <path
                key={region.code}
                d={region.path}
                data-region={region.code}
                data-class={value ? classOf(value.cents) : 0}
                className={styles.moneyRegion}
              >
                <title>
                  {value
                    ? `${region.name}: ${euro(value.cents)} in ${integer.format(value.amendments)} ${value.amendments === 1 ? "proposta" : "proposte"}`
                    : `${region.name}: nessuna proposta con importo`}
                </title>
              </path>
            );
          })}
        </svg>

        <div className={styles.moneySide}>
          <p className={styles.moneyTotal} aria-live="polite">
            <strong>{euro(selected.totalCents)}</strong>
            <span>
              chiesti da {integer.format(selected.amendments)} {selected.amendments === 1 ? "proposta" : "proposte"} per un solo
              Comune, 2027-2029
            </span>
          </p>
          {top.length > 0 ? (
            <ol className={styles.moneyTop} aria-label={`Regioni con più soldi chiesti, ${selected.label}`}>
              {top.map((region) => (
                <li key={region.code} data-money-region={region.code}>
                  <span>
                    {regionName(region.code)}
                    <span className={styles.cellNote}>
                      {integer.format(region.amendments)} {region.amendments === 1 ? "proposta" : "proposte"}
                      {region.inadmissible > 0 ? `, ${integer.format(region.inadmissible)} inammissibili` : ""}
                    </span>
                  </span>
                  <strong>{euro(region.cents)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.note}>Nessuna proposta di questo gruppo nomina un solo Comune con un importo per il triennio.</p>
          )}
          <ul className={styles.moneyLegend} aria-label="Legenda della mappa">
            <li>
              <span className={styles.moneySwatch} data-class={0} aria-hidden="true" />
              nessuna richiesta
            </li>
            {CLASSES.map((item, index) => (
              <li key={item.label}>
                <span className={styles.moneySwatch} data-class={index + 1} aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ChartDataTable
        label={`Soldi chiesti per regione, ${selected.label}`}
        columns={["Spesa dichiarata 2027-2029", "Proposte", "Di cui inammissibili"]}
        rows={selected.regions.map((region) => ({
          label: regionName(region.code),
          values: [euro(region.cents), integer.format(region.amendments), integer.format(region.inadmissible)],
        }))}
      />
    </figure>
  );
}
