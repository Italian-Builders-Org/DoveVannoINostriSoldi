import { z } from "zod";

/**
 * Contratto fail-closed per gli snapshot ISTAT della povertà (34_727).
 *
 * Un solo motore, due famiglie: **assoluta** e **relativa**. Vivono nello stesso
 * dataflow ma non sono lo stesso dato, quindi ognuna ha id, lock, artefatti e
 * contratto runtime propri; qui si condivide solo la macchina, e la guardia di
 * famiglia rifiuta una misura dell'altra famiglia — mescolarle metterebbe due
 * definizioni diverse di povertà sullo stesso asse.
 *
 * Cinque proprietà della fonte sono pretese qui, non lasciate alla pagina:
 *
 * - il dataset NON contiene importi. È l'unico caso in cui l'asse `soldi` è
 *   dichiarato assente invece che ricostruito, e il contratto vincola l'unità a
 *   dirlo esplicitamente;
 * - misure di natura diversa non condividono un'unità: tassi, composizioni
 *   percentuali e conteggi in migliaia restano tipizzati separatamente, e solo i
 *   conteggi possono dichiararsi sommabili fra territori;
 * - `OBS_STATUS` qui è vincolato a `CL_FLAG`, non a `CL_OBS_STATUS`: il flag «0»
 *   significa «sotto la metà della cifra minima considerata», cioè un valore
 *   positivo, non uno zero. Una cella flaggata resta `null` e non diventa mai 0;
 * - le aree composite (Nord = Nord-ovest + Nord-est, Mezzogiorno = Sud + Isole)
 *   contengono già le loro parti e restano marcate: sommarle è doppio conteggio;
 * - le incidenze NON sono sommabili fra territori. Non è un caveat testuale: è
 *   verificato come asserzione negativa, perché se un giorno chiudessero per somma
 *   la misura avrebbe cambiato natura sotto la stessa etichetta.
 */

// Il prefisso si chiude con la barra: senza, "https://esploradati.istat.it" è
// prefisso letterale anche di "https://esploradati.istat.it.example.org".
const OFFICIAL_PREFIX = "https://esploradati.istat.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeInt = z.number().int().min(0);

const measureKind = z.enum(["rate", "composition", "count"]);
const territoryKind = z.enum(["country", "macro", "composite"]);

const COMPOSITION_TOTAL_TENTHS = 1_000;
const COMPOSITION_TOLERANCE_TENTHS = 2;

export type PovertaFamilyConfig = Readonly<{
  /** Id del dataset, distinto per famiglia. */
  datasetId: string;
  /** Token che ogni misura della famiglia deve contenere. */
  token: "POVASS" | "POVREL";
  /** Token dell'altra famiglia: nessuna misura può portarlo. */
  otherToken: "POVASS" | "POVREL";
  /** Etichetta leggibile, usata nei messaggi di errore. */
  label: string;
  /** Percorso dell'artefatto dati, vincolato nel metadata. */
  artifactPath: string;
}>;

const observationSchema = z
  .object({
    measure: z.string().min(3).max(24),
    territory: z.string().min(2).max(8),
    year: z.number().int().min(2014).max(2024),
    // Decimi: la fonte pubblica percentuali con al più un decimale e conteggi
    // interi. `null` è una cella flaggata e non è mai uno zero osservato.
    valueTenths: nonNegativeInt.nullable(),
  })
  .strict();

const territorySchema = z
  .object({
    code: z.string().min(2).max(8),
    label: z.string().min(1),
    kind: territoryKind,
    parts: z.array(z.string().min(2)).min(2).optional(),
  })
  .strict();

const reconciliationCheckSchema = z
  .object({
    kind: z.enum(["territorio", "composizione"]),
    measure: z.string().min(3),
    whole: z.string().min(1),
    parts: z.array(z.string().min(1)).min(2),
    comparisons: z.number().int().positive(),
    maxGapTenths: nonNegativeInt,
    maxGapAt: z.string().min(1).nullable(),
  })
  .strict();

function measureSchemaFor(config: PovertaFamilyConfig) {
  return z
    .object({
      code: z.string().min(3).max(24),
      label: z.string().min(1),
      kind: measureKind,
      unit: z.enum(["percentuale", "migliaia"]),
      subject: z.enum(["famiglie", "individui"]),
      summableAcrossTerritories: z.boolean(),
    })
    .strict()
    .refine(
      (measure) => measure.kind === "count" || !measure.summableAcrossTerritories,
      "Solo i conteggi possono essere dichiarati sommabili fra territori",
    )
    .refine(
      (measure) => !measure.code.includes(config.otherToken),
      `Le misure dell'altra famiglia appartengono a un dataset distinto, non a ${config.datasetId}`,
    )
    .refine(
      (measure) => measure.code.includes(config.token),
      `Ogni misura deve appartenere alla famiglia ${config.label}`,
    );
}

function dataSchemaFor(config: PovertaFamilyConfig) {
  return z
    .object({
      schemaVersion: z.literal(1),
      datasetId: z.literal(config.datasetId),
      period: z.object({ from: z.literal(2014), to: z.literal(2024) }).strict(),
      caveats: z.array(z.string().min(1)).min(1),
      scale: z.object({ factor: z.literal(10), note: z.string().min(1) }).strict(),
      measures: z.array(measureSchemaFor(config)).length(7),
      territories: z.array(territorySchema).length(8),
      observations: z.array(observationSchema).min(1),
      flags: z
        .object({
          attribute: z.literal("OBS_STATUS"),
          // Vincolato: è il punto in cui è facile sbagliare codelist e leggere «0»
          // come uno zero osservato.
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
          toleranceTenths: z.number().int().positive(),
          maxGapTenths: nonNegativeInt,
          checks: z.array(reconciliationCheckSchema).min(1),
          notSummable: z
            .array(z.object({ measure: z.string().min(3), assertion: z.string().min(1) }).strict())
            .min(1),
        })
        .strict(),
    })
    .strict();
}

function metadataSchemaFor(config: PovertaFamilyConfig) {
  return z
    .object({
      schemaVersion: z.literal(1),
      datasetId: z.literal(config.datasetId),
      period: z.object({ from: z.literal(2014), to: z.literal(2024) }).strict(),
      observedAt: isoDate,
      source: z
        .object({
          owner: z.string().min(1),
          landingUrl: officialUrl("Landing URL ISTAT non ufficiale"),
          dataflowId: z.literal("34_727_DF_DCCV_POVERTA_1"),
          dataflowLabel: z.string().min(1),
          // La risposta SDMX non espone alcuna licenza e non se ne inferisce una:
          // il contratto lo pretende esplicito.
          licenseId: z.literal("not-declared"),
          licenseNote: z.string().min(1),
          seriesNote: z.string().min(1),
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
      measures: z.array(measureSchemaFor(config)).length(7),
      reconciliation: z.record(z.string(), z.unknown()),
      // I tre assi semantici obbligatori dello standard di import (#264).
      semantics: z
        .object({
          soldi: z
            .object({
              // L'asse è dichiarato ASSENTE. Un'unità monetaria qui sarebbe una
              // invenzione: il dataset non contiene importi.
              unit: z.literal("nessuna — il dataset non contiene importi"),
              nature: z.string().min(1),
              note: z.string().min(1),
            })
            .strict(),
          periodo: z.object({ referencePeriod: z.literal("2014-2024"), note: z.string().min(1) }).strict(),
          provenance: z
            .object({
              holder: z.string().min(1),
              canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
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
            .object({ path: z.literal(config.artifactPath), bytes: z.number().int().positive(), sha256 })
            .strict(),
          sourceLockSha256: sha256,
        })
        .strict(),
    })
    .strict();
}

export const ISTAT_POVERTA_ASSOLUTA: PovertaFamilyConfig = {
  datasetId: "istat-poverta-assoluta",
  token: "POVASS",
  otherToken: "POVREL",
  label: "povertà assoluta",
  artifactPath: "src/data/generated/istat-poverta-assoluta-2014-2024.data.json",
};

export const ISTAT_POVERTA_RELATIVA: PovertaFamilyConfig = {
  datasetId: "istat-poverta-relativa",
  token: "POVREL",
  otherToken: "POVASS",
  label: "povertà relativa",
  artifactPath: "src/data/generated/istat-poverta-relativa-2014-2024.data.json",
};

// I tipi sono strutturalmente identici fra le due famiglie: si inferiscono dalla
// forma prodotta dalla factory e valgono per entrambe.
export type IstatPovertaData = z.infer<ReturnType<typeof dataSchemaFor>>;
export type IstatPovertaMetadata = z.infer<ReturnType<typeof metadataSchemaFor>>;
export type IstatPovertaObservation = z.infer<typeof observationSchema>;
export type IstatPovertaTerritory = z.infer<typeof territorySchema>;
export type IstatPovertaMeasure = IstatPovertaData["measures"][number];

function reconcile(data: IstatPovertaData, config: PovertaFamilyConfig): void {
  const fail = (message: string) => {
    throw new Error(`Snapshot ${config.label}: ${message}`);
  };

  if (data.coverage.observedCells !== data.coverage.expectedCells) {
    fail("copertura incompleta, il bundle non è pubblicabile.");
  }
  if (data.observations.length !== data.coverage.expectedCells) {
    fail("osservazioni e copertura dichiarata non coincidono.");
  }

  const territories = new Map(data.territories.map((entry) => [entry.code, entry]));
  const measures = new Map(data.measures.map((entry) => [entry.code, entry]));
  const byCell = new Map<string, number | null>();
  let flagged = 0;

  for (const observation of data.observations) {
    const key = `${observation.measure}/${observation.territory}/${observation.year}`;
    if (byCell.has(key)) fail(`osservazione duplicata ${key}.`);
    if (!territories.has(observation.territory) || !measures.has(observation.measure)) {
      fail(`codice fuori anagrafica in ${key}.`);
    }
    if (observation.valueTenths === null) flagged += 1;
    byCell.set(key, observation.valueTenths);
  }

  if (flagged !== data.flags.flaggedCells) {
    fail("il conteggio delle celle flaggate non corrisponde.");
  }

  // Un composito senza le sue parti non è verificabile e non va pubblicato come
  // se lo fosse.
  for (const territory of data.territories) {
    if (territory.kind !== "composite") continue;
    if (!territory.parts?.length) fail(`il composito ${territory.code} non dichiara le sue parti.`);
    for (const part of territory.parts ?? []) {
      if (!territories.has(part)) fail(`il composito ${territory.code} cita una parte sconosciuta.`);
    }
  }

  const years: number[] = [];
  for (let year = data.period.from; year <= data.period.to; year += 1) years.push(year);
  const cell = (measure: string, territory: string, year: number) =>
    byCell.get(`${measure}/${territory}/${year}`);

  // Ogni partizione dichiarata viene verificata, mai corretta.
  for (const check of data.reconciliation.checks) {
    for (const year of years) {
      let summed = 0;
      let complete = true;
      for (const part of check.parts) {
        const value = cell(check.measure, part, year);
        if (value === undefined || value === null) { complete = false; break; }
        summed += value;
      }
      if (!complete) continue;

      if (check.kind === "composizione") {
        if (Math.abs(summed - COMPOSITION_TOTAL_TENTHS) > COMPOSITION_TOLERANCE_TENTHS) {
          fail(`la composizione ${check.measure} non chiude a 100 nel ${year}.`);
        }
        continue;
      }

      const total = cell(check.measure, check.whole, year);
      if (total === undefined || total === null) continue;
      if (Math.abs(total - summed) > data.reconciliation.toleranceTenths) {
        fail(`la partizione ${check.whole} si scosta oltre la tolleranza dichiarata.`);
      }
    }
  }

  // Asserzione NEGATIVA: un tasso non chiude per somma. Se chiudesse, la misura
  // avrebbe cambiato natura sotto la stessa etichetta e il bundle si ferma.
  for (const entry of data.reconciliation.notSummable) {
    const measure = measures.get(entry.measure);
    if (!measure) fail(`${entry.measure} non è fra le misure pubblicate.`);
    if (measure && measure.kind !== "rate") {
      fail(`${entry.measure} non è un tasso e non va asserito non sommabile.`);
    }
    const base = data.territories.filter((item) => item.kind === "macro").map((item) => item.code);
    for (const year of years) {
      const national = cell(entry.measure, "IT", year);
      if (national === undefined || national === null) continue;
      let summed = 0;
      let complete = true;
      for (const part of base) {
        const value = cell(entry.measure, part, year);
        if (value === undefined || value === null) { complete = false; break; }
        summed += value;
      }
      if (!complete) continue;
      if (Math.abs(national - summed) <= data.reconciliation.toleranceTenths) {
        fail(
          `nel ${year} la somma delle ripartizioni di ${entry.measure} coincide con il valore ` +
            "nazionale. Un tasso non si comporta così: la misura è stata classificata male.",
        );
      }
    }
  }
}

export function createIstatPovertaValidator(config: PovertaFamilyConfig) {
  const dataSchema = dataSchemaFor(config);
  const metadataSchema = metadataSchemaFor(config);
  return function validate(
    data: unknown,
    metadata: unknown,
  ): { data: IstatPovertaData; metadata: IstatPovertaMetadata } {
    const parsedData = dataSchema.parse(data) as IstatPovertaData;
    const parsedMetadata = metadataSchema.parse(metadata) as IstatPovertaMetadata;
    if (parsedMetadata.period.from !== parsedData.period.from || parsedMetadata.period.to !== parsedData.period.to) {
      throw new Error(`Snapshot ${config.label}: il periodo dei metadati non è quello del dato.`);
    }
    const dataMeasures = parsedData.measures.map((entry) => entry.code).sort().join(",");
    const metaMeasures = parsedMetadata.measures.map((entry) => entry.code).sort().join(",");
    if (dataMeasures !== metaMeasures) {
      throw new Error(`Snapshot ${config.label}: le misure dei metadati non sono quelle del dato.`);
    }
    reconcile(parsedData, config);
    return { data: parsedData, metadata: parsedMetadata };
  };
}

export const validateIstatPovertaBundle = createIstatPovertaValidator(ISTAT_POVERTA_ASSOLUTA);
export const validateIstatPovertaRelativaBundle = createIstatPovertaValidator(ISTAT_POVERTA_RELATIVA);
