import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/eurostat-arope-2015-2025.source.json";

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
  z.custom<T>((value) => canonical(value) === canonical(expected), "Campo diverso dal lock AROPE");
const RATE_SCALE = 10;
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;

if (
  sourceLock.indicators.length !== 1
  || sourceLock.indicators[0]?.code !== "AROPE"
  || sourceLock.semantics.soldi.present !== false
) {
  throw new Error("Snapshot AROPE: public metadata requires soldi absent and one AROPE indicator.");
}

const expectedPublicMetadata = {
  period: [
    `Anni ${sourceLock.period.from}–${sourceLock.period.to}`,
    sourceLock.semantics.periodo.note,
    `LAST UPDATE fonte ${sourceLock.fixedDimensions["LAST UPDATE"]}; acquisizione ${sourceLock.source.acquisitionDate}`,
  ],
  units: [
    `Tasso AROPE in decimi di punto percentuale (×${RATE_SCALE})`,
    "Persone in migliaia (THS_PER Eurostat)",
  ],
  coverage: sourceLock.periodNote,
  references: [
    { label: "Eurostat · ilc_peps01n", url: sourceLock.source.landingUrl },
    { label: "Eurostat · glossario AROPE", url: sourceLock.source.informationUrl },
    { label: "Eurostat · copyright", url: sourceLock.source.termsUrl },
  ],
};

const observationSchema = z.object({
  territory: z.literal("IT"),
  year: z.number().int().min(2015).max(2025),
  rateTenths: z.number().int().nonnegative(),
  personsThousands: z.number().int().nonnegative(),
  status: z.null(),
}).strict();

const dataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-arope"),
  domain: locked(sourceLock.domain),
  period: locked(sourceLock.period),
  periodNote: locked(sourceLock.periodNote),
  definitionNote: locked(sourceLock.definitionNote),
  indicators: locked(sourceLock.indicators),
  territories: locked(sourceLock.territories),
  flags: locked(sourceLock.flags),
  caveats: locked(sourceLock.caveats),
  reconciliation: locked(sourceLock.reconciliation),
  scale: locked(sourceLock.scale),
  observations: z.array(observationSchema).length(sourceLock.observations),
}).strict();

export type EurostatAropeData = z.infer<typeof dataSchema>;

export function validateEurostatAropeBundle(data: unknown, metadata: unknown) {
  const { integrity } = sourceLock;
  const normalizedLock = { ...sourceLock, integrity: { ...integrity, sourceLockSha256: "" } };
  if (digest(normalizedLock) !== integrity.sourceLockSha256) {
    throw new Error("Snapshot AROPE: hash del source lock diverso.");
  }
  const parsed = dataSchema.parse(data);
  const serialized = canonical(parsed);
  if (digest(parsed) !== integrity.dataArtifact.sha256 || Buffer.byteLength(serialized) !== integrity.dataArtifact.bytes) {
    throw new Error("Snapshot AROPE: hash o dimensione dell'artefatto diversi dal lock.");
  }
  const expectedMetadata = {
    schemaVersion: 1,
    datasetId: "eurostat-arope",
    period: sourceLock.period,
    acquiredAt: sourceLock.source.acquisitionDate,
    source: sourceLock.source,
    semantics: sourceLock.semantics,
    publicMetadata: expectedPublicMetadata,
    integrity,
  };
  if (canonical(metadata) !== canonical(expectedMetadata)) {
    throw new Error("Snapshot AROPE: metadati diversi da fonte, semantica o integrità dichiarate.");
  }
  const seen = new Set<number>();
  for (const row of parsed.observations) {
    if (seen.has(row.year) || row.year < parsed.period.from || row.year > parsed.period.to) {
      throw new Error("Snapshot AROPE: anno duplicato o fuori periodo.");
    }
    seen.add(row.year);
  }
  if ([...seen].sort((a, b) => a - b).join(",") !== YEARS.join(",")) {
    throw new Error("Snapshot AROPE: copertura anni diversa dal lock.");
  }
  if (sourceLock.semantics.soldi.present !== false) {
    throw new Error("Snapshot AROPE: soldi.present deve essere false.");
  }
  return { data: parsed, metadata: expectedMetadata };
}
