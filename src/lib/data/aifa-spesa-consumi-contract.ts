import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/aifa-spesa-consumi-2022-2025.source.json";

/**
 * Contratto fail-closed per lo snapshot AIFA «spesa e consumo» (issue #371).
 *
 * Quattro proprietà della fonte sono pretese qui, non lasciate alla pagina:
 *
 * - i due canali restano separati. Tracciabilità è sell-in alle strutture pubbliche
 *   al lordo dell'IVA, convenzionata è spesa in farmacia a prezzo al pubblico:
 *   sommarli darebbe un numero che la fonte non pubblica;
 * - un canale assente resta `null` e non diventa zero;
 * - solo la tracciabilità può essere negativa (resi e note di credito);
 * - l'aggregato pubblicato riconcilia al centesimo con i totali per anno dichiarati
 *   dall'ETL, che a loro volta vengono dalle righe del rilascio.
 *
 * Blocca inoltre identità inattesa, chiavi duplicate, hash divergenti dal source lock
 * e caveats mancanti sui punti che il dato non dice.
 */

const OFFICIAL_PREFIX = "https://www.aifa.gov.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeInt = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const nonNegativeInt = safeInt.min(0);
const regionCode = z.string().regex(/^(0[1-9]0|04[12]|1[0-9]0|200)$/);
const classCode = z.enum(["", "A", "C", "C-bis", "Cnn", "H", "N"]);
const atc2Code = z.string().regex(/^([A-Z]\d{2})?$/);

const PUBLISHED_ROWS = sourceLock.expected.publishedRows;
const YEARS = sourceLock.expected.years;

const observationSchema = z
  .object({
    year: z.number().int().min(YEARS[0]).max(YEARS[YEARS.length - 1]),
    regionCode,
    class: classCode,
    atc2: atc2Code,
    sourceRows: safeInt.min(1),
    // Canale assente: null, mai zero. Solo la tracciabilità ammette valori negativi.
    traceabilityPacks: safeInt.nullable(),
    traceabilitySpendCents: safeInt.nullable(),
    convenzionataPacks: nonNegativeInt.nullable(),
    convenzionataSpendCents: nonNegativeInt.nullable(),
  })
  .strict();

const yearTotalsSchema = z
  .object({
    year: z.number().int(),
    sourceRows: safeInt.min(1),
    traceabilityPacks: safeInt,
    traceabilitySpendCents: safeInt,
    convenzionataPacks: nonNegativeInt,
    convenzionataSpendCents: nonNegativeInt,
  })
  .strict();

const codeLabelSchema = z.object({ code: z.string(), label: z.string().min(1) }).strict();

export const aifaSpesaConsumiDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("aifa-spesa-consumi"),
    period: z.object({ from: z.literal(2022), to: z.literal(2025) }).strict(),
    granularity: z.literal("annual-region-class-atc2"),
    units: z
      .object({
        spendCents: z.string().min(1),
        packs: z.string().min(1),
        money: z.string().min(1),
      })
      .strict(),
    channels: z
      .array(
        z
          .object({
            id: z.enum(["convenzionata", "traceability"]),
            label: z.string().min(1),
            signed: z.boolean(),
          })
          .strict(),
      )
      .length(2),
    regions: z.array(codeLabelSchema).length(21),
    classes: z.array(codeLabelSchema).length(7),
    atc2: z.array(codeLabelSchema).min(80),
    coverage: z
      .object({
        years: z.array(z.number().int()).length(4),
        regions: z.literal(21),
        months: z.literal(12),
        publishedRows: z.literal(PUBLISHED_ROWS),
        sourceRows: z.record(z.string(), safeInt.min(1)),
        note: z.string().min(1),
      })
      .strict(),
    reconciliation: z
      .object({
        note: z.string().min(1),
        byYear: z.array(yearTotalsSchema).length(4),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(8),
    observations: z.array(observationSchema).length(PUBLISHED_ROWS),
  })
  .strict();

const assetSchema = z
  .object({
    year: z.number().int(),
    filename: z.string().min(1),
    url: officialUrl("asset non ufficiale AIFA"),
    bytes: z.number().int().positive(),
    sha256,
    member: z.string().min(1).optional(),
    memberBytes: z.number().int().positive().optional(),
    memberSha256: sha256.optional(),
  })
  .strict();

export const aifaSpesaConsumiMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("aifa-spesa-consumi"),
    period: z.object({ from: z.literal(2022), to: z.literal(2025) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.literal("AIFA — Agenzia Italiana del Farmaco"),
        landingUrl: officialUrl("landing non ufficiale"),
        catalogUrl: officialUrl("catalogo non ufficiale"),
        licenseId: z.literal("CC-BY-4.0"),
        licenseNote: z.string().min(1),
        termsUrl: z.string().url(),
        manualUrl: officialUrl("manuale non ufficiale"),
        manualNote: z.string().min(1),
        sourceUpdated: isoDate,
        acquisition: z
          .object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) })
          .strict(),
        assets: z.record(z.string(), assetSchema),
      })
      .strict(),
    coverage: z
      .object({
        observedAt: isoDate,
        note: z.string().min(1),
        excludedYears: z.record(z.string(), z.string().min(1)),
      })
      .strict(),
    // I tre assi semantici obbligatori dello standard di import.
    semantics: z
      .object({
        soldi: z
          .object({
            unit: z.literal("centesimi di euro"),
            nature: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        periodo: z
          .object({ referencePeriod: z.literal("2022-2025"), note: z.string().min(1) })
          .strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(3),
            publicationDate: isoDate,
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            license: z.literal("CC-BY-4.0"),
            hashes: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        canonicalization: z.string().min(1),
        dataArtifact: z
          .object({
            path: z.literal("src/data/generated/aifa-spesa-consumi-2022-2025.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type AifaSpesaConsumiData = z.infer<typeof aifaSpesaConsumiDataSchema>;
export type AifaSpesaConsumiMetadata = z.infer<typeof aifaSpesaConsumiMetadataSchema>;
export type AifaSpesaConsumiObservation = z.infer<typeof observationSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function requireEqual(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`aifa-spesa-consumi: ${label} incoerente con la fonte verificata`);
  }
}

export function validateAifaSpesaConsumiBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: AifaSpesaConsumiData; metadata: AifaSpesaConsumiMetadata } {
  const data = aifaSpesaConsumiDataSchema.parse(dataInput);
  const metadata = aifaSpesaConsumiMetadataSchema.parse(metadataInput);

  const lockDigest = digest(
    canonicalJson({ ...sourceLock, integrity: { ...sourceLock.integrity, lockSha256: "" } }),
  );
  requireEqual(lockDigest, sourceLock.integrity.lockSha256, "hash source lock");
  requireEqual(metadata.integrity.sourceLockSha256, lockDigest, "hash metadata/source lock");
  requireEqual(
    metadata.integrity.dataArtifact.sha256,
    sourceLock.integrity.dataArtifact.sha256,
    "hash data artifact nel lock",
  );
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");

  const keys = new Set(
    data.observations.map((row) => `${row.year}|${row.regionCode}|${row.class}|${row.atc2}`),
  );
  if (keys.size !== data.observations.length) {
    throw new Error("aifa-spesa-consumi: chiavi anno×regione×classe×ATC II non uniche");
  }

  const regions = new Set(data.regions.map((entry) => entry.code));
  const classes = new Set(data.classes.map((entry) => entry.code));
  const atc2 = new Set(data.atc2.map((entry) => entry.code));
  const totals = new Map(data.reconciliation.byYear.map((entry) => [entry.year, entry]));
  const sums = new Map<number, Record<string, number>>();

  for (const row of data.observations) {
    if (!regions.has(row.regionCode) || !classes.has(row.class)) {
      throw new Error(`aifa-spesa-consumi: codice fuori anagrafica in ${row.year}/${row.regionCode}`);
    }
    if (row.atc2 !== "" && !atc2.has(row.atc2)) {
      throw new Error(`aifa-spesa-consumi: ATC II fuori anagrafica: ${row.atc2}`);
    }
    // Confezioni e spesa devono essere entrambe presenti o entrambe assenti.
    if ((row.traceabilityPacks === null) !== (row.traceabilitySpendCents === null)) {
      throw new Error("aifa-spesa-consumi: tracciabilità con confezioni e spesa disallineate");
    }
    if ((row.convenzionataPacks === null) !== (row.convenzionataSpendCents === null)) {
      throw new Error("aifa-spesa-consumi: convenzionata con confezioni e spesa disallineate");
    }
    const bucket = sums.get(row.year) ?? {
      traceabilityPacks: 0,
      traceabilitySpendCents: 0,
      convenzionataPacks: 0,
      convenzionataSpendCents: 0,
    };
    bucket.traceabilityPacks += row.traceabilityPacks ?? 0;
    bucket.traceabilitySpendCents += row.traceabilitySpendCents ?? 0;
    bucket.convenzionataPacks += row.convenzionataPacks ?? 0;
    bucket.convenzionataSpendCents += row.convenzionataSpendCents ?? 0;
    sums.set(row.year, bucket);
  }

  for (const [year, declared] of totals) {
    const observed = sums.get(year);
    if (!observed) throw new Error(`aifa-spesa-consumi: anno ${year} dichiarato ma assente`);
    for (const field of [
      "traceabilityPacks",
      "traceabilitySpendCents",
      "convenzionataPacks",
      "convenzionataSpendCents",
    ] as const) {
      if (observed[field] !== declared[field]) {
        throw new Error(`aifa-spesa-consumi: ${year}, ${field} non riconcilia con i totali dichiarati`);
      }
    }
  }

  const caveats = data.caveats.join(" ");
  if (!/non vanno sommati/i.test(caveats)) {
    throw new Error("aifa-spesa-consumi: manca il caveat sui due canali");
  }
  if (!/payback/i.test(caveats)) {
    throw new Error("aifa-spesa-consumi: manca il caveat sul lordo payback");
  }
  if (!/COFOG|SSN/i.test(caveats)) {
    throw new Error("aifa-spesa-consumi: manca il caveat sui perimetri non sommabili");
  }

  return { data, metadata };
}
