import type { OpenCivitasMunicipality } from "./data/opencivitas-contract";

/** The page uses the published 0-10 levels as two descriptive bands. */
export const OPEN_CIVITAS_QUADRANT_THRESHOLD = 6;

export const OPEN_CIVITAS_QUADRANT_KEYS = [
  "low-low",
  "low-high",
  "high-low",
  "high-high",
] as const;

export type OpenCivitasQuadrantKey = (typeof OPEN_CIVITAS_QUADRANT_KEYS)[number];
export type OpenCivitasLevelBand = "low" | "high";

export type OpenCivitasAggregate = Readonly<{
  municipalities: number;
  historicalSpendingCents: number;
  standardSpendingCents: number;
  differenceCents: number;
}>;

export type OpenCivitasQuadrant = OpenCivitasAggregate & Readonly<{
  key: OpenCivitasQuadrantKey;
  spendingBand: OpenCivitasLevelBand;
  serviceBand: OpenCivitasLevelBand;
}>;

export type OpenCivitasQuadrantSummary = Readonly<{
  coveredMunicipalities: number;
  completeMunicipalities: number;
  excludedMunicipalities: number;
  completeTotals: OpenCivitasAggregate;
  quadrants: readonly OpenCivitasQuadrant[];
}>;

type MutableAggregate = {
  municipalities: number;
  historicalSpendingCents: number;
  standardSpendingCents: number;
  differenceCents: number;
};

type QuadrantDefinition = Readonly<{
  key: OpenCivitasQuadrantKey;
  spendingBand: OpenCivitasLevelBand;
  serviceBand: OpenCivitasLevelBand;
}>;

const QUADRANT_DEFINITIONS: readonly QuadrantDefinition[] = [
  { key: "low-low", spendingBand: "low", serviceBand: "low" },
  { key: "low-high", spendingBand: "low", serviceBand: "high" },
  { key: "high-low", spendingBand: "high", serviceBand: "low" },
  { key: "high-high", spendingBand: "high", serviceBand: "high" },
];

function emptyAggregate(): MutableAggregate {
  return {
    municipalities: 0,
    historicalSpendingCents: 0,
    standardSpendingCents: 0,
    differenceCents: 0,
  };
}

function safeSum(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`OpenCivitas: aggregato ${field} oltre il limite intero sicuro`);
  }
  return result;
}

function validateMoney(municipality: OpenCivitasMunicipality): void {
  for (const [field, value] of [
    ["historicalSpendingCents", municipality.historicalSpendingCents],
    ["standardSpendingCents", municipality.standardSpendingCents],
    ["differenceCents", municipality.differenceCents],
  ] as const) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`OpenCivitas: ${field} non è un intero sicuro`);
    }
  }
  if (municipality.historicalSpendingCents < 0 || municipality.standardSpendingCents <= 0) {
    throw new Error("OpenCivitas: importi comunali fuori intervallo");
  }
  if (
    municipality.differenceCents !==
    municipality.historicalSpendingCents - municipality.standardSpendingCents
  ) {
    throw new Error(`OpenCivitas: differenza non riconciliata per ${municipality.istatCode}`);
  }
}

function validateLevel(value: number | null, field: string): void {
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10)) {
    throw new Error(`OpenCivitas: ${field} fuori dalla scala 0-10`);
  }
}

function addAggregate(target: MutableAggregate, municipality: OpenCivitasMunicipality): void {
  target.municipalities += 1;
  target.historicalSpendingCents = safeSum(
    target.historicalSpendingCents,
    municipality.historicalSpendingCents,
    "spesa storica",
  );
  target.standardSpendingCents = safeSum(
    target.standardSpendingCents,
    municipality.standardSpendingCents,
    "fabbisogno standard",
  );
  target.differenceCents = safeSum(
    target.differenceCents,
    municipality.differenceCents,
    "differenza",
  );
}

function quadrantFor(
  spendingLevel: number,
  serviceLevel: number,
): OpenCivitasQuadrantKey {
  const spendingBand = spendingLevel >= OPEN_CIVITAS_QUADRANT_THRESHOLD ? "high" : "low";
  const serviceBand = serviceLevel >= OPEN_CIVITAS_QUADRANT_THRESHOLD ? "high" : "low";
  return `${spendingBand}-${serviceBand}` as OpenCivitasQuadrantKey;
}

/**
 * Groups only municipalities with both published levels into four descriptive
 * bands and reconciles each monetary aggregate in cents.
 */
export function summarizeOpenCivitasQuadrants(
  municipalities: readonly OpenCivitasMunicipality[],
): OpenCivitasQuadrantSummary {
  const aggregates = new Map<OpenCivitasQuadrantKey, MutableAggregate>(
    QUADRANT_DEFINITIONS.map(({ key }) => [key, emptyAggregate()]),
  );
  const completeTotals = emptyAggregate();
  let completeMunicipalities = 0;

  for (const municipality of municipalities) {
    validateMoney(municipality);
    validateLevel(municipality.spendingLevel, "livello della spesa");
    validateLevel(municipality.serviceLevel, "livello dei servizi");
    if (municipality.spendingLevel === null || municipality.serviceLevel === null) continue;

    const key = quadrantFor(municipality.spendingLevel, municipality.serviceLevel);
    const aggregate = aggregates.get(key);
    if (!aggregate) throw new Error(`OpenCivitas: quadrante inatteso ${key}`);
    addAggregate(aggregate, municipality);
    addAggregate(completeTotals, municipality);
    completeMunicipalities += 1;
  }

  const quadrants = QUADRANT_DEFINITIONS.map((definition) => {
    const aggregate = aggregates.get(definition.key);
    if (!aggregate) throw new Error(`OpenCivitas: quadrante mancante ${definition.key}`);
    if (aggregate.differenceCents !== aggregate.historicalSpendingCents - aggregate.standardSpendingCents) {
      throw new Error(`OpenCivitas: aggregato non riconciliato ${definition.key}`);
    }
    return { ...definition, ...aggregate };
  });

  if (
    completeTotals.differenceCents !==
    completeTotals.historicalSpendingCents - completeTotals.standardSpendingCents
  ) {
    throw new Error("OpenCivitas: totale degli aggregati non riconciliato");
  }

  return {
    coveredMunicipalities: municipalities.length,
    completeMunicipalities,
    excludedMunicipalities: municipalities.length - completeMunicipalities,
    completeTotals: { ...completeTotals },
    quadrants,
  };
}
