import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot ISTAT BesT — dominio benessere economico.
 *
 * Sei proprietà della fonte sono pretese qui, non lasciate alla pagina:
 *
 * - **non esiste un periodo unico**: ogni indicatore ha il proprio `from`/`to` e la
 *   propria disponibilità per sesso. Un intervallo solo sarebbe falso per quattro
 *   misure su cinque, quindi la copertura è vincolata per indicatore;
 * - **il livello territoriale è letto, non dedotto**: la gerarchia viene da
 *   `CL_ITTER107`, non dalla lunghezza del codice — che sarebbe sbagliata, perché
 *   `ITCD` e `ITFG` hanno quattro caratteri come le regioni;
 * - **la gerarchia della fonte non marca i compositi**: `ITCD` e `ITFG` sono
 *   fratelli delle ripartizioni, tutti figli di `IT`, con zero figli propri. La
 *   natura composita è dichiarata e verificata, non derivata;
 * - **la catena di parentela ha un buco**: Bolzano e Trento puntano a padri assenti
 *   da questa fetta. Il contratto lo pretende dichiarato, così nessuna aggregazione
 *   futura può perderli in silenzio;
 * - **niente qui è un conteggio**: sono medie pro capite e percentuali, quindi le
 *   partizioni territoriali NON sono verificabili per somma e il contratto non finge
 *   di poterlo fare. L'invariante che regge è che il totale stia fra i due sessi;
 * - **`OBS_STATUS` è vincolato a `CL_FLAG`**, non a `CL_OBS_STATUS`: il codice `g`
 *   significa «il fenomeno esiste ma i dati non si conoscono», quindi `null` e mai 0.
 */

const OFFICIAL_PREFIX = "https://esploradati.istat.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeInt = z.number().int().min(0);
const year = z.number().int().min(2004).max(2024);

const territoryKind = z.enum(["country", "ripartizione", "regione", "provincia", "composite"]);
const sexCode = z.enum(["F", "M", "T"]);

const indicatorSchema = z
  .object({
    code: z.string().regex(/^04BEC\d{3}P$/),
    label: z.string().min(1),
    // La fonte dichiara l'unità inline: o euro, o valore percentuale.
    unit: z.enum(["EURO", "VAL_PERC"]),
    sexes: z.array(sexCode).min(1),
    from: year,
    to: year,
    observations: z.number().int().positive(),
    flagged: nonNegativeInt,
    // Nessuna misura è un conteggio: nessuna può dichiararsi sommabile.
    summableAcrossTerritories: z.literal(false),
  })
  .strict()
  .refine((indicator) => indicator.from <= indicator.to, "Periodo dell'indicatore invertito");

const territorySchema = z
  .object({
    code: z.string().min(2).max(6),
    label: z.string().min(1),
    kind: territoryKind,
    depth: z.number().int().min(0).max(3),
    parent: z.string().min(2).nullable(),
    parentOutsideDataset: z.string().min(2).optional(),
    parts: z.array(z.string().min(2)).min(2).optional(),
  })
  .strict();

const observationSchema = z
  .object({
    indicator: z.string().min(3),
    territory: z.string().min(2).max(6),
    sex: sexCode,
    year,
    // Decimi: la fonte pubblica con al più un decimale. `null` è una cella
    // flaggata e non è mai uno zero osservato.
    valueTenths: z.number().int().nullable(),
  })
  .strict();

export const istatBesDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("istat-bes-economico"),
    period: z.object({ from: year, to: year }).strict(),
    periodNote: z.string().min(1),
    caveats: z.array(z.string().min(1)).min(1),
    scale: z.object({ factor: z.literal(10), note: z.string().min(1) }).strict(),
    domain: z
      .object({
        code: z.literal("BES_04"),
        label: z.string().min(1),
        // Le edizioni BES sono revisioni: una sola, fissata.
        edition: z.string().regex(/^\d{4}$/),
        editionNote: z.string().min(1),
      })
      .strict(),
    indicators: z.array(indicatorSchema).min(1),
    territories: z.array(territorySchema).min(1),
    sexes: z.array(sexCode).length(3),
    observations: z.array(observationSchema).min(1),
    flags: z
      .object({
        attribute: z.literal("OBS_STATUS"),
        codelist: z.literal("CL_FLAG"),
        note: z.string().min(1),
        flaggedCells: nonNegativeInt,
      })
      .strict(),
    coverage: z
      .object({ expectedCells: z.number().int().positive(), observedCells: z.number().int().positive() })
      .strict(),
    reconciliation: z
      .object({
        note: z.string().min(1),
        kind: z.literal("totale-fra-i-sessi"),
        comparisons: z.number().int().positive(),
        violations: z.literal(0),
        widestMarginTenths: nonNegativeInt,
        widestMarginAt: z.string().min(1).nullable(),
        // Vincolato: la somma territoriale non è una riconciliazione valida qui.
        territorialSum: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const istatBesMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("istat-bes-economico"),
    period: z.object({ from: year, to: year }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.string().min(1),
        landingUrl: officialUrl("Landing URL ISTAT non ufficiale"),
        dataflowId: z.literal("DF_BES_TERRIT_4"),
        dataflowLabel: z.string().min(1),
        dataStructure: z.string().min(1),
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
    indicators: z.array(indicatorSchema).min(1),
    reconciliation: z.record(z.string(), z.unknown()),
    semantics: z
      .object({
        soldi: z.object({ unit: z.string().min(1), nature: z.string().min(1), note: z.string().min(1) }).strict(),
        periodo: z.object({ referencePeriod: z.string().min(1), note: z.string().min(1) }).strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
            publicationEdition: z.string().regex(/^\d{4}$/),
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
            path: z.literal("src/data/generated/istat-bes-economico-2004-2024.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type IstatBesData = z.infer<typeof istatBesDataSchema>;
export type IstatBesMetadata = z.infer<typeof istatBesMetadataSchema>;
export type IstatBesObservation = z.infer<typeof observationSchema>;
export type IstatBesIndicator = z.infer<typeof indicatorSchema>;
export type IstatBesTerritory = z.infer<typeof territorySchema>;

function reconcile(data: IstatBesData): void {
  const fail = (message: string) => {
    throw new Error(`Snapshot BesT benessere economico: ${message}`);
  };

  if (data.coverage.observedCells !== data.coverage.expectedCells) {
    fail("copertura incompleta, il bundle non è pubblicabile.");
  }
  if (data.observations.length !== data.coverage.expectedCells) {
    fail("osservazioni e copertura dichiarata non coincidono.");
  }

  const territories = new Map(data.territories.map((entry) => [entry.code, entry]));
  const indicators = new Map(data.indicators.map((entry) => [entry.code, entry]));
  const byCell = new Map<string, number | null>();
  let flagged = 0;

  for (const observation of data.observations) {
    const key = `${observation.indicator}/${observation.territory}/${observation.sex}/${observation.year}`;
    if (byCell.has(key)) fail(`osservazione duplicata ${key}.`);
    const indicator = indicators.get(observation.indicator);
    if (!indicator || !territories.has(observation.territory)) fail(`codice fuori anagrafica in ${key}.`);
    if (indicator) {
      // La copertura è per indicatore: un anno o un sesso fuori dal dichiarato
      // non è un dato in più, è un contratto diverso.
      if (observation.year < indicator.from || observation.year > indicator.to) {
        fail(`anno fuori dal periodo dichiarato per ${observation.indicator} in ${key}.`);
      }
      if (!indicator.sexes.includes(observation.sex)) {
        fail(`sesso non dichiarato per ${observation.indicator} in ${key}.`);
      }
    }
    if (observation.valueTenths === null) flagged += 1;
    byCell.set(key, observation.valueTenths);
  }

  if (flagged !== data.flags.flaggedCells) fail("il conteggio delle celle flaggate non corrisponde.");

  for (const territory of data.territories) {
    if (territory.kind === "composite") {
      if (!territory.parts?.length) fail(`il composito ${territory.code} non dichiara le sue parti.`);
      for (const part of territory.parts ?? []) {
        if (!territories.has(part)) fail(`il composito ${territory.code} cita una parte sconosciuta.`);
      }
    }
    if (territory.parent !== null && !territories.has(territory.parent)) {
      fail(`${territory.code} punta a un padre fuori anagrafica.`);
    }
    // Il buco nella catena va dichiarato: un padre assente e un padre interno
    // insieme significherebbe che l'anagrafica mente su uno dei due.
    if (territory.parentOutsideDataset && territory.parent !== null) {
      fail(`${territory.code} dichiara insieme un padre interno e uno fuori dataset.`);
    }
  }

  // L'invariante delle medie: il totale sta fra i due sessi. Non è un caveat
  // testuale, è un controllo — se saltasse, la misura non sarebbe una media.
  let comparisons = 0;
  for (const observation of data.observations) {
    if (observation.sex !== "T" || observation.valueTenths === null) continue;
    const base = `${observation.indicator}/${observation.territory}`;
    const female = byCell.get(`${base}/F/${observation.year}`);
    const male = byCell.get(`${base}/M/${observation.year}`);
    if (female === undefined || female === null || male === undefined || male === null) continue;
    comparisons += 1;
    const low = Math.min(female, male);
    const high = Math.max(female, male);
    if (observation.valueTenths < low || observation.valueTenths > high) {
      fail(
        `nel ${observation.year} il totale di ${observation.indicator} per ${observation.territory} ` +
          "sta fuori dall'intervallo dei due sessi: una media totale non si comporta così.",
      );
    }
  }
  if (comparisons !== data.reconciliation.comparisons) {
    fail("il numero di confronti fra sessi non corrisponde a quello dichiarato.");
  }
}

export function validateIstatBesBundle(
  data: unknown,
  metadata: unknown,
): { data: IstatBesData; metadata: IstatBesMetadata } {
  const parsedData = istatBesDataSchema.parse(data);
  const parsedMetadata = istatBesMetadataSchema.parse(metadata);
  if (parsedMetadata.semantics.provenance.publicationEdition !== parsedData.domain.edition) {
    throw new Error("Snapshot BesT: l'edizione dichiarata nella provenance non è quella del dato.");
  }
  const dataIndicators = parsedData.indicators.map((entry) => entry.code).sort().join(",");
  const metaIndicators = parsedMetadata.indicators.map((entry) => entry.code).sort().join(",");
  if (dataIndicators !== metaIndicators) {
    throw new Error("Snapshot BesT: gli indicatori dei metadati non sono quelli del dato.");
  }
  reconcile(parsedData);
  return { data: parsedData, metadata: parsedMetadata };
}
