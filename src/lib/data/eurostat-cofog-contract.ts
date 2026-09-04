import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot Eurostat COFOG (spesa pubblica per funzione).
 *
 * Tre proprietà della fonte sono pretese qui, non lasciate alla pagina:
 *
 * - la copertura è piena e deve restarlo: 4114 celle per unità, nessuna assente.
 *   Una lacuna futura ferma il bundle invece di diventare un buco nel grafico;
 * - il totale è quello pubblicato da Eurostat, non la somma delle dieci divisioni,
 *   da cui differisce per solo arrotondamento. Lo scarto è verificato contro una
 *   tolleranza dichiarata: oltre quella non è più arrotondamento ed è un guasto;
 * - i flag della fonte viaggiano con l'osservazione. «b» segna una interruzione
 *   della serie storica: chi traccia una tendenza attraverso quel punto sta
 *   affermando qualcosa che la fonte non dice.
 *
 * Blocca inoltre identità inattesa, caveats assenti, provenienza non ufficiale,
 * licenza diversa da quella verificata, duplicati e importi non interi.
 */

// Il prefisso si chiude con la barra: senza, "https://ec.europa.eu/eurostat"
// accetterebbe anche "https://ec.europa.eu/eurostat.example.org".
const OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeInt = z.number().int().min(0);

const functionCode = z.union([z.literal("TOTAL"), z.string().regex(/^GF(0[1-9]|10)$/)]);
const flagCode = z.enum(["p", "b"]);

const observationSchema = z
  .object({
    geo: z.string().min(2).max(12),
    year: z.number().int().min(2014).max(2024),
    function: functionCode,
    // Centesimi di euro: la fonte pubblica milioni con un decimale, quindi la
    // conversione resta esatta e nessun float entra nell'artefatto.
    amountCents: nonNegativeInt,
    shareOfGdpHundredths: nonNegativeInt,
    flag: flagCode.optional(),
  })
  .strict();

const functionSchema = z.object({ code: functionCode, label: z.string().min(1) }).strict();

const geographySchema = z
  .object({
    code: z.string().min(2).max(12),
    label: z.string().min(1),
    // Gli aggregati contengono già gli Stati membri: la distinzione è nel dato
    // perché sommarli sarebbe un doppio conteggio.
    kind: z.enum(["country", "aggregate"]),
  })
  .strict();

export const eurostatCofogDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("eurostat-cofog"),
    period: z.object({ from: z.literal(2014), to: z.literal(2024) }).strict(),
    caveats: z.array(z.string().min(1)).min(1),
    units: z
      .object({ amountCents: z.string().min(1), shareOfGdpHundredths: z.string().min(1) })
      .strict(),
    flags: z.object({ p: z.string().min(1), b: z.string().min(1) }).strict(),
    functions: z.array(functionSchema).length(11),
    geographies: z.array(geographySchema).min(1),
    observations: z.array(observationSchema).min(1),
    coverage: z
      .object({
        expectedCells: z.number().int().positive(),
        observedCells: z.number().int().positive(),
        flagged: nonNegativeInt,
      })
      .strict(),
    reconciliation: z
      .object({
        note: z.string().min(1),
        toleranceCents: z.number().int().positive(),
        toleranceShareHundredths: z.number().int().positive(),
        maxGapCents: nonNegativeInt,
        maxGapShareHundredths: nonNegativeInt,
        maxGapAt: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export const eurostatCofogMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("eurostat-cofog"),
    period: z.object({ from: z.literal(2014), to: z.literal(2024) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.string().min(1),
        landingUrl: officialUrl("Landing URL Eurostat non ufficiale"),
        datasetCode: z.literal("gov_10a_exp"),
        datasetLabel: z.string().min(1),
        structure: z
          .object({ id: z.string().min(1), agencyId: z.literal("ESTAT"), version: z.string().min(1) })
          .strict(),
        licenseId: z.literal("CC-BY-4.0"),
        licenseNote: z.string().min(1),
        termsUrl: officialUrl("Terms URL Eurostat non ufficiale"),
        acquisition: z
          .object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) })
          .strict(),
        assets: z.record(
          z.string(),
          z
            .object({
              unit: z.enum(["MIO_EUR", "PC_GDP"]),
              unitLabel: z.string().min(1),
              url: officialUrl("URL asset Eurostat non ufficiale"),
              bytes: z.number().int().positive(),
              sha256,
              sourceUpdated: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    coverage: z
      .object({
        observedAt: isoDate,
        note: z.string().min(1),
        excludedYears: z.record(z.string(), z.string().min(1)),
      })
      .strict(),
    reconciliation: z.record(z.string(), z.unknown()),
    // I tre assi semantici obbligatori dello standard di import (#264): se mancano, il
    // bundle non è pubblicabile — la semantica fa parte del dato, non della pagina.
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
          .object({ referencePeriod: z.literal("2014-2024"), note: z.string().min(1) })
          .strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
            // Eurostat pubblica un istante, non una data: resta com'è dichiarato.
            publicationDate: z.string().min(1),
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
            path: z.literal("src/data/generated/eurostat-cofog-2014-2024.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type EurostatCofogData = z.infer<typeof eurostatCofogDataSchema>;
export type EurostatCofogMetadata = z.infer<typeof eurostatCofogMetadataSchema>;
export type EurostatCofogObservation = z.infer<typeof observationSchema>;
export type EurostatCofogGeography = z.infer<typeof geographySchema>;
export type EurostatCofogFunction = z.infer<typeof functionSchema>;

const DIVISIONS = Array.from({ length: 10 }, (_, index) => `GF${String(index + 1).padStart(2, "0")}`);

function reconcile(data: EurostatCofogData): void {
  if (data.coverage.observedCells !== data.coverage.expectedCells) {
    throw new Error("Snapshot Eurostat COFOG: copertura incompleta, il bundle non è pubblicabile.");
  }
  if (data.observations.length !== data.coverage.expectedCells) {
    throw new Error("Snapshot Eurostat COFOG: osservazioni e copertura dichiarata non coincidono.");
  }

  const geographies = new Set(data.geographies.map((geography) => geography.code));
  const functions = new Set(data.functions.map((entry) => entry.code));
  const byCell = new Map<string, EurostatCofogObservation>();
  let flagged = 0;

  for (const observation of data.observations) {
    const key = `${observation.geo}/${observation.year}/${observation.function}`;
    if (byCell.has(key)) {
      throw new Error(`Snapshot Eurostat COFOG: osservazione duplicata ${key}.`);
    }
    if (!geographies.has(observation.geo) || !functions.has(observation.function)) {
      throw new Error(`Snapshot Eurostat COFOG: codice fuori anagrafica in ${key}.`);
    }
    byCell.set(key, observation);
    if (observation.flag) flagged += 1;
  }

  if (flagged !== data.coverage.flagged) {
    throw new Error("Snapshot Eurostat COFOG: conteggio dei flag divergente dalla copertura dichiarata.");
  }

  // Il totale della fonte non viene ricostruito: viene confrontato. Oltre la
  // tolleranza di arrotondamento dichiarata non è più arrotondamento.
  for (const geography of data.geographies) {
    for (let year = data.period.from; year <= data.period.to; year += 1) {
      const total = byCell.get(`${geography.code}/${year}/TOTAL`);
      if (!total) {
        throw new Error(`Snapshot Eurostat COFOG: manca il totale per ${geography.code}/${year}.`);
      }
      let sumCents = 0;
      let sumShare = 0;
      for (const division of DIVISIONS) {
        const part = byCell.get(`${geography.code}/${year}/${division}`);
        if (!part) {
          throw new Error(`Snapshot Eurostat COFOG: manca ${division} per ${geography.code}/${year}.`);
        }
        sumCents += part.amountCents;
        sumShare += part.shareOfGdpHundredths;
      }
      if (Math.abs(total.amountCents - sumCents) > data.reconciliation.toleranceCents) {
        throw new Error(
          `Snapshot Eurostat COFOG: ${geography.code}/${year}, il totale si scosta dalle divisioni oltre l'arrotondamento.`,
        );
      }
      if (Math.abs(total.shareOfGdpHundredths - sumShare) > data.reconciliation.toleranceShareHundredths) {
        throw new Error(
          `Snapshot Eurostat COFOG: ${geography.code}/${year}, la quota di PIL si scosta oltre l'arrotondamento.`,
        );
      }
    }
  }
}

export function validateEurostatCofogBundle(
  data: unknown,
  metadata: unknown,
): { data: EurostatCofogData; metadata: EurostatCofogMetadata } {
  const parsedData = eurostatCofogDataSchema.parse(data);
  const parsedMetadata = eurostatCofogMetadataSchema.parse(metadata);
  if (parsedMetadata.integrity.dataArtifact.path.includes(String(parsedData.period.from)) === false) {
    throw new Error("Snapshot Eurostat COFOG: percorso dell'artefatto incoerente col periodo.");
  }
  reconcile(parsedData);
  return { data: parsedData, metadata: parsedMetadata };
}
