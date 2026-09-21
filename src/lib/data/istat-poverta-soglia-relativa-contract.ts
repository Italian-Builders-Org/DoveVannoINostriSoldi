import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/istat-poverta-soglia-relativa-2014-2024.source.json";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const locked = <T>(expected: T) =>
  z.custom<T>((value) => canonical(value) === canonical(expected), "Campo diverso dal lock soglia povertà relativa");
const SCALE_FACTOR = 100;
const EXCLUDED_YEAR = 2021;
const PUBLISHED_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024] as const;

const sogliaIndicator = sourceLock.indicators[0];
if (sourceLock.indicators.length !== 1 || sogliaIndicator?.code !== "SOGLIA_POVREL"
  || sourceLock.semantics.soldi.present !== true
  || sourceLock.excludedYear !== EXCLUDED_YEAR) {
  throw new Error("Snapshot soglia povertà relativa: public metadata requires soldi, one indicator and 2021 exclusion.");
}
const sogliaUnit = sogliaIndicator.unit as string;
const sogliaUnitNote = sogliaUnit === "" ? "UNIT_MEAS assente nel payload" : `UNIT_MEAS=${sogliaUnit}`;

const expectedPublicMetadata = {
  period: [
    `Anni pubblicati ${PUBLISHED_YEARS.join(", ")} (escluso il ${EXCLUDED_YEAR})`,
    sourceLock.semantics.periodo.note,
    `Dataflow aggiornato ${sourceLock.source.dataflowLastUpdate.slice(0, 10)}; acquisizione ${sourceLock.source.acquisitionDate}`,
  ],
  units: [
    `Soglia monetaria mensile in centesimi di euro (scale factor ${SCALE_FACTOR})`,
    sogliaUnitNote,
  ],
  coverage:
    `${sourceLock.periodNote} L'anno ${EXCLUDED_YEAR} è presente nella fonte e escluso dal prodotto: ${sourceLock.excludedYearReason}`,
  references: sourceLock.source.reuseTermsEvidence.map((url) => ({
    label: url.includes("open-data") ? "ISTAT · Open Data" : "ISTAT · Note legali",
    url,
  })),
};

const observationSchema = z.object({
  territory: z.string(),
  householdComposition: z.string(),
  year: z.number().int().min(2014).max(2024),
  valueHundredths: z.number().int().nonnegative(),
  status: z.null(),
}).strict().refine((row) => row.year !== EXCLUDED_YEAR, "excluded year leaked");

const dataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-poverta-soglia-relativa"),
  domain: locked(sourceLock.domain),
  period: locked(sourceLock.period),
  periodNote: locked(sourceLock.periodNote),
  excludedYear: z.literal(EXCLUDED_YEAR),
  excludedYearReason: locked(sourceLock.excludedYearReason),
  indicators: locked(sourceLock.indicators),
  territories: locked(sourceLock.territories),
  householdCompositions: locked(sourceLock.householdCompositions),
  flags: locked(sourceLock.flags),
  caveats: locked(sourceLock.caveats),
  reconciliation: locked(sourceLock.reconciliation),
  scale: z.object({ factor: z.literal(SCALE_FACTOR), note: z.string().min(1) }).strict(),
  observations: z.array(observationSchema).length(sourceLock.observations),
}).strict();

export type IstatPovertaSogliaRelativaData = z.infer<typeof dataSchema>;

export function validateIstatPovertaSogliaRelativaBundle(data: unknown, metadata: unknown) {
  const { integrity } = sourceLock;
  const normalizedLock = { ...sourceLock, integrity: { ...integrity, sourceLockSha256: "" } };
  if (digest(normalizedLock) !== integrity.sourceLockSha256) {
    throw new Error("Snapshot soglia povertà relativa: hash del source lock diverso.");
  }
  const parsed = dataSchema.parse(data);
  const serialized = canonical(parsed);
  if (digest(parsed) !== integrity.dataArtifact.sha256 || Buffer.byteLength(serialized) !== integrity.dataArtifact.bytes) {
    throw new Error("Snapshot soglia povertà relativa: hash o dimensione dell'artefatto diversi dal lock.");
  }
  const expectedMetadata = {
    schemaVersion: 1,
    datasetId: "istat-poverta-soglia-relativa",
    period: sourceLock.period,
    acquiredAt: sourceLock.source.acquisitionDate,
    source: sourceLock.source,
    semantics: sourceLock.semantics,
    publicMetadata: expectedPublicMetadata,
    integrity,
  };
  if (canonical(metadata) !== canonical(expectedMetadata)) {
    throw new Error("Snapshot soglia povertà relativa: metadati diversi da fonte, semantica o integrità dichiarate.");
  }
  const territories = new Set(parsed.territories.map((item) => item.code));
  const households = new Set(parsed.householdCompositions.map((item) => item.code));
  const seen = new Set<string>();
  const coverage = new Map<string, number>();
  for (const row of parsed.observations) {
    const key = `${row.territory}/${row.householdComposition}/${row.year}`;
    if (!territories.has(row.territory) || !households.has(row.householdComposition)
      || seen.has(key) || row.year < parsed.period.from || row.year > parsed.period.to
      || row.year === EXCLUDED_YEAR) {
      throw new Error("Snapshot soglia povertà relativa: chiave duplicata o dimensione fuori contratto.");
    }
    seen.add(key);
    if (row.status !== null) {
      throw new Error("Snapshot soglia povertà relativa: status non nullo.");
    }
    coverage.set(String(row.year), (coverage.get(String(row.year)) ?? 0) + 1);
  }
  for (const indicator of parsed.indicators) {
    for (const [year, count] of Object.entries(indicator.coverage)) {
      if (coverage.get(year) !== count) {
        throw new Error("Snapshot soglia povertà relativa: copertura per anno diversa.");
      }
    }
  }
  if (sourceLock.semantics.soldi.present !== true) {
    throw new Error("Snapshot soglia povertà relativa: soldi.present deve essere true.");
  }
  return { data: parsed, metadata: expectedMetadata };
}
