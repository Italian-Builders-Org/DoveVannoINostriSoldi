import { z } from "zod";

const nonEmptyText = z.string().min(1);
const nonNegativeInteger = z.number().int().nonnegative().safe();

const territorialRowSchema = z.object({
  category: nonNegativeInteger,
  mission: nonNegativeInteger,
  territory: nonNegativeInteger,
  title: nonNegativeInteger,
  values: z.tuple([
    nonNegativeInteger,
    nonNegativeInteger,
    nonNegativeInteger,
    nonNegativeInteger,
  ]),
}).strict();

const measureSchema = z.object({
  additiveWithinOneTerritoryLevel: z.boolean(),
  denominatorStatus: z.union([
    z.literal("not_applicable"),
    z.literal("publisher_derived_not_versioned"),
  ]),
  label: nonEmptyText,
  publishedUnit: z.union([
    z.literal("million_eur"),
    z.literal("percent_of_gdp"),
    z.literal("eur_per_inhabitant"),
    z.literal("eur_per_square_kilometre"),
  ]),
  scale: z.literal(2),
  storageUnit: z.union([
    z.literal("hundredths_of_million_eur"),
    z.literal("hundredths_of_percent"),
    z.literal("hundredths_of_eur_per_inhabitant"),
    z.literal("hundredths_of_eur_per_square_kilometre"),
  ]),
}).strict();

export const rgsTerritorialSnapshotSchema = z.object({
  caveats: z.tuple([
    z.literal("Il CSV non espone codici territoriali, zone o un campo soggetto; questi campi non sono ricostruiti."),
    z.literal("Italia, macroaree e regioni sono livelli sovrapposti e non devono essere sommati insieme."),
    z.literal("Le misure percentuale, pro capite e per km² hanno denominatori calcolati dall'editore ma non versionati nel record."),
    z.literal("Una riga assente non è zero; zero è conservato soltanto quando osservato nel CSV."),
    z.literal("Gli scarti di riconciliazione sono controlli di arrotondamento sui valori pubblicati in centesimi di milione."),
    z.literal("Per ITALIA, l'incrocio fra categoria 09 e missione 034 riporta 8.057,70 milioni. Il CSV contiene quindi righe etichettate interessi e debito pubblico: la snapshot le conserva e non prova che ogni importo con queste etichette sia incluso o escluso dal perimetro descritto dalla landing."),
  ]),
  coverage: z.object({
    byMeasure: z.tuple([
      z.object({
        label: z.literal("Spesa Complessiva - Valori Assoluti (mln)"),
        sourceRows: z.literal(5_067),
        zeroValues: z.literal(299),
      }).strict(),
      z.object({
        label: z.literal("Spesa Complessiva - in rapporto al PIL (%)"),
        sourceRows: z.literal(5_067),
        zeroValues: z.literal(3_075),
      }).strict(),
      z.object({
        label: z.literal("Spesa Complessiva - per abitante (Euro)"),
        sourceRows: z.literal(5_067),
        zeroValues: z.literal(487),
      }).strict(),
      z.object({
        label: z.literal("Spesa Complessiva - per Kmq (Euro)"),
        sourceRows: z.literal(5_067),
        zeroValues: z.literal(19),
      }).strict(),
    ]),
    dimensionRows: z.literal(5_067),
    sourceRows: z.literal(20_268),
    zeroValues: z.literal(3_880),
  }).strict(),
  datasetId: z.literal("rgs-state-budget-territorial-2023"),
  dimensions: z.object({
    categories: z.array(nonEmptyText).length(17),
    measures: z.tuple([
      measureSchema.extend({
        additiveWithinOneTerritoryLevel: z.literal(true),
        denominatorStatus: z.literal("not_applicable"),
        label: z.literal("Spesa Complessiva - Valori Assoluti (mln)"),
        publishedUnit: z.literal("million_eur"),
        storageUnit: z.literal("hundredths_of_million_eur"),
      }),
      measureSchema.extend({
        additiveWithinOneTerritoryLevel: z.literal(false),
        denominatorStatus: z.literal("publisher_derived_not_versioned"),
        label: z.literal("Spesa Complessiva - in rapporto al PIL (%)"),
        publishedUnit: z.literal("percent_of_gdp"),
        storageUnit: z.literal("hundredths_of_percent"),
      }),
      measureSchema.extend({
        additiveWithinOneTerritoryLevel: z.literal(false),
        denominatorStatus: z.literal("publisher_derived_not_versioned"),
        label: z.literal("Spesa Complessiva - per abitante (Euro)"),
        publishedUnit: z.literal("eur_per_inhabitant"),
        storageUnit: z.literal("hundredths_of_eur_per_inhabitant"),
      }),
      measureSchema.extend({
        additiveWithinOneTerritoryLevel: z.literal(false),
        denominatorStatus: z.literal("publisher_derived_not_versioned"),
        label: z.literal("Spesa Complessiva - per Kmq (Euro)"),
        publishedUnit: z.literal("eur_per_square_kilometre"),
        storageUnit: z.literal("hundredths_of_eur_per_square_kilometre"),
      }),
    ]),
    missions: z.array(nonEmptyText).length(33),
    territories: z.array(z.object({
      label: nonEmptyText,
      level: z.union([z.literal("national"), z.literal("macroarea"), z.literal("region")]),
    }).strict()).length(26),
    titles: z.tuple([
      z.literal("TITOLO I - SPESE CORRENTI"),
      z.literal("TITOLO II - SPESE IN CONTO CAPITALE"),
    ]),
  }).strict(),
  generatedAt: z.literal("2026-08-22T00:00:00Z"),
  grain: z.literal("Una riga per territorio, titolo, categoria e missione; quattro misure sorgente separate e ordinate."),
  methodology: z.object({
    scope: z.literal("La landing ufficiale descrive il dataset come spesa territorializzata del Bilancio dello Stato al netto degli interessi sul debito pubblico. La trasformazione conserva tutte le righe pubblicate e non applica filtri per categoria o missione."),
    storage: z.literal("Le dimensioni sorgente sono dizionari ordinati; gli interi nelle righe sono indici di storage, non codici ufficiali."),
    transformation: z.literal("Ogni importo decimale è convertito senza float in un intero pari a cento volte il valore pubblicato; l'unità resta quella dichiarata per ciascuna misura."),
    validation: z.literal("Il validatore semantico controlla tipi, domini e riconciliazioni; il comando --check ricostruisce invece lo snapshot dalla fonte hash-pinned e richiede uguaglianza byte per byte."),
  }).strict(),
  reconciliation: z.object({
    completeMacroareaKeys: z.literal(192),
    completeRegionKeys: z.literal(82),
    macroareaDeltaHundredthsMillionEur: z.literal(-4),
    macroareasHundredthsMillionEur: z.literal(29_735_164),
    maxMacroareaKeyAbsDeltaHundredthsMillionEur: z.literal(2),
    maxRegionKeyAbsDeltaHundredthsMillionEur: z.literal(3),
    nationalHundredthsMillionEur: z.literal(29_735_168),
    regionDeltaHundredthsMillionEur: z.literal(-9),
    regionsHundredthsMillionEur: z.literal(29_735_159),
  }).strict(),
  rows: z.array(territorialRowSchema).length(5_067),
  schemaVersion: z.literal(1),
  source: z.object({
    createdAt: z.literal("2025-11-21"),
    csvUrl: z.literal("https://bdap-opendata.rgs.mef.gov.it/export/csv/2023---Distribuzione-territoriale-della-spesa-del-bilancio-dello-Stato---Spesa-Statale-Regionalizzata.csv"),
    dataObservedAt: z.literal("2025-09-03"),
    delimiter: z.literal(";"),
    downloadObservedAt: z.literal("2026-08-22"),
    encoding: z.literal("cp1252"),
    landingUrl: z.literal("https://bdap-opendata.rgs.mef.gov.it/content/2023-distribuzione-territoriale-della-spesa-del-bilancio-dello-stato-spesa-statale?metadati=showall"),
    licenseStatus: z.literal("not_declared"),
    lineEnding: z.literal("CRLF"),
    publisher: z.literal("Ragioneria Generale dello Stato"),
    quoteChar: z.literal("\""),
    recordId: z.literal("SRS_SPE_BIL_SPESR_001"),
    recordNumber: z.literal(33_477),
    reportNumber: z.literal(5_318),
    schemaUrl: z.literal("https://bdap-opendata.rgs.mef.gov.it/sites/default/files/metadata_updfile/report/5318_Spesa%20Statale%20Regionalizzata%20-%20Bilancio.pdf"),
    sourceBytes: z.literal(3_933_609),
    sourceSha256: z.literal("bf37c613ea9d467a95618684b0cd69cf332e276792e67e6c985358173b01cf16"),
    updatedAt: z.literal("2025-11-25"),
    uuid: z.literal("6e4f0ada-f0f6-4122-ba4a-350818773daf@rgs"),
    year: z.literal(2023),
  }).strict(),
  title: z.literal("Spesa del Bilancio dello Stato per territorio destinatario"),
  year: z.literal(2023),
}).strict();

export type RgsTerritorialSnapshot = z.infer<typeof rgsTerritorialSnapshotSchema>;
export type RgsTerritorialRow = z.infer<typeof territorialRowSchema>;
export type RgsTerritoryLevel = RgsTerritorialSnapshot["dimensions"]["territories"][number]["level"];

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot RGS territoriale non valido: ${message}`);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateRgsTerritorialSnapshot(value: unknown): RgsTerritorialSnapshot {
  const snapshot = rgsTerritorialSnapshotSchema.parse(value);
  invariant(unique(snapshot.dimensions.categories), "categorie duplicate");
  invariant(unique(snapshot.dimensions.missions), "missioni duplicate");
  invariant(unique(snapshot.dimensions.territories.map((territory) => territory.label)), "territori duplicati");

  const levels = snapshot.dimensions.territories.reduce(
    (counts, territory) => ({ ...counts, [territory.level]: counts[territory.level] + 1 }),
    { national: 0, macroarea: 0, region: 0 },
  );
  invariant(levels.national === 1 && levels.macroarea === 5 && levels.region === 20, "livelli territoriali inattesi");
  invariant(
    snapshot.dimensions.territories.some((territory) => territory.label === "ITALIA" && territory.level === "national"),
    "livello nazionale ITALIA mancante",
  );

  const keys = new Set<string>();
  const zeros = [0, 0, 0, 0];
  const levelTotals = { national: 0, macroarea: 0, region: 0 };
  let debtInterestValue = 0;

  for (const row of snapshot.rows) {
    invariant(row.category < snapshot.dimensions.categories.length, "indice categoria fuori dominio");
    invariant(row.mission < snapshot.dimensions.missions.length, "indice missione fuori dominio");
    invariant(row.territory < snapshot.dimensions.territories.length, "indice territorio fuori dominio");
    invariant(row.title < snapshot.dimensions.titles.length, "indice titolo fuori dominio");
    const key = `${row.territory}:${row.title}:${row.category}:${row.mission}`;
    invariant(!keys.has(key), `combinazione dimensionale duplicata: ${key}`);
    keys.add(key);
    row.values.forEach((amount, index) => {
      if (amount === 0) zeros[index] += 1;
    });
    const territory = snapshot.dimensions.territories[row.territory];
    levelTotals[territory.level] += row.values[0];
    if (
      territory.label === "ITALIA" &&
      snapshot.dimensions.categories[row.category].startsWith("09-") &&
      snapshot.dimensions.missions[row.mission].startsWith("034-")
    ) {
      debtInterestValue += row.values[0];
    }
  }

  invariant(snapshot.coverage.sourceRows === snapshot.rows.length * 4, "conteggio misure sorgente non riconciliato");
  invariant(
    snapshot.coverage.byMeasure.every((measure, index) =>
      measure.label === snapshot.dimensions.measures[index].label &&
      measure.sourceRows === snapshot.rows.length &&
      measure.zeroValues === zeros[index]),
    "copertura per misura non riconciliata",
  );
  invariant(zeros.reduce((sum, count) => sum + count, 0) === snapshot.coverage.zeroValues, "zeri osservati non riconciliati");
  invariant(levelTotals.national === snapshot.reconciliation.nationalHundredthsMillionEur, "totale nazionale non riconciliato");
  invariant(levelTotals.macroarea === snapshot.reconciliation.macroareasHundredthsMillionEur, "macroaree non riconciliate");
  invariant(levelTotals.region === snapshot.reconciliation.regionsHundredthsMillionEur, "regioni non riconciliate");
  invariant(
    levelTotals.macroarea - levelTotals.national === snapshot.reconciliation.macroareaDeltaHundredthsMillionEur &&
      levelTotals.region - levelTotals.national === snapshot.reconciliation.regionDeltaHundredthsMillionEur,
    "scarti territoriali non riconciliati",
  );
  invariant(debtInterestValue === 805_770, "avvertenza interessi/debito non riconciliata");

  return snapshot;
}
