import { partialMonthOf } from "@/lib/siope-calendar";
import snapshot2024 from "@/data/generated/siope-municipal-2024.json";
import snapshot2025 from "@/data/generated/siope-municipal-2025.json";
import snapshot2026 from "@/data/generated/siope-municipal.json";

export type SiopeMunicipalMonthlyPoint = {
  month: number;
  label: string;
  flow: number;
  cumulative: number;
};

export type SiopeRegionPoint = {
  region: string;
  value: number;
  perCapitaValue: number;
  population: number | null;
  perCapita: number | null;
  municipalities: number;
  municipalitiesWithPopulation: number;
};

export type SiopeSpendingTitle = {
  code: string;
  label: string;
  value: number;
};

export type SiopeMunicipalityPoint = {
  name: string;
  province: string;
  region: string;
  codiceFiscale: string;
  population: number | null;
  value: number;
  perCapita: number | null;
};

export type SiopeMunicipalSnapshot = {
  schemaVersion: 3;
  generatedAt: string;
  scope: "municipalities";
  year: number;
  latestMonth: number;
  latestMonthLabel: string;
  totalPaid: number;
  paymentsWithPopulation: number;
  populationCovered: number;
  nationalPerCapita: number | null;
  coverage: {
    activeSiopeMunicipalities: number;
    matchedToIpaRegion: number;
    withMovements: number;
    unmatchedToIpaRegion: number;
    movementRows: number;
    includedMovementRows: number;
    malformedRows: number;
    withPopulation: number;
    withoutPopulation: number;
  };
  monthly: SiopeMunicipalMonthlyPoint[];
  regions: SiopeRegionPoint[];
  titles: SiopeSpendingTitle[];
  topMunicipalities: SiopeMunicipalityPoint[];
  topMunicipalitiesByValue: SiopeMunicipalityPoint[];
  topMunicipalitiesByPerCapita: SiopeMunicipalityPoint[];
  source: {
    siopeOwner: string;
    siopeMovementsUrl: string;
    siopeRegistryUrl: string;
    ipaUrl: string;
    siopeMovementsLastModified: string | null;
    siopeRegistryLastModified: string | null;
    ipaLastModified: string | null;
    observedAt: string;
  };
  methodology: {
    measure: string;
    periodicity: string;
    territorialJoin: string;
    populationSource: string;
    populationReference: string;
    populationSourceLastModified: string | null;
    perCapitaCoverage: string;
    warning: string;
  };
};

/**
 * The generated file is validated by the SIOPE ETL workflow before it can be
 * committed. Keeping it as a versioned build input makes web requests cheap,
 * deterministic and independent from a 50+ MB upstream download.
 */
const snapshots = {
  2024: snapshot2024,
  2025: snapshot2025,
  2026: snapshot2026,
} as const;

export const availableSiopeYears = Object.keys(snapshots)
  .map(Number)
  .sort((left, right) => right - left);

export function getSiopeMunicipalSnapshot(year?: number): SiopeMunicipalSnapshot {
  if (year && year in snapshots) {
    return snapshots[year as keyof typeof snapshots] as SiopeMunicipalSnapshot;
  }
  return snapshot2026 as SiopeMunicipalSnapshot;
}

export const siopeMunicipalSnapshot = getSiopeMunicipalSnapshot();

/** The month that is still filling up, if there is one. See siope-calendar. */
export function partialMonth(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): number | null {
  return partialMonthOf(data.year, data.latestMonth, data.source.observedAt);
}

/** The months whose totals the source considers settled. */
export function completedMonths(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): SiopeMunicipalMonthlyPoint[] {
  const partial = partialMonth(data);
  return data.monthly.filter((point) => point.month !== partial);
}

export function regionsByPerCapita(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): SiopeRegionPoint[] {
  return [...data.regions]
    .sort((left, right) => {
      if (left.perCapita === null && right.perCapita === null) {
        return left.region.localeCompare(right.region, "it-IT");
      }
      if (left.perCapita === null) return 1;
      if (right.perCapita === null) return -1;
      return right.perCapita - left.perCapita || left.region.localeCompare(right.region, "it-IT");
    });
}

export function municipalitiesByPerCapita(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): SiopeMunicipalityPoint[] {
  return data.topMunicipalitiesByPerCapita;
}
