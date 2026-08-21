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

export const ITALY_MACRO_AREAS = ["Nord", "Centro", "Sud e Isole"] as const;

export type ItalyMacroArea = (typeof ITALY_MACRO_AREAS)[number];

const MACRO_AREA_BY_REGION_NAME: Record<string, ItalyMacroArea> = {
  Piemonte: "Nord",
  "Valle d'Aosta/Vallée d'Aoste": "Nord",
  Lombardia: "Nord",
  "Trentino-Alto Adige/Südtirol": "Nord",
  Veneto: "Nord",
  "Friuli-Venezia Giulia": "Nord",
  Liguria: "Nord",
  "Emilia-Romagna": "Nord",
  Toscana: "Centro",
  Umbria: "Centro",
  Marche: "Centro",
  Lazio: "Centro",
  Abruzzo: "Sud e Isole",
  Molise: "Sud e Isole",
  Campania: "Sud e Isole",
  Puglia: "Sud e Isole",
  Basilicata: "Sud e Isole",
  Calabria: "Sud e Isole",
  Sicilia: "Sud e Isole",
  Sardegna: "Sud e Isole",
};

/** ISTAT ripartizione geografica for a region name; Nord merges nord-ovest and nord-est. */
export function macroAreaOf(regionName: string): ItalyMacroArea | null {
  return MACRO_AREA_BY_REGION_NAME[regionName] ?? null;
}

export type ItalyMacroAreaSummary = {
  area: ItalyMacroArea;
  value: number;
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
  const population = regions.reduce<number | null>(
    (total, region) =>
      region.population === null ? total : (total ?? 0) + region.population,
    null,
  );
  const municipalities = regions.reduce((total, region) => total + region.municipalities, 0);
  const municipalitiesWithPopulation = regions.reduce(
    (total, region) => total + region.municipalitiesWithPopulation,
    0,
  );
  return {
    area,
    value,
    population,
    perCapita: population ? value / population : null,
    municipalities,
    municipalitiesWithPopulation,
  };
}

export function groupRegionsByMacroArea<T extends SiopeRegionPoint>(
  regions: T[],
): Array<{ area: ItalyMacroArea; regions: T[]; summary: ItalyMacroAreaSummary }> {
  const byArea = new Map<ItalyMacroArea, T[]>(ITALY_MACRO_AREAS.map((area) => [area, []]));
  for (const region of regions) {
    const area = macroAreaOf(region.region);
    if (area) byArea.get(area)!.push(region);
  }
  return ITALY_MACRO_AREAS.map((area) => {
    const areaRegions = byArea.get(area)!;
    return { area, regions: areaRegions, summary: summarizeRegionGroup(area, areaRegions) };
  });
}
