import rawSnapshot from "@/data/generated/cpt-regional-fiscal.json";
import {
  validateCptRegionalFiscalSnapshot,
  type CptRegionalFiscalSnapshot,
} from "@/lib/data/cpt-regional-fiscal-contract";
import { eurosPerSquareKilometreCents, getRegionGeography } from "@/lib/municipality-geography";

export const cptRegionalFiscalSnapshot = validateCptRegionalFiscalSnapshot(
  rawSnapshot as CptRegionalFiscalSnapshot,
);

export const availableCptFiscalYears = cptRegionalFiscalSnapshot.referenceYears;

function normalizedRegion(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[‘’`´]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ");
}

export type CptRegionalFiscalQuery = {
  year?: number;
  region?: string;
};

export function queryCptRegionalFiscal(query: CptRegionalFiscalQuery = {}) {
  const year = query.year ?? cptRegionalFiscalSnapshot.defaultYear;
  if (!availableCptFiscalYears.includes(year)) {
    throw new Error(`Anno CPT non disponibile. Anni validi: ${availableCptFiscalYears.join(", ")}.`);
  }
  const requestedRegion = query.region ? normalizedRegion(query.region) : null;
  const rows = cptRegionalFiscalSnapshot.rows.filter(
    (row) =>
      row.year === year &&
      (!requestedRegion ||
        normalizedRegion(row.region) === requestedRegion ||
        row.regionCode === query.region?.trim()),
  ).map((row) => {
    const geography = getRegionGeography(year, row.regionCode);
    const surface = geography?.surfaceSquareMetres ?? null;
    return {
      ...row,
      geography,
      revenuePerSquareKmCents: eurosPerSquareKilometreCents(row.revenueCents, surface),
      expenditurePerSquareKmCents: eurosPerSquareKilometreCents(row.expenditureCents, surface),
      balancePerSquareKmCents: eurosPerSquareKilometreCents(row.balanceCents, surface),
    };
  });
  if (requestedRegion && rows.length === 0) {
    throw new Error(`Territorio CPT non disponibile: ${query.region?.trim()}.`);
  }
  return {
    year,
    unit: cptRegionalFiscalSnapshot.unit,
    rows,
    definitions: cptRegionalFiscalSnapshot.definitions,
    methodology: cptRegionalFiscalSnapshot.methodology,
    provenance: cptRegionalFiscalSnapshot.provenance,
  };
}
