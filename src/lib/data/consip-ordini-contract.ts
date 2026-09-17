import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot Consip ordini (Convenzioni + MEPA).
 *
 * La fonte sopprime valori nelle celle invece di omettere righe: ogni riga
 * aggregata dichiara quante osservazioni portano un importo, quante lo hanno
 * soppresso e quante portano un importo negativo (storni/rettifiche pubblicati
 * dalla fonte). Il contratto blocca: identità inattesa, caveats assenti,
 * provenienza non ufficiale, licenza diversa da quella verificata sul catalogo,
 * riconciliazioni rotte fra aggregati e totali, e conteggi che non tornano.
 *
 * I prefissi di provenienza si chiudono con la barra: senza,
 * "https://dati.consip.it" e' prefisso letterale anche di
 * "https://dati.consip.it.example.org", e un host ostile passerebbe per
 * ufficiale. L'hash del lock resta la difesa vera sui byte, ma il controllo
 * di provenienza deve dire il vero da solo.
 */

const nonNegativeInt = z.number().int().min(0);

const observationSchema = z
  .object({
    year: z.number().int().min(2024).max(2026),
    channel: z.enum(["convenzioni", "mepa"]),
    key: z.string().min(1),
    rows: nonNegativeInt,
    rowsWithAmount: nonNegativeInt,
    rowsAmountSuppressed: nonNegativeInt,
    // Negativo possibile: un gruppo dominato dagli storni è un fatto della
    // fonte, non un errore dell'artefatto.
    amountKnownCents: z.number().int(),
    rowsWithNegativeAmount: nonNegativeInt,
    rowsWithOrders: nonNegativeInt,
    rowsOrdersSuppressed: nonNegativeInt,
    ordersKnown: nonNegativeInt,
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.rowsWithAmount + row.rowsAmountSuppressed !== row.rows) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "righe con importo + soppresse ≠ righe totali" });
    }
    if (row.rowsWithOrders + row.rowsOrdersSuppressed !== row.rows) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "righe con conteggio + soppresse ≠ righe totali" });
    }
    if (row.rowsWithNegativeAmount > row.rowsWithAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "righe negative oltre le righe con importo" });
    }
  });

const totalSchema = z
  .object({
    year: z.number().int().min(2024).max(2026),
    channel: z.enum(["convenzioni", "mepa"]),
    rows: nonNegativeInt,
    amountKnownCents: z.number().int(),
    rowsAmountSuppressed: nonNegativeInt,
    ordersKnown: nonNegativeInt,
    rowsOrdersSuppressed: nonNegativeInt,
  })
  .strict();

export const consipOrdiniDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("consip-ordini"),
    period: z.object({ from: z.literal(2024), to: z.literal(2026) }).strict(),
    caveats: z.array(z.string().min(1)).min(1),
    channels: z.tuple([z.literal("convenzioni"), z.literal("mepa")]),
    totals: z.array(totalSchema).length(6),
    byRegion: z.array(observationSchema).min(1),
    byAdministrationType: z.array(observationSchema).min(1),
  })
  .strict();

export const consipOrdiniMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("consip-ordini"),
    period: z.object({ from: z.literal(2024), to: z.literal(2026) }).strict(),
    source: z
      .object({
        owner: z.string().min(1),
        landingUrl: z.string().refine((url) => url.startsWith("https://dati.consip.it/"), "Landing URL Consip non ufficiale"),
        licenseId: z.literal("CC-BY-4.0"),
        licenseNote: z.string().min(1),
        packages: z.record(z.string(), z.string().min(1)),
        acquisition: z.object({ acquiredAt: z.string().min(1), checkedAt: z.string().min(1), note: z.string().min(1) }).strict(),
        assets: z.record(
          z.string(),
          z
            .object({
              url: z.string().refine((url) => url.startsWith("https://dati.consip.it/download/dataset/"), "URL asset Consip non ufficiale"),
              bytes: z.number().int().positive(),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              lastModified: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    suppression: z.object({ note: z.string().min(1), observedAt: z.string().min(1) }).strict(),
    // I tre assi semantici obbligatori dello standard di import (#264): se mancano, il
    // bundle non è pubblicabile — la semantica fa parte del dato, non della pagina.
    semantics: z
      .object({
        soldi: z.object({ unit: z.literal("centesimi di euro"), nature: z.string().min(1), note: z.string().min(1) }).strict(),
        periodo: z.object({ referencePeriod: z.literal("2024-2026"), note: z.string().min(1) }).strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(z.string().refine((url) => url.startsWith("https://dati.consip.it/"), "URL non ufficiale")).min(1),
            publicationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
            path: z.literal("src/data/generated/consip-ordini-2024-2026.data.json"),
            bytes: z.number().int().positive(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
        sourceLockSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();

export type ConsipOrdiniData = z.infer<typeof consipOrdiniDataSchema>;
export type ConsipOrdiniMetadata = z.infer<typeof consipOrdiniMetadataSchema>;
export type ConsipOrdiniObservation = z.infer<typeof observationSchema>;
export type ConsipOrdiniTotal = z.infer<typeof totalSchema>;

function reconcile(data: ConsipOrdiniData): void {
  for (const total of data.totals) {
    const regional = data.byRegion.filter((row) => row.year === total.year && row.channel === total.channel);
    const sumRows = regional.reduce((sum, row) => sum + row.rows, 0);
    const sumAmount = regional.reduce((sum, row) => sum + row.amountKnownCents, 0);
    if (sumRows !== total.rows || sumAmount !== total.amountKnownCents) {
      throw new Error(
        `Snapshot Consip non riconciliato: byRegion ${total.year}/${total.channel} non torna coi totali`,
      );
    }
  }
}

export function validateConsipOrdiniBundle(
  data: unknown,
  metadata: unknown,
): { data: ConsipOrdiniData; metadata: ConsipOrdiniMetadata } {
  const parsedData = consipOrdiniDataSchema.parse(data);
  const parsedMetadata = consipOrdiniMetadataSchema.parse(metadata);
  reconcile(parsedData);
  return { data: parsedData, metadata: parsedMetadata };
}
