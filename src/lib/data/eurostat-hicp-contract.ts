import { z } from "zod";

const OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/";
const officialUrl = z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), "URL Eurostat non ufficiale");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/u);
const signedInt = z.number().int().safe();
const nonNegativeInt = z.number().int().min(0).safe();
const divisionCode = z.enum(["CP01", "CP02", "CP03", "CP04", "CP05", "CP06", "CP07", "CP08", "CP09", "CP10", "CP11", "CP12", "CP13"]);
const geographyCode = z.enum(["EU27_2020", "EA21", "IT"]);
const flagCode = z.literal("e");

const metricFlags = z.object({
  indexHundredths: flagCode.optional(),
  annualRateTenths: flagCode.optional(),
  monthlyRateTenths: flagCode.optional(),
}).strict();

const totalObservation = z.object({
  period: month,
  indexHundredths: nonNegativeInt,
  annualRateTenths: signedInt,
  monthlyRateTenths: signedInt,
  flags: metricFlags.optional(),
}).strict();

const comparisonObservation = z.object({
  geo: geographyCode,
  period: z.literal("2026-07"),
  annualRateTenths: signedInt,
  flag: flagCode.optional(),
}).strict();

const divisionObservation = z.object({
  code: divisionCode,
  period: z.literal("2026-07"),
  annualRateTenths: signedInt,
  flag: flagCode.optional(),
}).strict();

const weightObservation = z.object({
  code: divisionCode,
  year: z.union([z.literal(2025), z.literal(2026)]),
  weightHundredthsPerThousand: nonNegativeInt,
}).strict();

const geography = z.object({
  code: geographyCode,
  label: z.string().min(1),
  kind: z.enum(["country", "aggregate"]),
}).strict();

const division = z.object({ code: divisionCode, label: z.string().min(1) }).strict();

export const eurostatHicpDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-hicp"),
  period: z.object({
    total: z.object({ from: z.literal("2022-01"), to: z.literal("2026-08") }).strict(),
    comparison: z.literal("2026-07"),
    divisions: z.literal("2026-07"),
    weightYears: z.tuple([z.literal(2025), z.literal(2026)]),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(5),
  units: z.object({
    indexHundredths: z.string().min(1),
    annualRateTenths: z.string().min(1),
    monthlyRateTenths: z.string().min(1),
    weightHundredthsPerThousand: z.string().min(1),
  }).strict(),
  flags: z.object({ e: z.string().min(1) }).strict(),
  geographies: z.array(geography).length(3),
  divisions: z.array(division).length(13),
  totalObservations: z.array(totalObservation).length(56),
  comparison: z.array(comparisonObservation).length(3),
  divisionObservations: z.array(divisionObservation).length(13),
  weights: z.array(weightObservation).length(26),
  coverage: z.object({
    expectedCells: z.literal(210),
    observedCells: z.literal(210),
    flaggedTotalCells: nonNegativeInt,
  }).strict(),
  reconciliation: z.object({
    weightTargetHundredthsPerThousand: z.literal(100_000),
    weightToleranceHundredthsPerThousand: z.literal(7),
    weightGapByYear: z.object({ "2025": signedInt, "2026": signedInt }).strict(),
    note: z.string().min(1),
  }).strict(),
}).strict();

const asset = z.object({
  filename: z.string().min(1),
  datasetCode: z.enum(["prc_hicp_minr", "prc_hicp_iw"]),
  url: officialUrl,
  bytes: z.number().int().positive(),
  sha256,
  sourceUpdated: z.string().min(1),
  structure: z.object({ id: z.enum(["PRC_HICP_MINR", "PRC_HICP_IW"]), agencyId: z.literal("ESTAT"), version: z.string().min(1) }).strict(),
}).strict();

export const eurostatHicpMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-hicp"),
  period: eurostatHicpDataSchema.shape.period,
  referencePeriod: z.literal("2022-01/2026-08 (totale Italia); 2026-07 (confronto e divisioni); pesi 2025-2026"),
  observedAt: isoDate,
  source: z.object({
    owner: z.literal("Eurostat (Commissione europea)"),
    landingUrl: officialUrl,
    weightsLandingUrl: officialUrl,
    informationUrl: officialUrl,
    licenseId: z.literal("CC-BY-4.0"),
    licenseNote: z.string().min(1),
    termsUrl: officialUrl,
    acquisition: z.object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) }).strict(),
    assets: z.object({
      "italy-total": asset,
      comparison: asset,
      divisions: asset,
      weights: asset,
    }).strict(),
  }).strict(),
  coverage: z.object({ observedAt: isoDate, note: z.string().min(1) }).strict(),
  semantics: z.object({
    soldi: z.object({ applicable: z.literal(false), unit: z.literal("non applicabile"), nature: z.string().min(1), note: z.string().min(1) }).strict(),
    periodo: z.object({ referencePeriod: z.string().min(1), note: z.string().min(1) }).strict(),
    provenance: z.object({
      holder: z.string().min(1),
      canonicalUrls: z.array(officialUrl).min(4),
      publicationDate: z.string().min(1),
      acquisitionDate: isoDate,
      checkedAt: isoDate,
      license: z.literal("CC-BY-4.0"),
      hashes: z.string().min(1),
    }).strict(),
  }).strict(),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.string().min(1),
    dataArtifact: z.object({
      path: z.literal("src/data/generated/eurostat-hicp-2022-2026.data.json"),
      bytes: z.number().int().positive(),
      sha256,
    }).strict(),
    sourceLockSha256: sha256,
  }).strict(),
}).strict();

export type EurostatHicpData = z.infer<typeof eurostatHicpDataSchema>;
export type EurostatHicpMetadata = z.infer<typeof eurostatHicpMetadataSchema>;
export type EurostatHicpDivisionCode = z.infer<typeof divisionCode>;

const DIVISIONS: readonly EurostatHicpDivisionCode[] = ["CP01","CP02","CP03","CP04","CP05","CP06","CP07","CP08","CP09","CP10","CP11","CP12","CP13"];
const GEOGRAPHIES = ["EU27_2020", "EA21", "IT"] as const;

function months(from: string, to: string): string[] {
  const result: string[] = [];
  let [year, currentMonth] = from.split("-").map(Number) as [number, number];
  const [toYear, toMonth] = to.split("-").map(Number) as [number, number];
  while (year < toYear || (year === toYear && currentMonth <= toMonth)) {
    result.push(`${year}-${String(currentMonth).padStart(2, "0")}`);
    currentMonth += 1;
    if (currentMonth === 13) { year += 1; currentMonth = 1; }
  }
  return result;
}

export function validateEurostatHicpData(value: unknown): EurostatHicpData {
  const data = eurostatHicpDataSchema.parse(value);
  const expectedPeriods = months(data.period.total.from, data.period.total.to);
  if (data.totalObservations.some((row, index) => row.period !== expectedPeriods[index])) {
    throw new Error("Snapshot Eurostat HICP: serie Italia non mensile/consecutiva.");
  }
  if (data.divisions.some((row, index) => row.code !== DIVISIONS[index]) || data.divisionObservations.some((row, index) => row.code !== DIVISIONS[index])) {
    throw new Error("Snapshot Eurostat HICP: tassonomia ECOICOP v2 incompleta o fuori ordine.");
  }
  if (data.geographies.some((row, index) => row.code !== GEOGRAPHIES[index]) || data.comparison.some((row, index) => row.geo !== GEOGRAPHIES[index])) {
    throw new Error("Snapshot Eurostat HICP: confronto geografico incompleto o fuori ordine.");
  }
  const weightKeys = data.weights.map((row) => `${row.year}/${row.code}`);
  const expectedWeightKeys = [2025, 2026].flatMap((year) => DIVISIONS.map((code) => `${year}/${code}`));
  if (weightKeys.some((key, index) => key !== expectedWeightKeys[index])) {
    throw new Error("Snapshot Eurostat HICP: pesi incompleti, duplicati o fuori ordine.");
  }
  for (const year of data.period.weightYears) {
    const total = data.weights.filter((row) => row.year === year).reduce((sum, row) => sum + row.weightHundredthsPerThousand, 0);
    const gap = total - data.reconciliation.weightTargetHundredthsPerThousand;
    if (gap !== data.reconciliation.weightGapByYear[String(year) as "2025" | "2026"] || Math.abs(gap) > data.reconciliation.weightToleranceHundredthsPerThousand) {
      throw new Error(`Snapshot Eurostat HICP: pesi ${year} non riconciliati a 1000‰.`);
    }
  }
  const flagged = data.totalObservations.reduce((count, row) => count + Object.keys(row.flags ?? {}).length, 0);
  if (flagged !== data.coverage.flaggedTotalCells || data.coverage.observedCells !== data.coverage.expectedCells) {
    throw new Error("Snapshot Eurostat HICP: copertura/flag divergenti.");
  }
  return data;
}

export function validateEurostatHicpMetadata(value: unknown): EurostatHicpMetadata {
  const metadata = eurostatHicpMetadataSchema.parse(value);
  if (metadata.period.total.to !== "2026-08" || metadata.period.comparison !== "2026-07" || metadata.period.divisions !== "2026-07") {
    throw new Error("Metadati Eurostat HICP: periodi inattesi.");
  }
  return metadata;
}
