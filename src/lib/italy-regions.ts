import type { SiopeRegionPoint } from "@/lib/siope-snapshot";

export const REGION_NAME_BY_ISTAT_CODE = {
  "01": "Piemonte",
  "02": "Valle d'Aosta/Vallée d'Aoste",
  "03": "Lombardia",
  "04": "Trentino-Alto Adige/Südtirol",
  "05": "Veneto",
  "06": "Friuli-Venezia Giulia",
  "07": "Liguria",
  "08": "Emilia-Romagna",
  "09": "Toscana",
  "10": "Umbria",
  "11": "Marche",
  "12": "Lazio",
  "13": "Abruzzo",
  "14": "Molise",
  "15": "Campania",
  "16": "Puglia",
  "17": "Basilicata",
  "18": "Calabria",
  "19": "Sicilia",
  "20": "Sardegna",
} as const;

export function regionDataByIstatCode(regions: SiopeRegionPoint[]) {
  const byName = new Map(regions.map((region) => [region.region, region]));
  return new Map(
    Object.entries(REGION_NAME_BY_ISTAT_CODE).map(([code, name]) => [code, byName.get(name)]),
  );
}

/** Reverse of REGION_NAME_BY_ISTAT_CODE, for linking from a region name back to its ISTAT code. */
export const ISTAT_CODE_BY_REGION_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_NAME_BY_ISTAT_CODE).map(([code, name]) => [name, code]),
);

export function istatCodeOfRegion(regionName: string): string | null {
  return ISTAT_CODE_BY_REGION_NAME[regionName] ?? null;
}

/**
 * CPT publishes Trento and Bolzano separately, so the single SIOPE row for
 * Trentino-Alto Adige cannot point to one unambiguous CPT territory.
 */
export function cptRegionAnchorOf(regionName: string): string | null {
  const code = istatCodeOfRegion(regionName);
  return code && code !== "04" ? `regione-${code}` : null;
}

export const ITALY_MACRO_AREAS = ["Nord", "Centro", "Sud e Isole"] as const;

export type ItalyMacroArea = (typeof ITALY_MACRO_AREAS)[number];

/**
 * ISTAT ripartizione geografica per region code; Nord merges nord-ovest and
 * nord-est. Keyed on the same ISTAT codes as REGION_NAME_BY_ISTAT_CODE so the
 * two maps cannot drift apart on region naming.
 */
const MACRO_AREA_BY_ISTAT_CODE: Record<keyof typeof REGION_NAME_BY_ISTAT_CODE, ItalyMacroArea> = {
  "01": "Nord",
  "02": "Nord",
  "03": "Nord",
  "04": "Nord",
  "05": "Nord",
  "06": "Nord",
  "07": "Nord",
  "08": "Nord",
  "09": "Centro",
  "10": "Centro",
  "11": "Centro",
  "12": "Centro",
  "13": "Sud e Isole",
  "14": "Sud e Isole",
  "15": "Sud e Isole",
  "16": "Sud e Isole",
  "17": "Sud e Isole",
  "18": "Sud e Isole",
  "19": "Sud e Isole",
  "20": "Sud e Isole",
};

const MACRO_AREA_BY_REGION_NAME: Record<string, ItalyMacroArea> = Object.fromEntries(
  Object.entries(REGION_NAME_BY_ISTAT_CODE).map(([code, name]) => [
    name,
    MACRO_AREA_BY_ISTAT_CODE[code as keyof typeof REGION_NAME_BY_ISTAT_CODE],
  ]),
);

/** ISTAT ripartizione geografica for a region name; Nord merges nord-ovest and nord-est. */
export function macroAreaOf(regionName: string): ItalyMacroArea | null {
  return MACRO_AREA_BY_REGION_NAME[regionName] ?? null;
}

export type ItalyMacroAreaSummary = {
  area: ItalyMacroArea;
  value: number;
  perCapitaValue: number;
  population: number | null;
  perCapita: number | null;
  municipalities: number;
  municipalitiesWithPopulation: number;
};

/** Sums the granular per-region figures into one totale for the area. */
function summarizeRegionGroup(
  area: ItalyMacroArea,
  regions: SiopeRegionPoint[],
): ItalyMacroAreaSummary {
  const value = regions.reduce((total, region) => total + region.value, 0);
  const perCapitaValue = regions.reduce(
    (total, region) => total + region.perCapitaValue,
    0,
  );
  const coveredPopulation = regions.reduce(
    (total, region) => total + (region.population ?? 0),
    0,
  );
  const population = coveredPopulation > 0 ? coveredPopulation : null;
  const municipalities = regions.reduce((total, region) => total + region.municipalities, 0);
  const municipalitiesWithPopulation = regions.reduce(
    (total, region) => total + region.municipalitiesWithPopulation,
    0,
  );
  return {
    area,
    value,
    perCapitaValue,
    population,
    perCapita: population ? perCapitaValue / population : null,
    municipalities,
    municipalitiesWithPopulation,
  };
}

export function groupRegionsByMacroArea<T extends SiopeRegionPoint>(
  regions: T[],
): Array<{ area: ItalyMacroArea; regions: T[]; summary: ItalyMacroAreaSummary }> {
  const byArea = new Map<ItalyMacroArea, T[]>(ITALY_MACRO_AREAS.map((area) => [area, []]));
  const seen = new Set<string>();
  for (const region of regions) {
    const area = macroAreaOf(region.region);
    if (!area) throw new Error(`Regione non associata a una macro-area: ${region.region}`);
    if (seen.has(region.region)) throw new Error(`Regione duplicata: ${region.region}`);
    seen.add(region.region);
    byArea.get(area)!.push(region);
  }
  const missing = Object.values(REGION_NAME_BY_ISTAT_CODE).filter((region) => !seen.has(region));
  if (missing.length > 0) throw new Error(`Regioni mancanti: ${missing.join(", ")}`);
  return ITALY_MACRO_AREAS.map((area) => {
    const areaRegions = byArea.get(area)!;
    return { area, regions: areaRegions, summary: summarizeRegionGroup(area, areaRegions) };
  });
}
