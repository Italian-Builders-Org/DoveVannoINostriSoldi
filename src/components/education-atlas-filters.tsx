"use client";

import { useTransition } from "react";
import { ActiveFilters } from "./active-filters";
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
  const [pending, startTransition] = useTransition();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function resetFilters() {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["region", "schoolType", "pathway"]) params.delete(key);
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return (
    <section aria-busy={pending} className={styles.filters} aria-label="Filtra i dati della scuola">
      <div className={styles.controlGrid}>
        <fieldset className={styles.periodFieldset}>
          <legend>Anno scolastico</legend>
          <div className={styles.periodOptions}>
            {periods.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={pending}
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
            disabled={pending}
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
            disabled={pending}
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
            disabled={pending}
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
      <ActiveFilters pending={pending} onRemove={(key) => updateFilter(key, "all")} onReset={resetFilters}
        filters={[
          { key: "region", value: filters.region, options: regions },
          { key: "schoolType", value: filters.schoolType, options: schoolTypes },
          { key: "pathway", value: filters.pathway, options: pathways }
        ].filter((item) => item.value !== "all").map((item) => ({
          key: item.key, label: item.options.find((option) => option.id === item.value)?.label ?? item.value,
        }))} />
    </section>
  );
}
