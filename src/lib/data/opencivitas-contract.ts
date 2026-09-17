const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const LANDING_URL = "https://www.opencivitas.it/it/open-data";
const DATASET_URL =
  "https://www.opencivitas.it/it/dataset/2022-comuni-servizi-totali-indicatori-e-determinanti";
const DATA_URL = "https://docs.opencivitas.it/2022_Ind_FC80TOT_2_csv.zip";
const ENTITIES_URL = "https://docs.opencivitas.it/Metadati_Enti_2022_xlsx.zip";
const INDICATORS_URL =
  "https://docs.opencivitas.it/2022_Metadati_Ind_FC80TOT_1_xlsx.zip";
const EXPECTED_MUNICIPALITIES = 6_557;
const MUNICIPALITY_COLUMNS = [
  "istatCode",
  "name",
  "province",
  "region",
  "historicalSpendingCents",
  "standardSpendingCents",
  "differenceCents",
  "historicalPerCapitaCents",
  "standardPerCapitaCents",
  "differencePerCapitaCents",
  "differenceBasisPoints",
  "serviceDifferenceBasisPoints",
  "spendingLevel",
  "serviceLevel",
  "spendingAssessmentReason",
  "servicesAssessmentReason",
  "sourceWarnings",
] as const;

export type OpenCivitasMunicipality = {
  istatCode: string;
  name: string;
  province: string;
  region: string;
  historicalSpendingCents: number;
  standardSpendingCents: number;
  differenceCents: number;
  historicalPerCapitaCents: number;
  standardPerCapitaCents: number;
  differencePerCapitaCents: number;
  differenceBasisPoints: number;
  serviceDifferenceBasisPoints: number | null;
  spendingLevel: number | null;
  serviceLevel: number | null;
  spendingAssessmentReason: string | null;
  servicesAssessmentReason: string | null;
  sourceWarnings: string[];
};

export type OpenCivitasSnapshot = {
  schemaVersion: 1;
  transformVersion: 1;
  scope: "ordinary-statute-municipalities-total-services";
  referenceYear: 2022;
  publishedAt: string;
  generatedAt: string;
  coverage: {
    municipalities: number;
    regions: number;
    regionNames: string[];
    territorialScope: string;
  };
  municipalities: OpenCivitasMunicipality[];
  source: {
    owner: string;
    dataset: string;
    landingUrl: string;
    datasetUrl: string;
    dataUrl: string;
    entitiesUrl: string;
    indicatorsUrl: string;
    license: string;
    licenseUrl: string;
    observedAt: string;
    declaredCadence: string;
    platformCheckCadence: string;
  };
  methodology: {
    differenceMeaning: string;
    serviceMeaning: string;
    coverageWarning: string;
    rankingWarning: string;
  };
};

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}: testo non vuoto atteso`);
  }
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function integer(value: unknown, field: string, minimum = -MAX_SAFE_INTEGER, maximum = MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field}: intero sicuro fuori intervallo`);
  }
  return value as number;
}

function nullableInteger(value: unknown, field: string, minimum: number, maximum: number): number | null {
  if (value === null) return null;
  return integer(value, field, minimum, maximum);
}

function exactUrl(value: unknown, field: string, expected: string): string {
  const result = text(value, field);
  if (result !== expected) throw new Error(`${field}: URL ufficiale inatteso`);
  return result;
}

function exactText(value: unknown, field: string, expected: string): string {
  const result = text(value, field);
  if (result !== expected) throw new Error(`${field}: valore inatteso`);
  return result;
}

function isoTimestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(new Date(result).getTime())) throw new Error(`${field}: timestamp ISO non valido`);
  return result;
}

function municipality(value: unknown, index: number): OpenCivitasMunicipality {
  const field = `snapshot.municipalities[${index}]`;
  const record = object(value, field);
  const istatCode = text(record.istatCode, `${field}.istatCode`);
  if (!/^\d{6}$/.test(istatCode)) throw new Error(`${field}.istatCode: sei cifre attese`);
  const historicalSpendingCents = integer(record.historicalSpendingCents, `${field}.historicalSpendingCents`, 0);
  const standardSpendingCents = integer(record.standardSpendingCents, `${field}.standardSpendingCents`, 1);
  const differenceCents = integer(record.differenceCents, `${field}.differenceCents`);
  if (differenceCents !== historicalSpendingCents - standardSpendingCents) {
    throw new Error(`${field}: differenza totale non riconciliata`);
  }
  const historicalPerCapitaCents = integer(record.historicalPerCapitaCents, `${field}.historicalPerCapitaCents`, 0);
  const standardPerCapitaCents = integer(record.standardPerCapitaCents, `${field}.standardPerCapitaCents`, 1);
  const differencePerCapitaCents = integer(record.differencePerCapitaCents, `${field}.differencePerCapitaCents`);
  if (differencePerCapitaCents !== historicalPerCapitaCents - standardPerCapitaCents) {
    throw new Error(`${field}: differenza per abitante non riconciliata`);
  }
  if (!Array.isArray(record.sourceWarnings) || record.sourceWarnings.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field}.sourceWarnings: elenco di testi atteso`);
  }
  return {
    istatCode,
    name: text(record.name, `${field}.name`),
    province: text(record.province, `${field}.province`),
    region: text(record.region, `${field}.region`),
    historicalSpendingCents,
    standardSpendingCents,
    differenceCents,
    historicalPerCapitaCents,
    standardPerCapitaCents,
    differencePerCapitaCents,
    differenceBasisPoints: integer(record.differenceBasisPoints, `${field}.differenceBasisPoints`, -1_000_000, 1_000_000),
    serviceDifferenceBasisPoints: nullableInteger(record.serviceDifferenceBasisPoints, `${field}.serviceDifferenceBasisPoints`, -1_000_000, 1_000_000),
    spendingLevel: nullableInteger(record.spendingLevel, `${field}.spendingLevel`, 0, 10),
    serviceLevel: nullableInteger(record.serviceLevel, `${field}.serviceLevel`, 0, 10),
    spendingAssessmentReason: nullableText(record.spendingAssessmentReason, `${field}.spendingAssessmentReason`),
    servicesAssessmentReason: nullableText(record.servicesAssessmentReason, `${field}.servicesAssessmentReason`),
    sourceWarnings: [...record.sourceWarnings] as string[],
  };
}

export function assertOpenCivitasSnapshot(value: unknown): OpenCivitasSnapshot {
  const record = object(value, "snapshot");
  if (record.schemaVersion !== 1 || record.transformVersion !== 1) {
    throw new Error("snapshot: versione 1 attesa");
  }
  if (record.scope !== "ordinary-statute-municipalities-total-services") {
    throw new Error("snapshot.scope non valido");
  }
  if (record.referenceYear !== 2022) throw new Error("snapshot.referenceYear: 2022 atteso");
  if (
    !Array.isArray(record.municipalityColumns) ||
    record.municipalityColumns.length !== MUNICIPALITY_COLUMNS.length ||
    record.municipalityColumns.some((column, index) => column !== MUNICIPALITY_COLUMNS[index])
  ) {
    throw new Error("snapshot.municipalityColumns: colonne inattese");
  }
  const municipalities = Array.isArray(record.municipalityRows)
    ? record.municipalityRows.map((row, index) => {
        if (!Array.isArray(row) || row.length !== MUNICIPALITY_COLUMNS.length) {
          throw new Error(`snapshot.municipalityRows[${index}]: riga non valida`);
        }
        return municipality(Object.fromEntries(MUNICIPALITY_COLUMNS.map((column, columnIndex) => [column, row[columnIndex]])), index);
      })
    : (() => { throw new Error("snapshot.municipalityRows: elenco atteso"); })();
  if (municipalities.length !== EXPECTED_MUNICIPALITIES) {
    throw new Error("snapshot.municipalities: copertura inattesa");
  }
  const codes = municipalities.map((item) => item.istatCode);
  if (new Set(codes).size !== codes.length || codes.some((code, index) => index > 0 && code <= codes[index - 1])) {
    throw new Error("snapshot.municipalities: codici ISTAT duplicati o non ordinati");
  }
  const coverageRecord = object(record.coverage, "snapshot.coverage");
  const regionNames = Array.isArray(coverageRecord.regionNames)
    ? coverageRecord.regionNames.map((item, index) => text(item, `snapshot.coverage.regionNames[${index}]`))
    : (() => { throw new Error("snapshot.coverage.regionNames: elenco atteso"); })();
  const coverageMunicipalities = integer(coverageRecord.municipalities, "snapshot.coverage.municipalities", 1);
  if (coverageMunicipalities !== municipalities.length) throw new Error("snapshot.coverage: Comuni non riconciliati");
  const distinctRegions = new Set(municipalities.map((item) => item.region));
  const regionCount = integer(coverageRecord.regions, "snapshot.coverage.regions", 1);
  if (regionCount !== distinctRegions.size || regionNames.length !== regionCount) {
    throw new Error("snapshot.coverage: Regioni non riconciliate");
  }
  if (
    regionNames.join("|") !== [...distinctRegions].sort((left, right) => left.localeCompare(right)).join("|")
  ) {
    throw new Error("snapshot.coverage: nomi delle Regioni non riconciliati");
  }
  const generatedAt = isoTimestamp(record.generatedAt, "snapshot.generatedAt");
  const sourceRecord = object(record.source, "snapshot.source");
  const observedAt = isoTimestamp(sourceRecord.observedAt, "snapshot.source.observedAt");
  if (generatedAt !== observedAt) throw new Error("snapshot: generatedAt e observedAt devono coincidere");
  const methodologyRecord = object(record.methodology, "snapshot.methodology");
  return {
    schemaVersion: 1,
    transformVersion: 1,
    scope: "ordinary-statute-municipalities-total-services",
    referenceYear: 2022,
    publishedAt: exactText(record.publishedAt, "snapshot.publishedAt", "2025-08-07"),
    generatedAt,
    coverage: {
      municipalities: coverageMunicipalities,
      regions: regionCount,
      regionNames,
      territorialScope: text(coverageRecord.territorialScope, "snapshot.coverage.territorialScope"),
    },
    municipalities,
    source: {
      owner: text(sourceRecord.owner, "snapshot.source.owner"),
      dataset: text(sourceRecord.dataset, "snapshot.source.dataset"),
      landingUrl: exactUrl(sourceRecord.landingUrl, "snapshot.source.landingUrl", LANDING_URL),
      datasetUrl: exactUrl(sourceRecord.datasetUrl, "snapshot.source.datasetUrl", DATASET_URL),
      dataUrl: exactUrl(sourceRecord.dataUrl, "snapshot.source.dataUrl", DATA_URL),
      entitiesUrl: exactUrl(sourceRecord.entitiesUrl, "snapshot.source.entitiesUrl", ENTITIES_URL),
      indicatorsUrl: exactUrl(sourceRecord.indicatorsUrl, "snapshot.source.indicatorsUrl", INDICATORS_URL),
      license: text(sourceRecord.license, "snapshot.source.license"),
      licenseUrl: exactUrl(sourceRecord.licenseUrl, "snapshot.source.licenseUrl", "https://creativecommons.org/licenses/by/4.0/"),
      observedAt,
      declaredCadence: text(sourceRecord.declaredCadence, "snapshot.source.declaredCadence"),
      platformCheckCadence: text(sourceRecord.platformCheckCadence, "snapshot.source.platformCheckCadence"),
    },
    methodology: {
      differenceMeaning: text(methodologyRecord.differenceMeaning, "snapshot.methodology.differenceMeaning"),
      serviceMeaning: text(methodologyRecord.serviceMeaning, "snapshot.methodology.serviceMeaning"),
      coverageWarning: text(methodologyRecord.coverageWarning, "snapshot.methodology.coverageWarning"),
      rankingWarning: text(methodologyRecord.rankingWarning, "snapshot.methodology.rankingWarning"),
    },
  };
}
