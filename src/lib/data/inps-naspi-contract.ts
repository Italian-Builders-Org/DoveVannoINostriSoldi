import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot INPS NASpI (beneficiari e trattamenti).
 *
 * Tre proprietà sono pretese qui, non lasciate alla pagina:
 *
 * - `beneficiari` e `trattamenti` sono misure diverse — persone contro periodi
 *   di prestazione. Ogni osservazione dichiara la propria, e la misura deve
 *   coincidere con quella della tabella da cui viene: così nessuna somma può
 *   mescolarle per distrazione;
 * - una cella soppressa per privacy **non può diventare un numero**: `count`
 *   resta `null` e il flag `suppressed` è obbligatorio. Zero osservato e cella
 *   soppressa restano distinti;
 * - le riconciliazioni sono **esatte**, non tolleranti. Questa fonte non ha
 *   arrotondamenti da assorbire: le regioni sommano alla ripartizione, le
 *   province alla regione, e il taglio per sesso coincide con quello per età.
 *   Qualunque scarto è un guasto, non un residuo.
 */

// Il prefisso si chiude con la barra: senza, "https://opendata.inps.it" è
// prefisso letterale anche di "https://opendata.inps.it.example.org".
const OFFICIAL_PREFIX = "https://opendata.inps.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const measure = z.enum(["beneficiari", "trattamenti"]);

const observationSchema = z
  .object({
    table: z.string().min(3).max(40),
    measure,
    year: z.number().int().min(2018).max(2022),
    territorio: z.string().min(2).max(8),
    sesso: z.string().min(1).max(4).optional(),
    classeEta: z.string().min(1).max(12).optional(),
    durataMesiTeorica: z.string().min(1).max(12).optional(),
    // null solo quando la cella è soppressa: il superRefine lo pretende.
    count: z.number().int().min(0).nullable(),
    suppressed: z.literal(true).optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.suppressed && row.count !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cella soppressa con un valore" });
    }
    if (!row.suppressed && row.count === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cella senza valore ma non marcata soppressa" });
    }
  });

const tableSchema = z
  .object({
    id: z.string().min(3).max(40),
    measure,
    title: z.string().min(1),
    territoryLevel: z.enum(["ripartizione", "regione", "provincia"]),
    dimensions: z.array(z.string().min(1)).min(1),
    observations: z.number().int().positive(),
    suppressed: z.number().int().min(0),
  })
  .strict();

export const inpsNaspiDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-naspi"),
    period: z.object({ from: z.literal(2018), to: z.literal(2022) }).strict(),
    caveats: z.array(z.string().min(1)).min(1),
    measures: z.object({ beneficiari: z.string().min(1), trattamenti: z.string().min(1) }).strict(),
    suppression: z
      .object({
        marker: z
          .object({ obsValue: z.literal("_"), attribute: z.literal("MIS_PRIVACY"), attributeValue: z.string().min(1) })
          .strict(),
        note: z.string().min(1),
      })
      .strict(),
    tables: z.array(tableSchema).length(9),
    observations: z.array(observationSchema).min(1),
    coverage: z
      .object({
        expectedObservations: z.number().int().positive(),
        observedObservations: z.number().int().positive(),
        suppressed: z.number().int().min(0),
      })
      .strict(),
    reconciliation: z
      .object({
        note: z.string().min(1),
        // Esatte per costruzione: se un giorno servisse una tolleranza, sarebbe
        // un cambio di contratto e non una riga di configurazione.
        exact: z.literal(true),
        checks: z
          .array(
            z
              .object({
                id: z.string().min(1),
                kind: z.enum(["cross-table", "territorial"]),
                whole: z.string().min(1),
                part: z.string().min(1),
                comparisons: z.number().int().positive(),
                mismatches: z.literal(0),
                note: z.string().min(1),
              })
              .strict(),
          )
          .min(3),
      })
      .strict(),
  })
  .strict();

export const inpsNaspiMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-naspi"),
    period: z.object({ from: z.literal(2018), to: z.literal(2022) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.string().min(1),
        landingUrl: officialUrl("Landing URL INPS non ufficiale"),
        catalogApi: officialUrl("Catalog API INPS non ufficiale"),
        // Verificata per package sul catalogo, non estesa agli altri.
        licenseId: z.literal("IODL-2.0"),
        licenseNote: z.string().min(1),
        distributionChoice: z
          .object({
            used: z.string().min(1),
            rejectedCsv: z.string().min(1),
            rejectedJson: z.string().min(1),
          })
          .strict(),
        sdmxTestFlag: z.string().min(1),
        acquisition: z.object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) }).strict(),
        packages: z.record(
          z.string(),
          z
            .object({
              url: officialUrl("URL package INPS non ufficiale"),
              bytes: z.number().int().positive(),
              sha256,
              package: z.string().min(1),
              sdmxPrepared: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    reconciliation: z.record(z.string(), z.unknown()),
    // I tre assi semantici obbligatori dello standard di import (#264).
    semantics: z
      .object({
        soldi: z
          .object({
            // Il dataset non contiene importi: dichiararlo è parte dell'asse,
            // non un'omissione.
            unit: z.literal("nessuna — il dataset non contiene importi"),
            nature: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        periodo: z.object({ referencePeriod: z.literal("2018-2022"), note: z.string().min(1) }).strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
            publicationPrepared: z.array(z.string().min(1)).min(1),
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            license: z.literal("IODL-2.0"),
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
            path: z.literal("src/data/generated/inps-naspi-2018-2022.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type InpsNaspiData = z.infer<typeof inpsNaspiDataSchema>;
export type InpsNaspiMetadata = z.infer<typeof inpsNaspiMetadataSchema>;
export type InpsNaspiObservation = z.infer<typeof observationSchema>;
export type InpsNaspiTable = z.infer<typeof tableSchema>;

const TERRITORY_PREFIX: Record<string, number> = {
  "ripartizioni-vs-regioni": 3,
  "regioni-vs-province": 4,
};

function totals(
  observations: readonly InpsNaspiObservation[],
  table: string,
  prefix?: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of observations) {
    if (row.table !== table || row.count === null) continue;
    const territory = prefix ? row.territorio.slice(0, prefix) : row.territorio;
    const key = `${territory}/${row.year}`;
    out.set(key, (out.get(key) ?? 0) + row.count);
  }
  return out;
}

function reconcile(data: InpsNaspiData): void {
  const coverage = data.coverage;
  if (coverage.observedObservations !== coverage.expectedObservations) {
    throw new Error("Snapshot INPS NASpI: copertura incompleta, il bundle non è pubblicabile.");
  }
  if (data.observations.length !== coverage.expectedObservations) {
    throw new Error("Snapshot INPS NASpI: osservazioni e copertura dichiarata non coincidono.");
  }

  const tables = new Map(data.tables.map((table) => [table.id, table]));
  let suppressed = 0;
  for (const row of data.observations) {
    const table = tables.get(row.table);
    if (!table) throw new Error(`Snapshot INPS NASpI: tabella sconosciuta ${row.table}.`);
    if (table.measure !== row.measure) {
      throw new Error(`Snapshot INPS NASpI: misura incoerente in ${row.table} — persone e prestazioni non si mescolano.`);
    }
    if (row.suppressed) suppressed += 1;
  }
  if (suppressed !== coverage.suppressed) {
    throw new Error("Snapshot INPS NASpI: conteggio delle soppressioni divergente dalla copertura dichiarata.");
  }

  // Identità esatte: questa fonte non ha arrotondamenti da assorbire.
  for (const check of data.reconciliation.checks) {
    const whole = totals(data.observations, check.whole);
    const part = totals(data.observations, check.part, TERRITORY_PREFIX[check.id]);
    let compared = 0;
    for (const [key, value] of whole) {
      const other = part.get(key);
      if (other === undefined) continue;
      compared += 1;
      if (value !== other) {
        throw new Error(`Snapshot INPS NASpI: riconciliazione ${check.id} rotta su ${key}.`);
      }
    }
    if (compared !== check.comparisons) {
      throw new Error(`Snapshot INPS NASpI: riconciliazione ${check.id} con ${compared} confronti, attesi ${check.comparisons}.`);
    }
  }
}

export function validateInpsNaspiBundle(
  data: unknown,
  metadata: unknown,
): { data: InpsNaspiData; metadata: InpsNaspiMetadata } {
  const parsedData = inpsNaspiDataSchema.parse(data);
  const parsedMetadata = inpsNaspiMetadataSchema.parse(metadata);
  if (Object.keys(parsedMetadata.source.packages).length !== parsedData.tables.length) {
    throw new Error("Snapshot INPS NASpI: package dichiarati e tabelle pubblicate non coincidono.");
  }
  reconcile(parsedData);
  return { data: parsedData, metadata: parsedMetadata };
}
