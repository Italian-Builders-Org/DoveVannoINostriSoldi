"use client";

import { usePathname, useRouter } from "next/navigation";
import type {
  EducationSchoolType,
} from "@/lib/education-atlas-contract";
import styles from "./education-atlas-filters.module.css";

type Option = Readonly<{ id: string; label: string }>;

type EducationAtlasFiltersProps = Readonly<{
  filters: Readonly<{
    period: string;
    region: string;
    schoolType: EducationSchoolType | "all";
    pathway: string;
  }>;
  periods: Option[];
  regions: Option[];
  schoolTypes: Option[];
  pathways: Option[];
}>;

export function EducationAtlasFilters({
  filters,
  periods,
  regions,
  schoolTypes,
  pathways,
}: EducationAtlasFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <section className={styles.filters} aria-labelledby="education-filters-title">
      <div className={styles.filterIntro}>
        <span className={styles.eyebrow}>Esplora il perimetro</span>
        <h2 id="education-filters-title">Cambia anno, territorio e percorso</h2>
        <p>Ogni scelta aggiorna mappa, distribuzione, trend e indirizzi osservati.</p>
      </div>
      <div className={styles.controlGrid}>
        <fieldset className={styles.periodFieldset}>
          <legend>Anno scolastico</legend>
          <div className={styles.periodOptions}>
            {periods.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filters.period === option.id}
                data-atlas-filter="period"
                data-education-filter="period"
                data-value={option.id}
                onClick={() => updateFilter("period", option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span>Tipo di scuola</span>
          <select
            value={filters.schoolType}
            onChange={(event) => updateFilter("schoolType", event.target.value)}
            data-atlas-filter="schoolType"
            data-education-filter="schoolType"
          >
            <option value="all">Statali e paritarie</option>
            {schoolTypes.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Regione</span>
          <select
            value={filters.region}
            onChange={(event) => updateFilter("region", event.target.value)}
            data-atlas-filter="region"
            data-education-filter="region"
          >
            <option value="all">Tutte le Regioni</option>
            {regions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Percorso</span>
          <select
            value={filters.pathway}
            onChange={(event) => updateFilter("pathway", event.target.value)}
            data-atlas-filter="pathway"
            data-education-filter="pathway"
          >
            <option value="all">Tutti i percorsi</option>
            {pathways.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}
