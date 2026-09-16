import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/istat-bes-paesaggio-2004-2023.source.json";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const locked = <T>(expected: T) => z.custom<T>((value) => canonical(value) === canonical(expected), "Campo diverso dal lock BesT Paesaggio");
const observationSchema = z.object({
  indicator: z.string(),
  territory: z.string(),
  sex: z.literal("T"),
  year: z.number().int().min(2004).max(2023),
  valueHundredths: z.number().int().nonnegative().nullable(),
  status: z.union([z.literal("n"), z.literal("g")]).nullable(),
}).strict();

const dataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-bes-paesaggio"),
  domain: locked(sourceLock.domain),
  period: locked(sourceLock.period),
  periodNote: locked(sourceLock.periodNote),
  indicators: locked(sourceLock.indicators),
  territories: locked(sourceLock.territories),
  flags: locked(sourceLock.flags),
  caveats: locked(sourceLock.caveats),
  reconciliation: locked(sourceLock.reconciliation),
  scale: z.object({ factor: z.literal(100), note: z.string().min(1) }).strict(),
  observations: z.array(observationSchema).length(sourceLock.observations),
}).strict();

export type IstatBesPaesaggioData = z.infer<typeof dataSchema>;

export function validateIstatBesPaesaggioBundle(data: unknown, metadata: unknown) {
  const { integrity } = sourceLock;
  const normalizedLock = { ...sourceLock, integrity: { ...integrity, sourceLockSha256: "" } };
  if (digest(normalizedLock) !== integrity.sourceLockSha256) {
    throw new Error("Snapshot BesT Paesaggio: hash del source lock diverso.");
  }
  const parsed = dataSchema.parse(data);
  const serialized = canonical(parsed);
  if (digest(parsed) !== integrity.dataArtifact.sha256 || Buffer.byteLength(serialized) !== integrity.dataArtifact.bytes) {
    throw new Error("Snapshot BesT Paesaggio: hash o dimensione dell'artefatto diversi dal lock.");
  }
  const expectedMetadata = {
    schemaVersion: 1,
    datasetId: "istat-bes-paesaggio",
    period: sourceLock.period,
    acquiredAt: sourceLock.source.acquisitionDate,
    source: sourceLock.source,
    semantics: sourceLock.semantics,
    integrity,
  };
  if (canonical(metadata) !== canonical(expectedMetadata)) {
    throw new Error("Snapshot BesT Paesaggio: metadati diversi da fonte, semantica o integrità dichiarate.");
  }
  const indicators = new Map(parsed.indicators.map((item) => [item.code, item]));
  const territories = new Set(parsed.territories.map((item) => item.code));
  const seen = new Set<string>();
  const nulls: (string | number)[][] = [];
  const coverage = new Map<string, number>();
  for (const row of parsed.observations) {
    const indicator = indicators.get(row.indicator);
    const key = `${row.indicator}/${row.territory}/${row.sex}/${row.year}`;
    if (!indicator || !territories.has(row.territory) || seen.has(key)
      || row.year < indicator.period.from || row.year > indicator.period.to) {
      throw new Error("Snapshot BesT Paesaggio: chiave duplicata o dimensione fuori contratto.");
    }
    seen.add(key);
    if ((row.valueHundredths === null) !== (row.status === "n" || row.status === "g")) {
      throw new Error("Snapshot BesT Paesaggio: null e flag di dato non disponibile incoerenti.");
    }
    if (row.valueHundredths === null) nulls.push([row.indicator, row.territory, row.sex, row.year]);
    const slice = `${row.indicator}/${row.sex}/${row.year}`;
    coverage.set(slice, (coverage.get(slice) ?? 0) + 1);
  }
  if (canonical(nulls) !== canonical(sourceLock.nullCells)) {
    throw new Error("Snapshot BesT Paesaggio: identità della cella non disponibile diversa.");
  }
  for (const indicator of parsed.indicators) {
    for (const [slice, count] of Object.entries(indicator.coverage)) {
      if (coverage.get(`${indicator.code}/${slice}`) !== count) {
        throw new Error("Snapshot BesT Paesaggio: copertura per indicatore, sesso e anno diversa.");
      }
    }
  }
  return { data: parsed, metadata: expectedMetadata };
}
