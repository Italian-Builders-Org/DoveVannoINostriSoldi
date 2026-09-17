import rawSnapshot from "@/data/generated/inps-civil-invalidity.json";
import {
  validateInpsCivilInvaliditySnapshot,
  type InpsCivilInvaliditySnapshot,
} from "@/lib/data/inps-invalidity-contract";

export const inpsCivilInvaliditySnapshot = validateInpsCivilInvaliditySnapshot(
  rawSnapshot as InpsCivilInvaliditySnapshot,
);

export const availableInpsSpendingYears = inpsCivilInvaliditySnapshot.spending.series.map(
  (point) => point.year,
);

export const availableInpsRegionalYears = inpsCivilInvaliditySnapshot.regionalNewPensions.years;

function normalizedRegion(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[‘’`´]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ");
}

export type InpsCivilInvalidityQuery = {
  year?: number;
  region?: string;
};

function roundedPercent(changeCents: number, previousCents: number): number {
  if (previousCents === 0) return 0;
  return Math.round((changeCents / previousCents) * 1_000) / 10;
}

export function queryInpsCivilInvalidity(query: InpsCivilInvalidityQuery = {}) {
  const validYears = new Set([...availableInpsSpendingYears, ...availableInpsRegionalYears]);
  if (query.year !== undefined && !validYears.has(query.year)) {
    throw new Error(
      `Anno INPS non disponibile. Anni validi: ${[...validYears].sort().join(", ")}.`,
    );
  }

  const requestedRegion = query.region ? normalizedRegion(query.region) : null;
  if (
    requestedRegion &&
    query.year !== undefined &&
    !availableInpsRegionalYears.includes(query.year)
  ) {
    throw new Error(`Il dettaglio regionale INPS non è disponibile per il ${query.year}.`);
  }
  const excluded = inpsCivilInvaliditySnapshot.regionalNewPensions.excludedRegions.find(
    (region) => normalizedRegion(region) === requestedRegion,
  );
  if (excluded) {
    throw new Error(
      `${excluded} non è inclusa nella serie INPS perché le prestazioni sono erogate direttamente dalle autonomie territoriali.`,
    );
  }

  const regions = requestedRegion
    ? inpsCivilInvaliditySnapshot.regionalNewPensions.regions.filter(
        (region) => normalizedRegion(region.region) === requestedRegion,
      )
    : inpsCivilInvaliditySnapshot.regionalNewPensions.regions;
  if (requestedRegion && regions.length === 0) {
    throw new Error(`Regione INPS non disponibile: ${query.region?.trim()}.`);
  }

  const selectedYearIndexes = inpsCivilInvaliditySnapshot.regionalNewPensions.years
    .map((year, index) => ({ year, index }))
    .filter(({ year }) => query.year === undefined || year === query.year);
  const spendingSeries = inpsCivilInvaliditySnapshot.spending.series.filter(
    (point) => query.year === undefined || point.year === query.year,
  );
  const comparisonIndex = query.year === undefined
    ? inpsCivilInvaliditySnapshot.spending.series.length - 1
    : inpsCivilInvaliditySnapshot.spending.series.findIndex((point) => point.year === query.year);
  const comparisonCurrent = inpsCivilInvaliditySnapshot.spending.series[comparisonIndex];
  const comparisonPrevious = comparisonIndex > 0
    ? inpsCivilInvaliditySnapshot.spending.series[comparisonIndex - 1]
    : undefined;
  const changeCents = comparisonCurrent && comparisonPrevious
    ? comparisonCurrent.amountCents - comparisonPrevious.amountCents
    : null;
  const stockYear = new Date(inpsCivilInvaliditySnapshot.benefitsStock.asOf).getUTCFullYear();

  return {
    query: {
      year: query.year ?? null,
      region: requestedRegion ? regions[0]?.region ?? query.region?.trim() ?? null : null,
    },
    scope: inpsCivilInvaliditySnapshot.scope,
    spending: {
      unit: inpsCivilInvaliditySnapshot.spending.unit,
      measure: inpsCivilInvaliditySnapshot.spending.measure,
      sourceId: inpsCivilInvaliditySnapshot.spending.sourceId,
      geographicScope: { level: "country", code: "IT", name: "Italia" },
      series: spendingSeries,
      change:
        comparisonCurrent && comparisonPrevious && changeCents !== null
          ? {
              fromYear: comparisonPrevious.year,
              toYear: comparisonCurrent.year,
              amountCents: changeCents,
              percent: roundedPercent(changeCents, comparisonPrevious.amountCents),
            }
          : null,
    },
    managementDetail2024:
      query.year === undefined || query.year === 2024
        ? {
            ...inpsCivilInvaliditySnapshot.managementDetail2024,
            geographicScope: { level: "country", code: "IT", name: "Italia" },
          }
        : null,
    benefitsStock:
      query.year === undefined || query.year === stockYear
        ? {
            ...inpsCivilInvaliditySnapshot.benefitsStock,
            geographicScope: { level: "country", code: "IT", name: "Italia" },
          }
        : null,
    regionalNewPensions: {
      ...inpsCivilInvaliditySnapshot.regionalNewPensions,
      geographicScopes: {
        rows: requestedRegion
          ? { level: "region", name: regions[0].region }
          : { level: "covered-regions", name: "18 regioni coperte" },
        nationalTotals: { level: "covered-regions", name: "18 regioni coperte" },
      },
      years: selectedYearIndexes.map(({ year }) => year),
      provisionalYears: inpsCivilInvaliditySnapshot.regionalNewPensions.provisionalYears.filter(
        (year) => query.year === undefined || year === query.year,
      ),
      nationalTotals: selectedYearIndexes.map(
        ({ index }) => inpsCivilInvaliditySnapshot.regionalNewPensions.nationalTotals[index],
      ),
      regions:
        selectedYearIndexes.length === 0
          ? []
          : regions.map((region) => ({
              region: region.region,
              values: selectedYearIndexes.map(({ index }) => region.values[index]),
            })),
    },
    territorialAvailability: inpsCivilInvaliditySnapshot.territorialAvailability,
    methodology: inpsCivilInvaliditySnapshot.methodology,
    provenance: inpsCivilInvaliditySnapshot.sources,
  };
}
