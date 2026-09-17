import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/istat-poverta-soglia-assoluta-2005-2024.source.json";

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
  z.custom<T>((value) => canonical(value) === canonical(expected), "Campo diverso dal lock soglia povertà assoluta");

const observationSchema = z.object({
  territory: z.string(),
  householdTypology: z.string(),
  municipalitySize: z.string(),
  year: z.number().int().min(2005).max(2024),
  valueHundredths: z.number().int().nonnegative().nullable(),
  status: z.null(),
}).strict();

const dataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-poverta-soglia-assoluta"),
  domain: locked(sourceLock.domain),
  period: locked(sourceLock.period),
  periodNote: locked(sourceLock.periodNote),
  indicators: locked(sourceLock.indicators),
  territories: locked(sourceLock.territories),
  householdTypologies: locked(sourceLock.householdTypologies),
  municipalitySizes: locked(sourceLock.municipalitySizes),
  flags: locked(sourceLock.flags),
  caveats: locked(sourceLock.caveats),
  reconciliation: locked(sourceLock.reconciliation),
  scale: z.object({ factor: z.literal(100), note: z.string().min(1) }).strict(),
  observations: z.array(observationSchema).length(sourceLock.observations),
}).strict();

export type IstatPovertaSogliaAssolutaData = z.infer<typeof dataSchema>;

export function validateIstatPovertaSogliaAssolutaBundle(data: unknown, metadata: unknown) {
  const { integrity } = sourceLock;
  const normalizedLock = { ...sourceLock, integrity: { ...integrity, sourceLockSha256: "" } };
  if (digest(normalizedLock) !== integrity.sourceLockSha256) {
    throw new Error("Snapshot soglia povertà assoluta: hash del source lock diverso.");
  }
  const parsed = dataSchema.parse(data);
  const serialized = canonical(parsed);
  if (digest(parsed) !== integrity.dataArtifact.sha256 || Buffer.byteLength(serialized) !== integrity.dataArtifact.bytes) {
    throw new Error("Snapshot soglia povertà assoluta: hash o dimensione dell'artefatto diversi dal lock.");
  }
  const expectedMetadata = {
    schemaVersion: 1,
    datasetId: "istat-poverta-soglia-assoluta",
    period: sourceLock.period,
    acquiredAt: sourceLock.source.acquisitionDate,
    source: sourceLock.source,
    semantics: sourceLock.semantics,
    integrity,
  };
  if (canonical(metadata) !== canonical(expectedMetadata)) {
    throw new Error("Snapshot soglia povertà assoluta: metadati diversi da fonte, semantica o integrità dichiarate.");
  }
  const territories = new Set(parsed.territories.map((item) => item.code));
  const households = new Set(parsed.householdTypologies.map((item) => item.code));
  const municipalities = new Set(parsed.municipalitySizes.map((item) => item.code));
  const seen = new Set<string>();
  const nulls: (string | number)[][] = [];
  const coverage = new Map<string, number>();
  for (const row of parsed.observations) {
    const key = `${row.territory}/${row.householdTypology}/${row.municipalitySize}/${row.year}`;
    if (!territories.has(row.territory) || !households.has(row.householdTypology)
      || !municipalities.has(row.municipalitySize) || seen.has(key)
      || row.year < parsed.period.from || row.year > parsed.period.to) {
      throw new Error("Snapshot soglia povertà assoluta: chiave duplicata o dimensione fuori contratto.");
    }
    seen.add(key);
    if (row.valueHundredths === null) {
      if (row.status !== null) {
        throw new Error("Snapshot soglia povertà assoluta: null e status incoerenti.");
      }
      nulls.push([row.territory, row.householdTypology, row.municipalitySize, row.year]);
    } else if (row.status !== null) {
      throw new Error("Snapshot soglia povertà assoluta: valore con status non nullo.");
    }
    coverage.set(String(row.year), (coverage.get(String(row.year)) ?? 0) + 1);
  }
  if (canonical(nulls) !== canonical(sourceLock.nullCells)) {
    throw new Error("Snapshot soglia povertà assoluta: identità della cella non disponibile diversa.");
  }
  for (const indicator of parsed.indicators) {
    for (const [year, count] of Object.entries(indicator.coverage)) {
      if (coverage.get(year) !== count) {
        throw new Error("Snapshot soglia povertà assoluta: copertura per anno diversa.");
      }
    }
  }
  if (sourceLock.semantics.soldi.present !== true) {
    throw new Error("Snapshot soglia povertà assoluta: soldi.present deve essere true.");
  }
  return { data: parsed, metadata: expectedMetadata };
}
