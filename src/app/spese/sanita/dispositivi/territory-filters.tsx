"use client";

import { useState } from "react";
import type { MedicalDeviceFilterOptions } from "@/lib/medical-device-spending";
import styles from "./dispositivi.module.css";

export function TerritoryFilters({ years, regionLabels, names, initial, allYears = false }: {
  years: MedicalDeviceFilterOptions["years"];
  regionLabels: Readonly<Record<string, string>>;
  names: readonly [string, string, string];
  initial: readonly [string, string, string];
  allYears?: boolean;
}) {
  const [year, setYear] = useState(initial[0]);
  const [region, setRegion] = useState(initial[1]);
  const [company, setCompany] = useState(initial[2]);
  const regions = years.find((item) => String(item.year) === year)?.regions ?? [];
  const companies = regions.find((item) => item.code === region)?.companies ?? [];

  return <>
    <label className={styles.field}>Anno
      <select name={names[0]} value={year} onChange={(event) => {
        setYear(event.target.value); setRegion(""); setCompany("");
      }}>
        {allYears ? <option value="">Tutti</option> : null}
        {years.map((item) => <option key={item.year} value={item.year}>{item.year}</option>)}
      </select>
    </label>
    <label className={styles.field}>Regione
      <select name={names[1]} value={region} disabled={!year} onChange={(event) => {
        setRegion(event.target.value); setCompany("");
      }}>
        <option value="">Tutte</option>
        {regions.map((item) => <option key={item.code} value={item.code}>{regionLabels[item.code]}</option>)}
      </select>
    </label>
    <label className={styles.field}>Azienda sanitaria
      <select name={names[2]} value={company} disabled={!region} onChange={(event) => setCompany(event.target.value)}>
        <option value="">Tutte</option>
        {companies.map((item) => <option key={item.code} value={item.code}>{item.names[0] ?? item.code}</option>)}
      </select>
    </label>
  </>;
}
