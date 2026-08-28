"use client";

import { usePathname, useRouter } from "next/navigation";
import type { CompanyAtlasFilters as AtlasFilters } from "@/lib/company-atlas";
import styles from "./company-atlas-filters.module.css";

type SelectOption = Readonly<{ id: string; label: string }>;

function sectorChoiceLabel(id: string, label: string) {
  if (id.toLowerCase() === "all") return label;
  if (id.localeCompare(label, "it", { sensitivity: "accent" }) === 0) return label;
  return `${id} · ${label}`;
}

type CompanyAtlasFiltersProps = Readonly<{
  filters: Required<Pick<AtlasFilters, "metric" | "period" | "region" | "sector" | "band">>;
  metrics: SelectOption[];
  periods: SelectOption[];
  regions: SelectOption[];
  sectors: SelectOption[];
  bands: SelectOption[];
  showBand: boolean;
  sectorLabel?: string;
}>;

export function CompanyAtlasFilters({
  filters,
  metrics,
  periods,
  regions,
  sectors,
  bands,
  showBand,
  sectorLabel = "Settore ATECO 2025",
}: CompanyAtlasFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);

    if (key === "metric") {
      params.delete("period");
      params.delete("band");
      // ATECO 2025 sections and ISTAT macro-sectors are different domains.
      if (value === "turnover" || filters.metric === "turnover") params.delete("sector");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <section className={styles.filters} aria-labelledby="atlas-filters-title">
      <div className={styles.filterIntro}>
        <span className={styles.eyebrow}>Esplora il perimetro</span>
        <h2 id="atlas-filters-title">Cambia metrica e territorio</h2>
        <p>Ogni scelta aggiorna mappa, classifica e dettaglio usando la stessa fonte.</p>
      </div>
      <div className={styles.controlGrid}>
        <label>
          <span>Metrica</span>
          <select
            value={filters.metric}
            onChange={(event) => updateFilter("metric", event.target.value)}
            data-atlas-filter="metric"
          >
            {metrics.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Periodo</span>
          <select
            value={filters.period}
            onChange={(event) => updateFilter("period", event.target.value)}
            data-atlas-filter="period"
          >
            {periods.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Regione</span>
          <select
            value={filters.region}
            onChange={(event) => updateFilter("region", event.target.value)}
            data-atlas-filter="region"
          >
            <option value="all">Tutta Italia</option>
            {regions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>{sectorLabel}</span>
          <select
            value={filters.sector}
            onChange={(event) => updateFilter("sector", event.target.value)}
            data-atlas-filter="sector"
          >
            <option value="all">Tutti i settori</option>
            {sectors.filter((option) => option.id.toLowerCase() !== "all").map((option) => (
              <option key={option.id} value={option.id}>
                {sectorChoiceLabel(option.id, option.label)}
              </option>
            ))}
          </select>
        </label>
        {showBand ? (
          <label>
            <span>Fascia valore produzione</span>
            <select
              value={filters.band}
              onChange={(event) => updateFilter("band", event.target.value)}
              data-atlas-filter="band"
            >
              <option value="all">Tutte le fasce</option>
              {bands.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    </section>
  );
}
