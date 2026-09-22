import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/istat-permessi-costruire-2015-2025.source.json";

const integer = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data non valida");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const officialIstatUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "www.istat.it"
    && !url.username && !url.password && !url.port;
}, "Fonte non ufficiale ISTAT");

export const istatPermessiMetricSchema = z.object({
  value: integer.nullable(),
  status: z.enum(["observed", "missing"]),
}).strict().refine((cell) => (cell.status === "observed") === (cell.value !== null), "Stato e valore della cella incoerenti");

const a1Year = z.object({
  year: z.number().int().min(2015).max(2025),
  fabbricati: z.object({
    numero: istatPermessiMetricSchema,
    volume: istatPermessiMetricSchema,
    superficieTotale: istatPermessiMetricSchema,
  }).strict(),
  abitazioni: z.object({
    numero: istatPermessiMetricSchema,
    superficieUtile: istatPermessiMetricSchema,
    stanze: istatPermessiMetricSchema,
    accessoriInterni: istatPermessiMetricSchema,
  }).strict(),
}).strict();

const a2Year = z.object({
  year: z.number().int().min(2015).max(2025),
  ampliamentiConAbitazioni: z.object({
    abitazioni: istatPermessiMetricSchema,
    superficieUtile: istatPermessiMetricSchema,
    stanze: istatPermessiMetricSchema,
    accessoriInterni: istatPermessiMetricSchema,
  }).strict(),
  ampliamentiSoliVani: z.object({
    stanze: istatPermessiMetricSchema,
    accessoriInterni: istatPermessiMetricSchema,
    superficieUtile: istatPermessiMetricSchema,
  }).strict(),
  ampliamentiAltriUsi: z.object({
    superficieServiziEsterni: istatPermessiMetricSchema,
    superficieAttivitaProduttive: istatPermessiMetricSchema,
  }).strict(),
  totaleAmpliamenti: z.object({
    volume: istatPermessiMetricSchema,
    superficieTotale: istatPermessiMetricSchema,
  }).strict(),
}).strict();

const a3Sector = z.object({
  fabbricati: istatPermessiMetricSchema,
  volume: istatPermessiMetricSchema,
  superficieTotale: istatPermessiMetricSchema,
}).strict();

const a4Sector = z.object({
  volume: istatPermessiMetricSchema,
  superficieTotale: istatPermessiMetricSchema,
}).strict();

const sectorKeys = ["agricoltura", "industria", "commercio", "altro", "totale"] as const;

const a3Year = z.object({
  year: z.number().int().min(2015).max(2025),
  sectors: z.object({
    agricoltura: a3Sector,
    industria: a3Sector,
    commercio: a3Sector,
    altro: a3Sector,
    totale: a3Sector,
  }).strict(),
}).strict();

const a4Year = z.object({
  year: z.number().int().min(2015).max(2025),
  sectors: z.object({
    agricoltura: a4Sector,
    industria: a4Sector,
    commercio: a4Sector,
    altro: a4Sector,
    totale: a4Sector,
  }).strict(),
}).strict();

export const istatPermessiCostruireDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-permessi-costruire-2015-2025"),
  geography: z.object({ code: z.literal("IT"), label: z.literal("Italia") }).strict(),
  period: z.object({ from: z.literal(2015), to: z.literal(2025) }).strict(),
  units: z.object({
    counts: z.literal("units"),
    volume: z.literal("cubic-metres"),
    surface: z.literal("square-metres"),
  }).strict(),
  soldi: z.object({
    present: z.literal(false),
    note: z.string().min(1),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(6),
  tables: z.object({
    a1: z.object({
      code: z.literal("a.1"),
      kind: z.literal("nuova-edilizia-residenziale"),
      sheetName: z.literal("Tavola a.1"),
      years: z.array(a1Year).length(11),
    }).strict(),
    a2: z.object({
      code: z.literal("a.2"),
      kind: z.literal("ampliamenti-residenziali"),
      sheetName: z.literal(" Tavola a.2"),
      years: z.array(a2Year).length(11),
    }).strict(),
    a3: z.object({
      code: z.literal("a.3"),
      kind: z.literal("nuova-edilizia-non-residenziale"),
      sheetName: z.literal("Tavola a.3"),
      years: z.array(a3Year).length(11),
    }).strict(),
    a4: z.object({
      code: z.literal("a.4"),
      kind: z.literal("ampliamenti-non-residenziali"),
      sheetName: z.literal("Tavola a.4"),
      years: z.array(a4Year).length(11),
    }).strict(),
  }).strict(),
}).strict();

export const istatPermessiCostruireMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-permessi-costruire-2015-2025"),
  period: z.object({ from: z.literal(2015), to: z.literal(2025) }).strict(),
  observedAt: date,
  source: z.object({
    owner: z.literal("Istituto Nazionale di Statistica (ISTAT)"),
    landingUrl: officialIstatUrl,
    url: officialIstatUrl,
    filename: z.string().min(1),
    licenseId: z.literal("not-declared"),
    licenseNote: z.string().min(1),
    evidenceUrls: z.array(officialIstatUrl).min(2),
    publicationDate: date,
    acquiredAt: date,
    checkedAt: date,
    bytes: integer.refine((value) => value > 0),
    sha256,
    path: z.string().min(1),
    geography: z.string().min(1),
    updateFrequency: z.literal("annuale"),
    referenceYear: z.literal(2025),
  }).strict(),
  coverage: z.object({
    years: z.literal(11),
    tables: z.literal(4),
    geography: z.literal("national-only"),
  }).strict(),
  integrity: z.object({
    sourceLockSha256: sha256,
    dataSha256: sha256,
    dataBytes: integer.refine((value) => value > 0),
  }).strict(),
  semantics: z.object({
    soldi: z.object({
      present: z.literal(false),
      unit: z.null(),
      nature: z.literal("conteggi / volumi / superfici dei permessi di costruire; non soldi"),
    }).strict(),
    periodo: z.object({
      referencePeriod: z.literal("2015-2025"),
      referenceYearOfRelease: z.literal(2025),
      publicationDate: date,
    }).strict(),
    provenance: z.object({
      holder: z.literal("Istituto Nazionale di Statistica (ISTAT)"),
      publicationDate: date,
      acquiredAt: date,
      checkedAt: date,
    }).strict(),
  }).strict(),
}).strict();

export type IstatPermessiCostruireData = z.infer<typeof istatPermessiCostruireDataSchema>;
export type IstatPermessiCostruireMetadata = z.infer<typeof istatPermessiCostruireMetadataSchema>;
export type IstatPermessiMetric = z.infer<typeof istatPermessiMetricSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function requireEqual(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`ISTAT permessi costruire: ${label} incoerente con la fonte verificata.`);
  }
}

function requirePin(
  cell: IstatPermessiMetric,
  expected: number,
  label: string,
) {
  if (cell.status !== "observed" || cell.value !== expected) {
    throw new Error(`ISTAT permessi costruire: pin ${label} divergente.`);
  }
}

export function validateIstatPermessiCostruireBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: IstatPermessiCostruireData; metadata: IstatPermessiCostruireMetadata } {
  const data = istatPermessiCostruireDataSchema.parse(dataInput);
  const metadata = istatPermessiCostruireMetadataSchema.parse(metadataInput);
  const lockDigest = digest(canonicalJson({
    ...sourceLock,
    integrity: { ...sourceLock.integrity, lockSha256: "" },
  }));
  requireEqual(lockDigest, sourceLock.integrity.lockSha256, "hash source lock");
  requireEqual(metadata.integrity.sourceLockSha256, lockDigest, "hash metadata/source lock");
  requireEqual(digest(canonicalJson(dataInput)), sourceLock.dataCanonicalSha256, "digest canonico dati");
  const artifact = `${JSON.stringify(dataInput, null, 2)}\n`;
  requireEqual(metadata.integrity.dataSha256, digest(artifact), "hash artifact");
  requireEqual(metadata.integrity.dataBytes, Buffer.byteLength(artifact, "utf8"), "byte artifact");
  requireEqual(metadata.observedAt, sourceLock.source.acquiredAt, "osservazione");
  requireEqual(metadata.source.sha256, sourceLock.source.sha256, "sha256 fonte");
  requireEqual(metadata.source.bytes, sourceLock.source.bytes, "bytes fonte");
  requireEqual(metadata.source.licenseId, "not-declared", "licenza");
  requireEqual(metadata.semantics.provenance, {
    holder: sourceLock.source.owner,
    publicationDate: sourceLock.source.publicationDate,
    acquiredAt: sourceLock.source.acquiredAt,
    checkedAt: sourceLock.source.checkedAt,
  }, "provenance semantica");
  if (metadata.source.checkedAt < metadata.source.acquiredAt) {
    throw new Error("ISTAT permessi costruire: verifica precedente all'acquisizione.");
  }
  if (metadata.source.publicationDate > metadata.source.acquiredAt) {
    throw new Error("ISTAT permessi costruire: pubblicazione successiva all'acquisizione.");
  }
  if (data.soldi.present !== false || metadata.semantics.soldi.present !== false) {
    throw new Error("ISTAT permessi costruire: soldi.present deve restare false.");
  }

  const years = sourceLock.expected.years;
  for (const tableId of ["a1", "a2", "a3", "a4"] as const) {
    requireEqual(data.tables[tableId].years.map((row) => row.year), years, `anni ${tableId}`);
  }

  const a1_2025 = data.tables.a1.years.find((row) => row.year === 2025);
  const pins = sourceLock.expected.tables.a1.pin2025;
  if (!a1_2025) throw new Error("ISTAT permessi costruire: anno 2025 a.1 assente.");
  requirePin(a1_2025.fabbricati.numero, pins.fabbricati.numero, "a1 fabbricati.numero");
  requirePin(a1_2025.fabbricati.volume, pins.fabbricati.volume, "a1 fabbricati.volume");
  requirePin(a1_2025.fabbricati.superficieTotale, pins.fabbricati.superficieTotale, "a1 fabbricati.superficie");
  requirePin(a1_2025.abitazioni.numero, pins.abitazioni.numero, "a1 abitazioni.numero");
  requirePin(a1_2025.abitazioni.superficieUtile, pins.abitazioni.superficieUtile, "a1 abitazioni.superficie");
  requirePin(a1_2025.abitazioni.stanze, pins.abitazioni.stanze, "a1 abitazioni.stanze");
  requirePin(a1_2025.abitazioni.accessoriInterni, pins.abitazioni.accessoriInterni, "a1 abitazioni.accessori");

  const a3_2025 = data.tables.a3.years.find((row) => row.year === 2025);
  const a3Pins = sourceLock.expected.tables.a3.pin2025;
  if (!a3_2025) throw new Error("ISTAT permessi costruire: anno 2025 a.3 assente.");
  for (const sector of sectorKeys) {
    requirePin(a3_2025.sectors[sector].fabbricati, a3Pins[sector].fabbricati, `a3 ${sector}.fabbricati`);
    requirePin(a3_2025.sectors[sector].volume, a3Pins[sector].volume, `a3 ${sector}.volume`);
    requirePin(
      a3_2025.sectors[sector].superficieTotale,
      a3Pins[sector].superficieTotale,
      `a3 ${sector}.superficie`,
    );
  }

  return { data, metadata };
}
