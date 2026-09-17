import { createHash } from "node:crypto";
import sourceLock from "../../../scripts/etl/specs/mef-irpef-dettaglio-2017-2025.source.json";
import { z } from "zod";

/**
 * Contratto fail-closed per il dettaglio IRPEF del Dipartimento delle Finanze.
 *
 * Quattro proprietà sono pretese qui, non lasciate alla pagina:
 *
 * - la famiglia `bonus_irpef` misura **due strumenti diversi** sotto lo stesso
 *   nome: Bonus IRPEF fino al 2020, Trattamento integrativo dal 2022, entrambi
 *   nel 2021. Ogni tabella dichiara quale porta, e il contratto pretende che
 *   l'anno di transizione esista: senza, qualcuno concatenerebbe due politiche
 *   fiscali diverse in un'unica serie;
 * - lo schema è vincolato **per file**, non per famiglia. Diciotto schemi per
 *   settantanove file, e una misura che sparisce nel 2019, torna solo nel taglio
 *   regionale fino al 2022 e poi sparisce di nuovo. La disponibilità è dichiarata
 *   per famiglia × taglio × anno: un'assenza resta un'assenza;
 * - una cella vuota **non è uno zero**. La fonte pubblica le due cose fianco a
 *   fianco e il conteggio dichiarato deve tornare esatto;
 * - Frequenza, Ammontare e Numero contribuenti sono **tre nature distinte** e il
 *   contratto le tiene etichettate perché nessuno le sommi.
 */

// Il prefisso si chiude con la barra: senza, "https://www1.finanze.gov.it" è
// prefisso letterale anche di "https://www1.finanze.gov.it.example.org".
const OFFICIAL_PREFIX = "https://www1.finanze.gov.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const family = z.enum(["tipo_reddito", "calcolo_irpef", "bonus_irpef"]);
const breakdown = z.enum(["regione", "classeEta", "sesso"]);
const instrument = z.enum(["bonus", "trattamento"]);
const nature = z.enum(["frequenza", "ammontare", "conteggio"]);

const schemaSchema = z
  .object({
    dimensions: z.array(z.string().min(1)).length(2),
    measures: z.array(z.object({ name: z.string().min(1), nature }).strict()).min(1),
  })
  .strict();

const tableSchema = z
  .object({
    id: z.string().min(3),
    family,
    breakdown,
    year: z.number().int().min(2017).max(2025),
    taxYear: z.number().int().min(2016).max(2024),
    publicationDate: isoDate,
    schemaId: z.string().min(2),
    instruments: z.array(instrument),
    // Zero righe e' possibile: il catalogo pubblica un rilascio con la sola
    // intestazione, e dev'essere dichiarato invece di sparire.
    rows: z.number().int().min(0),
    emptyCells: z.number().int().min(0),
    negativeCells: z.number().int().min(0),
  })
  .strict();

export const mefIrpefDettaglioDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("mef-irpef-dettaglio"),
    period: z.object({ from: z.literal(2017), to: z.literal(2025) }).strict(),
    periodBasis: z.literal("declaration-year"),
    taxPeriod: z.object({ from: z.literal(2016), to: z.literal(2024) }).strict(),
    caveats: z.array(z.string().min(1)).min(1),
    instruments: z
      .object({
        bonus: z.object({ label: z.string().min(1), years: z.string().min(1) }).strict(),
        trattamento: z.object({ label: z.string().min(1), years: z.string().min(1) }).strict(),
        note: z.string().min(1),
      })
      .strict(),
    schemas: z.record(z.string(), schemaSchema),
    tables: z.array(tableSchema).min(1),
    availability: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string().min(2)))),
    // Le righe sono validate a mano nel reconcile: 25.534 righe per una trentina
    // di valori sono 765.000 controlli, e passarli tutti per zod costerebbe
    // secondi a ogni avvio senza aggiungere una garanzia che il ciclo non dia.
    rows: z.array(z.unknown()).min(1),
    coverage: z
      .object({
        expectedFiles: z.number().int().positive(),
        observedFiles: z.number().int().positive(),
        expectedRows: z.number().int().positive(),
        observedRows: z.number().int().positive(),
        emptyCells: z.number().int().min(0),
        negativeCells: z.number().int().min(0),
        // I due file che il catalogo elenca ma non serve restano dichiarati,
        // e cosi' il rilascio pubblicato con la sola intestazione.
        missingFiles: z.record(z.string(), z.string().min(1)),
        emptyReleases: z.record(z.string(), z.string().min(1)),
      })
      .strict(),
  })
  .strict();

export const mefIrpefDettaglioMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("mef-irpef-dettaglio"),
    period: z.object({ from: z.literal(2017), to: z.literal(2025) }).strict(),
    periodBasis: z.literal("declaration-year"),
    taxPeriod: z.object({ from: z.literal(2016), to: z.literal(2024) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.literal("MEF - Dipartimento delle Finanze"),
        catalogReceipt: z.object({ url: officialUrl("Catalogo non ufficiale"), sha256, bytes: z.number().int().positive(), acquiredAt: isoDate, note: z.string().min(1) }).strict(),
        landingUrl: officialUrl("Landing URL del Dipartimento delle Finanze non ufficiale"),
        // Verificata per dataset sul catalogo, non ereditata dal dataset comunale.
        licenseId: z.literal("CC-BY-3.0-IT"),
        licenseNote: z.string().min(1),
        encoding: z.literal("utf-8"),
        delimiter: z.literal(";"),
        numberNote: z.string().min(1),
        acquisition: z.object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) }).strict(),
        missingFiles: z.record(z.string(), z.string().min(1)),
        emptyReleases: z.record(z.string(), z.string().min(1)),
        files: z.record(
          z.string(),
          z.object({ url: officialUrl("URL file non ufficiale"), bytes: z.number().int().positive(), sha256 }).strict(),
        ),
      })
      .strict(),
    instruments: z.record(z.string(), z.unknown()),
    availability: z.record(z.string(), z.unknown()),
    semantics: z
      .object({
        soldi: z.object({ unit: z.string().min(1), nature: z.string().min(1), note: z.string().min(1) }).strict(),
        periodo: z.object({ referencePeriod: z.literal("2016-2024"), note: z.string().min(1) }).strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            license: z.literal("CC-BY-3.0-IT"),
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
            path: z.literal("src/data/generated/mef-irpef-dettaglio-2017-2025.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type MefIrpefDettaglioData = z.infer<typeof mefIrpefDettaglioDataSchema>;
export type MefIrpefDettaglioMetadata = z.infer<typeof mefIrpefDettaglioMetadataSchema>;
export type MefIrpefDettaglioTable = z.infer<typeof tableSchema>;
export type MefIrpefDettaglioSchema = z.infer<typeof schemaSchema>;
export type MefIrpefDettaglioRow = Readonly<{ t: number; k: readonly [string, string]; v: readonly (number | null)[] }>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Valore non serializzabile nel data artifact MEF IRPEF");
}

function reconcile(data: MefIrpefDettaglioData): void {
  const coverage = data.coverage;
  if (coverage.observedFiles !== coverage.expectedFiles) {
    throw new Error("Snapshot MEF IRPEF: file attesi e osservati non coincidono.");
  }
  if (data.tables.length !== coverage.expectedFiles) {
    throw new Error("Snapshot MEF IRPEF: tabelle e copertura dichiarata non coincidono.");
  }
  if (data.rows.length !== coverage.expectedRows) {
    throw new Error("Snapshot MEF IRPEF: righe e copertura dichiarata non coincidono.");
  }
  if (Object.keys(coverage.missingFiles).length === 0) {
    throw new Error("Snapshot MEF IRPEF: i file assenti dal catalogo devono restare dichiarati.");
  }
  // Un rilascio con la sola intestazione non e' un fenomeno assente ne' una fila di zeri:
  // resta una tabella vuota dichiarata, e le due liste devono coincidere.
  const vuote = new Set(data.tables.filter((table) => table.rows === 0).map((table) => `${table.id}.csv`));
  const dichiarate = new Set(Object.keys(coverage.emptyReleases));
  if (vuote.size !== dichiarate.size || [...vuote].some((id) => !dichiarate.has(id))) {
    throw new Error("Snapshot MEF IRPEF: i rilasci vuoti non coincidono con quelli dichiarati.");
  }

  const widths = new Map(Object.entries(data.schemas).map(([id, s]) => [id, s.measures.length]));
  for (const table of data.tables) {
    if (!widths.has(table.schemaId)) {
      throw new Error(`Snapshot MEF IRPEF: schema sconosciuto in ${table.id}.`);
    }
    if (table.family === "bonus_irpef" && table.instruments.length === 0) {
      throw new Error(`Snapshot MEF IRPEF: ${table.id} non dichiara lo strumento misurato.`);
    }
  }

  // Le righe sono controllate qui, una volta, con un ciclo: struttura, larghezza
  // coerente con lo schema della tabella, e i due conteggi dichiarati.
  const keys = new Set<string>();
  const counts = data.tables.map(() => 0);
  let empty = 0;
  let negative = 0;
  for (const raw of data.rows) {
    const row = raw as MefIrpefDettaglioRow;
    if (!Number.isSafeInteger(row?.t) || row.t < 0) throw new Error("Snapshot MEF IRPEF: indice tabella non valido.");
    const table = data.tables[row?.t];
    if (!table) throw new Error("Snapshot MEF IRPEF: riga senza tabella.");
    if (!Array.isArray(row.k) || row.k.length !== 2 || row.k.some((key) => typeof key !== "string" || key === "")) {
      throw new Error(`Snapshot MEF IRPEF: chiavi malformate in ${table.id}.`);
    }
    if (!Array.isArray(row.v) || row.v.length !== widths.get(table.schemaId)) {
      throw new Error(`Snapshot MEF IRPEF: larghezza di riga incoerente con lo schema in ${table.id}.`);
    }
    const key = JSON.stringify([row.t, ...row.k]);
    if (keys.has(key)) throw new Error("Snapshot MEF IRPEF: riga duplicata.");
    keys.add(key);
    counts[row.t] += 1;
    for (const value of row.v) {
      if (value === null) empty += 1;
      else if (!Number.isSafeInteger(value)) {
        throw new Error(`Snapshot MEF IRPEF: valore non intero in ${table.id}.`);
      } else if (value < 0) negative += 1;
    }
  }
  if (counts.some((count, index) => count !== data.tables[index].rows)) throw new Error("Snapshot MEF IRPEF: conteggio righe per tabella divergente.");
  if (empty !== coverage.emptyCells) {
    throw new Error("Snapshot MEF IRPEF: conteggio delle celle vuote divergente — vuoto e zero non sono la stessa cosa.");
  }
  if (negative !== coverage.negativeCells) {
    throw new Error("Snapshot MEF IRPEF: conteggio delle celle negative divergente.");
  }

  // Il 2021 è l'anno in cui i due strumenti convivono: se sparisse, la
  // discontinuità fra bonus e trattamento smetterebbe di essere visibile.
  const transizione = data.tables.some(
    (table) => table.family === "bonus_irpef" && table.instruments.length === 2,
  );
  if (!transizione) {
    throw new Error("Snapshot MEF IRPEF: manca l'anno che espone bonus e trattamento insieme.");
  }
}

export function validateMefIrpefDettaglioBundle(
  data: unknown,
  metadata: unknown,
): { data: MefIrpefDettaglioData; metadata: MefIrpefDettaglioMetadata } {
  const parsedData = mefIrpefDettaglioDataSchema.parse(data);
  const parsedMetadata = mefIrpefDettaglioMetadataSchema.parse(metadata);
  if (Object.keys(parsedMetadata.source.files).length !== parsedData.tables.length) {
    throw new Error("Snapshot MEF IRPEF: file dichiarati e tabelle pubblicate non coincidono.");
  }
  reconcile(parsedData);
  const serialized = canonicalJson(parsedData);
  const expected = sourceLock.integrity.dataArtifact;
  if (createHash("sha256").update(serialized).digest("hex") !== expected.sha256
    || Buffer.byteLength(serialized) !== expected.bytes
    || canonicalJson(parsedMetadata.integrity.dataArtifact) !== canonicalJson(expected)) {
    throw new Error("Snapshot MEF IRPEF: hash o dimensione divergenti dal lock.");
  }
  const lockHash = createHash("sha256").update(canonicalJson({ ...sourceLock,
    integrity: { ...sourceLock.integrity, lockSha256: "" } })).digest("hex");
  if (lockHash !== sourceLock.integrity.lockSha256 || parsedMetadata.integrity.sourceLockSha256 !== lockHash) {
    throw new Error("Snapshot MEF IRPEF: hash del source lock divergente.");
  }
  const files = Object.fromEntries(Object.entries(sourceLock.expected.tables).map(([name, t]) => [name, {url:t.url,bytes:t.bytes,sha256:t.sha256}]));
  for (const key of ["owner", "landingUrl", "licenseId", "licenseNote", "encoding", "delimiter", "numberNote", "acquisition", "missingFiles", "emptyReleases", "catalogReceipt"] as const) {
    if (canonicalJson(parsedMetadata.source[key]) !== canonicalJson(sourceLock.source[key])) throw new Error(`Snapshot MEF IRPEF: source.${key} divergente dal lock.`);
  }
  if (canonicalJson(parsedMetadata.source.files) !== canonicalJson(files)
    || canonicalJson(parsedMetadata.availability) !== canonicalJson(parsedData.availability)
    || canonicalJson(parsedMetadata.instruments) !== canonicalJson(parsedData.instruments)
    || parsedMetadata.observedAt !== sourceLock.source.acquisition.acquiredAt) throw new Error("Snapshot MEF IRPEF: metadati divergenti dal lock.");
  return { data: parsedData, metadata: parsedMetadata };
}
