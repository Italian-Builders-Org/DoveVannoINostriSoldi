import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot ISTAT COFOG (consumi finali della PA per funzione).
 *
 * Quattro proprietà della fonte sono pretese qui, non lasciate alla pagina:
 *
 * - la misura è `P3`, consumi finali, NON la spesa pubblica totale. Il contratto
 *   la vincola per codice, così nessuno può scambiare questo snapshot per la
 *   spesa complessiva delle Amministrazioni pubbliche;
 * - una sola edizione e una sola valutazione: le edizioni sono revisioni e
 *   mescolarle inventerebbe una tendenza che è solo un riaggiornamento;
 * - le aree composite (Nord, Centro-nord, Mezzogiorno, Trentino Alto Adige)
 *   contengono già le loro parti e restano marcate: sommarle è doppio conteggio;
 * - le partizioni dichiarate — funzioni sul totale, aree sui loro insiemi — sono
 *   verificate entro una tolleranza dichiarata, mai corrette.
 */

// Il prefisso si chiude con la barra: senza, "https://esploradati.istat.it" è
// prefisso letterale anche di "https://esploradati.istat.it.example.org".
const OFFICIAL_PREFIX = "https://esploradati.istat.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeInt = z.number().int().min(0);

const functionCode = z.union([z.literal("G"), z.string().regex(/^G(0[1-9]0|100)$/)]);
const areaKind = z.enum(["country", "macro", "composite", "region", "extra-regio"]);

const observationSchema = z
  .object({
    area: z.string().min(2).max(8),
    year: z.number().int().min(1995).max(2023),
    function: functionCode,
    // Centesimi di euro: la fonte pubblica milioni con al più un decimale.
    amountCents: nonNegativeInt,
  })
  .strict();

const areaSchema = z.object({ code: z.string().min(2).max(8), label: z.string().min(1), kind: areaKind }).strict();
const functionSchema = z.object({ code: functionCode, label: z.string().min(1) }).strict();

const reconciliationCheckSchema = z
  .object({
    kind: z.enum(["funzioni", "territorio"]),
    whole: z.string().min(1),
    parts: z.array(z.string().min(1)).min(2),
    comparisons: z.number().int().positive(),
    maxGapCents: nonNegativeInt,
    maxGapAt: z.string().min(1).nullable(),
  })
  .strict();

export const istatCofogDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("istat-cofog"),
    period: z.object({ from: z.literal(1995), to: z.literal(2023) }).strict(),
    caveats: z.array(z.string().min(1)).min(1),
    measure: z
      .object({
        // Vincolato: se un refresh cambiasse misura, questo non sarebbe più lo
        // stesso dato e il bundle deve fermarsi.
        code: z.literal("P3_D_W0_S13"),
        meaning: z.string().min(1),
        unit: z.literal("centesimi di euro"),
        valuation: z.literal("V"),
        valuationLabel: z.string().min(1),
        edition: z.string().regex(/^\d{4}M\d{1,2}$/),
      })
      .strict(),
    functions: z.array(functionSchema).length(11),
    areas: z.array(areaSchema).min(1),
    observations: z.array(observationSchema).min(1),
    coverage: z
      .object({ expectedCells: z.number().int().positive(), observedCells: z.number().int().positive() })
      .strict(),
    reconciliation: z
      .object({
        note: z.string().min(1),
        toleranceCents: z.number().int().positive(),
        maxGapCents: nonNegativeInt,
        checks: z.array(reconciliationCheckSchema).min(1),
      })
      .strict(),
  })
  .strict();

export const istatCofogMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("istat-cofog"),
    period: z.object({ from: z.literal(1995), to: z.literal(2023) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.string().min(1),
        landingUrl: officialUrl("Landing URL ISTAT non ufficiale"),
        dataflowId: z.literal("93_1227_DF_DCCN_TNA1_4"),
        dataflowLabel: z.string().min(1),
        // La risposta SDMX non espone una licenza riusabile verificata e non se
        // ne inferisce una: il contratto lo pretende esplicito.
        licenseId: z.literal("not-declared"),
        licenseNote: z.string().min(1),
        acquisition: z.object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) }).strict(),
        assets: z.record(
          z.string(),
          z
            .object({
              url: officialUrl("URL asset ISTAT non ufficiale"),
              format: z.literal("SDMX-CSV 1.0.0"),
              bytes: z.number().int().positive(),
              sha256,
            })
            .strict(),
        ),
      })
      .strict(),
    measure: z.record(z.string(), z.unknown()),
    reconciliation: z.record(z.string(), z.unknown()),
    // I tre assi semantici obbligatori dello standard di import (#264).
    semantics: z
      .object({
        soldi: z
          .object({ unit: z.literal("centesimi di euro"), nature: z.string().min(1), note: z.string().min(1) })
          .strict(),
        periodo: z.object({ referencePeriod: z.literal("1995-2023"), note: z.string().min(1) }).strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
            // ISTAT non dichiara una data di pubblicazione: l'edizione è l'unico
            // riferimento di rilascio e resta tale, invece di essere convertita
            // in una data che la fonte non afferma.
            publicationEdition: z.string().regex(/^\d{4}M\d{1,2}$/),
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            license: z.literal("not-declared"),
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
            path: z.literal("src/data/generated/istat-cofog-1995-2023.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type IstatCofogData = z.infer<typeof istatCofogDataSchema>;
export type IstatCofogMetadata = z.infer<typeof istatCofogMetadataSchema>;
export type IstatCofogObservation = z.infer<typeof observationSchema>;
export type IstatCofogArea = z.infer<typeof areaSchema>;
export type IstatCofogFunction = z.infer<typeof functionSchema>;

function reconcile(data: IstatCofogData): void {
  if (data.coverage.observedCells !== data.coverage.expectedCells) {
    throw new Error("Snapshot ISTAT COFOG: copertura incompleta, il bundle non è pubblicabile.");
  }
  if (data.observations.length !== data.coverage.expectedCells) {
    throw new Error("Snapshot ISTAT COFOG: osservazioni e copertura dichiarata non coincidono.");
  }

  const areas = new Set(data.areas.map((area) => area.code));
  const functions = new Set(data.functions.map((entry) => entry.code));
  const byCell = new Map<string, number>();
  for (const observation of data.observations) {
    const key = `${observation.area}/${observation.year}/${observation.function}`;
    if (byCell.has(key)) throw new Error(`Snapshot ISTAT COFOG: osservazione duplicata ${key}.`);
    if (!areas.has(observation.area) || !functions.has(observation.function)) {
      throw new Error(`Snapshot ISTAT COFOG: codice fuori anagrafica in ${key}.`);
    }
    byCell.set(key, observation.amountCents);
  }

  const years: number[] = [];
  for (let year = data.period.from; year <= data.period.to; year += 1) years.push(year);

  // Ogni partizione dichiarata viene verificata, mai corretta: il totale della
  // fonte resta quello pubblicato e lo scarto è solo limitato.
  for (const check of data.reconciliation.checks) {
    const scope =
      check.kind === "funzioni"
        ? data.areas.map((area) => area.code).flatMap((area) => years.map((year) => ({ area, year })))
        : years.flatMap((year) => data.functions.map((entry) => ({ year, function: entry.code })));

    for (const item of scope) {
      const cell = (code: string) =>
        check.kind === "funzioni"
          ? byCell.get(`${(item as { area: string }).area}/${item.year}/${code}`)
          : byCell.get(`${code}/${item.year}/${(item as { function: string }).function}`);
      const total = cell(check.whole);
      if (total === undefined) continue;
      let summed = 0;
      let complete = true;
      for (const part of check.parts) {
        const value = cell(part);
        if (value === undefined) { complete = false; break; }
        summed += value;
      }
      if (!complete) continue;
      if (Math.abs(total - summed) > data.reconciliation.toleranceCents) {
        throw new Error(
          `Snapshot ISTAT COFOG: la partizione ${check.whole} si scosta oltre la tolleranza dichiarata.`,
        );
      }
    }
  }
}

export function validateIstatCofogBundle(
  data: unknown,
  metadata: unknown,
): { data: IstatCofogData; metadata: IstatCofogMetadata } {
  const parsedData = istatCofogDataSchema.parse(data);
  const parsedMetadata = istatCofogMetadataSchema.parse(metadata);
  if (parsedMetadata.semantics.provenance.publicationEdition !== parsedData.measure.edition) {
    throw new Error("Snapshot ISTAT COFOG: l'edizione dichiarata nella provenance non è quella del dato.");
  }
  reconcile(parsedData);
  return { data: parsedData, metadata: parsedMetadata };
}
