export const SSN_CCE_DATASET_ID = "spd_ssn_cce_elb_voccn_01_2024" as const;
export const SSN_CCE_REFERENCE_YEAR = 2024 as const;
export const SSN_CCE_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export const SSN_CCE_METRICS = [
  "productionCosts",
  "personnelCost",
  "healthcareWorkServices",
  "nonHealthcareWorkServices",
  "purchasedServices",
] as const;

export type SsnCceMetricId = (typeof SSN_CCE_METRICS)[number];
export type SsnCceValues = Record<SsnCceMetricId, number>;
export type SsnCceMissing = Record<SsnCceMetricId, number>;

export type SsnCceMetric = {
  id: SsnCceMetricId;
  code: string;
  label: string;
  meaning: string;
};

export type SsnCceEntity = {
  id: string;
  regionCode: string;
  region: string;
  codeBdap: string;
  codeSsn: string;
  name: string;
  values: SsnCceValues;
  missing: SsnCceMissing;
};

export type SsnCceRegion = {
  code: string;
  name: string;
  detailEntityCount: number;
  values: SsnCceValues;
  detailMissing: SsnCceMissing;
};

export type SsnCceEntityDataset = {
  datasetId: string;
  landingUrl: string;
  csvUrl: string;
  odataUrl: string;
  encoding: "UTF-8";
  delimiter: ";";
  quote: '"';
  lineEnding: "CRLF";
  columns: string[];
  expectedRows: number;
  expectedEntities: number;
  expectedExposedEntities: number;
  expectedAggregateEntities: number;
  expectedRegions: number;
  expectedVoices: number;
  sourceBytes: number;
  sourceSha256: string;
};

export type SsnCceODataDataset = {
  datasetId: string;
  landingUrl: string;
  odataUrl: string;
  properties: string[];
  expectedRows: number;
  expectedRegions?: number;
  sourceBytes: number;
  sourceSha256: string;
};

export type SsnCceSource = {
  owner: string;
  publisher: string;
  title: string;
  catalogUrl: string;
  landingUrl: string;
  license: string;
  licenseId: "cc-by";
  licenseVersion: "3.0 Unported";
  licenseUrl: string;
  rightsHolder: string;
  catalogMetadataCreated: string;
  catalogMetadataModified: string;
  landingPageUpdatedAt: string;
  dataObservedAt: string;
  datasets: {
    entities: SsnCceEntityDataset;
    national: SsnCceODataDataset;
    regional: SsnCceODataDataset;
  };
};

export type SsnCceSnapshot = {
  schemaVersion: typeof SSN_CCE_SNAPSHOT_SCHEMA_VERSION;
  datasetId: typeof SSN_CCE_DATASET_ID;
  generatedAt: string;
  referenceYear: typeof SSN_CCE_REFERENCE_YEAR;
  observation: {
    type: "CONSUNTIVO";
    accountingBasis: string;
    observedAt: string;
    publishedAt: string;
  };
  metrics: SsnCceMetric[];
  national: {
    values: SsnCceValues;
  };
  detailCoverage: {
    entityCount: number;
    present: SsnCceMissing;
    missing: SsnCceMissing;
  };
  regions: SsnCceRegion[];
  entities: SsnCceEntity[];
  coverage: {
    sourceRows: number;
    entities: number;
    aggregateEntities: number;
    regions: number;
    voices: number;
    nationalRows: number;
    regionalRows: number;
    updatedAtMin: string;
    updatedAtMax: string;
    officialUpdatedAtMin: string;
    officialUpdatedAtMax: string;
  };
  reconciliation: {
    nationalEqualsRegions: true;
    regionalMatchesEntityAggregateRows: true;
    nationalRegionalDifferenceCents: SsnCceValues;
    entityMetricRowCounts: SsnCceMissing;
    aggregateEntityMetricRowCounts: SsnCceMissing;
    accounting: string;
  };
  source: SsnCceSource;
  methodology: {
    definitions: string;
    comparability: string;
    interpretation: string;
    externalStaffBoundary: string;
    geography: string;
    amountUnit: string;
  };
};

const METRIC_CODES: Record<SsnCceMetricId, string> = {
  productionCosts: "BZ9999",
  personnelCost: "BA2080",
  healthcareWorkServices: "BA1350",
  nonHealthcareWorkServices: "BA1750",
  purchasedServices: "BA0390",
};

const METRIC_LABELS: Record<SsnCceMetricId, string> = {
  productionCosts: "Totale costi della produzione (B)",
  personnelCost: "Totale Costo del personale",
  healthcareWorkServices:
    "B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie",
  nonHealthcareWorkServices:
    "B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie",
  purchasedServices: "B.2) Acquisti di servizi",
};

const EXPECTED_NATIONAL_VALUES: SsnCceValues = {
  productionCosts: 14_919_584_274_769,
  personnelCost: 4_037_827_491_649,
  healthcareWorkServices: 184_360_514_664,
  nonHealthcareWorkServices: 23_628_458_264,
  purchasedServices: 6_626_162_783_206,
};

const EXPECTED_EXTERNAL_STAFF_BOUNDARY =
  "La fonte non usa le categorie colloquiali gettonisti o cooperative. Il portale conserva e mostra la nomenclatura ufficiale senza trasformarla in una classificazione contrattuale.";

const EXPECTED_SOURCE_DATASETS = {
  entities: {
    datasetId: SSN_CCE_DATASET_ID,
    landingUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn",
    csvUrl: "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/94083af2-a542-482d-8ad6-5877d04cd1ca.csv",
    odataUrl: "https://bdap-opendata.rgs.mef.gov.it/ODataProxy/MdData('446bba56-fea9-4bb5-aee6-ce5c91dc5854@rgs')/DataRows",
    sourceBytes: 15_636_428,
    sourceSha256: "a3e2ed4e42f4c7ae4f6147aaf4b9b2145176b4ba71f281aaba247b90cbff5c56",
    expectedRows: 76_124,
    expectedEntities: 253,
    expectedExposedEntities: 232,
    expectedAggregateEntities: 21,
    expectedRegions: 21,
    expectedVoices: 554,
  },
  national: {
    datasetId: "SSN_CCE_NAZ_VOCCN_001",
    landingUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn-livello-nazionale",
    odataUrl: "https://bdap-opendata.rgs.mef.gov.it/ODataProxy/MdData('4b3d92d0-77ec-413a-ab0c-ae431c217474@rgs')/DataRows?%24top=5&%24filter=Cccodice_voce_c1597042508%20eq%20%27BZ9999%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA2080%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA1350%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA1750%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA0390%27&%24orderby=Cccodice_voce_c1597042508",
    properties: ["row_id", "Ccanno_di_rifer2017547080", "Cccodice_voce_c1597042508", "Ccdescrizione_vo915899106", "Ccdata_aggiorna2057202945", "Ccimporto_total1317737785"],
    expectedRows: 5,
    sourceBytes: 2_507,
    sourceSha256: "13099a8df2f52eb1aa7383036a7ed9ecc3ad21cb8de5cc9e9b75aeda6ab5e20a",
  },
  regional: {
    datasetId: "SSN_CCE_REG_VOCCN_001",
    landingUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn-livello-regionale",
    odataUrl: "https://bdap-opendata.rgs.mef.gov.it/ODataProxy/MdData('8e06c6e5-f5ab-4a3c-b192-79b5447109d7@rgs')/DataRows?%24top=105&%24filter=Cccodice_voce_c1597042508%20eq%20%27BZ9999%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA2080%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA1350%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA1750%27%20or%20Cccodice_voce_c1597042508%20eq%20%27BA0390%27&%24orderby=Cccodice_region1532212456%2CCccodice_voce_c1597042508",
    properties: ["row_id", "Ccanno_di_rifer2017547080", "Cccodice_region1532212456", "Ccdescrizione_r1013517246", "Cccodice_voce_c1597042508", "Ccdescrizione_vo915899106", "Ccdata_aggiorna2057202945", "Ccimporto_total1317737785"],
    expectedRows: 105,
    expectedRegions: 21,
    sourceBytes: 60_028,
    sourceSha256: "61ffcc7d55e106ac03c19c7117b835b5b746432d0964aa291bcd2d9b1630b05f",
  },
} as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot SSN conto economico non valido: ${message}`);
}

function nonEmptyText(value: unknown, label: string): asserts value is string {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} mancante`);
}

function isoDate(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(value), `${label} non valida`);
}

function safeInteger(value: unknown, label: string): asserts value is number {
  invariant(Number.isSafeInteger(value), `${label} non è un intero sicuro`);
}

function metricValues(value: unknown, label: string): asserts value is SsnCceValues {
  invariant(value !== null && typeof value === "object", `${label} non è un oggetto`);
  const record = value as Record<string, unknown>;
  invariant(Object.keys(record).sort().join(",") === [...SSN_CCE_METRICS].sort().join(","), `${label} ha metriche inattese`);
  for (const metric of SSN_CCE_METRICS) {
    safeInteger(record[metric], `${label}.${metric}`);
    invariant(Math.abs(record[metric] as number) <= Number.MAX_SAFE_INTEGER, `${label}.${metric} fuori intervallo`);
  }
}

function missingValues(value: unknown, label: string): asserts value is SsnCceMissing {
  metricValues(value, label);
  for (const metric of SSN_CCE_METRICS) {
    invariant((value as SsnCceMissing)[metric] >= 0, `${label}.${metric} negativo`);
  }
}

export function validateSsnCceSnapshot(value: SsnCceSnapshot): SsnCceSnapshot {
  invariant(value.schemaVersion === SSN_CCE_SNAPSHOT_SCHEMA_VERSION, "schemaVersion non supportata");
  invariant(value.datasetId === SSN_CCE_DATASET_ID, "datasetId inatteso");
  invariant(value.referenceYear === SSN_CCE_REFERENCE_YEAR, "anno di riferimento inatteso");
  isoDate(value.generatedAt, "generatedAt");
  invariant(value.observation.type === "CONSUNTIVO", "tipo di rilevazione inatteso");
  isoDate(value.observation.observedAt, "observation.observedAt");
  isoDate(value.observation.publishedAt, "observation.publishedAt");
  nonEmptyText(value.observation.accountingBasis, "observation.accountingBasis");

  invariant(value.metrics.length === SSN_CCE_METRICS.length, "numero metriche inatteso");
  value.metrics.forEach((metric, index) => {
    invariant(metric.id === SSN_CCE_METRICS[index], `ordine metriche inatteso alla posizione ${index}`);
    invariant(metric.code === METRIC_CODES[metric.id], `codice metrica inatteso: ${metric.id}`);
    invariant(metric.label === METRIC_LABELS[metric.id], `label metrica inattesa: ${metric.id}`);
    nonEmptyText(metric.label, `label metrica ${metric.id}`);
    nonEmptyText(metric.meaning, `meaning metrica ${metric.id}`);
  });

  metricValues(value.national.values, "national.values");
  safeInteger(value.detailCoverage.entityCount, "detailCoverage.entityCount");
  invariant(value.detailCoverage.entityCount === 232, "detailCoverage.entityCount inatteso");
  missingValues(value.detailCoverage.present, "detailCoverage.present");
  missingValues(value.detailCoverage.missing, "detailCoverage.missing");
  for (const metric of SSN_CCE_METRICS) {
    invariant(value.national.values[metric] === EXPECTED_NATIONAL_VALUES[metric], `totale nazionale inatteso: ${metric}`);
    invariant(value.detailCoverage.present[metric] + value.detailCoverage.missing[metric] === value.detailCoverage.entityCount, `copertura dettaglio non riconciliata: ${metric}`);
  }

  const entityIds = new Set<string>();
  for (const entity of value.entities) {
    nonEmptyText(entity.id, "id ente");
    invariant(!entityIds.has(entity.id), `ente duplicato: ${entity.id}`);
    entityIds.add(entity.id);
    nonEmptyText(entity.regionCode, `codice regione ente ${entity.id}`);
    nonEmptyText(entity.region, `regione ente ${entity.id}`);
    nonEmptyText(entity.codeBdap, `codice BDAP ente ${entity.id}`);
    nonEmptyText(entity.codeSsn, `codice SSN ente ${entity.id}`);
    invariant(entity.codeSsn !== "999", `ente aggregate codeSsn=999 esposto: ${entity.id}`);
    nonEmptyText(entity.name, `nome ente ${entity.id}`);
    invariant(entity.id === `${entity.regionCode}:${entity.codeBdap}:${entity.codeSsn}`, `id ente non canonico: ${entity.id}`);
    metricValues(entity.values, `values ente ${entity.id}`);
    missingValues(entity.missing, `missing ente ${entity.id}`);
    for (const metric of SSN_CCE_METRICS) invariant(entity.missing[metric] === 0 || entity.missing[metric] === 1, `missing ente non binario: ${entity.id}/${metric}`);
  }
  invariant(entityIds.size === 232, "numero enti di dettaglio inatteso");

  const regionCodes = new Set<string>();
  for (const region of value.regions) {
    nonEmptyText(region.code, "codice regione");
    invariant(!regionCodes.has(region.code), `regione duplicata: ${region.code}`);
    regionCodes.add(region.code);
    nonEmptyText(region.name, `nome regione ${region.code}`);
    safeInteger(region.detailEntityCount, `detailEntityCount regione ${region.code}`);
    invariant(region.detailEntityCount > 0, `regione vuota: ${region.code}`);
    metricValues(region.values, `values regione ${region.code}`);
    missingValues(region.detailMissing, `detailMissing regione ${region.code}`);
    for (const metric of SSN_CCE_METRICS) invariant(region.detailMissing[metric] >= 0 && region.detailMissing[metric] <= region.detailEntityCount, `missing regione fuori intervallo: ${region.code}/${metric}`);
  }
  invariant(regionCodes.size === 21, "numero Regioni inatteso");

  invariant(value.entities.length === value.detailCoverage.entityCount, "entityCount dettaglio non riconciliato");
  invariant(value.coverage.entities === 232, "coverage.entities non riconciliata");
  invariant(value.coverage.aggregateEntities === 21, "coverage.aggregateEntities non riconciliata");
  invariant(value.coverage.regions === 21, "coverage.regions non riconciliata");
  safeInteger(value.coverage.sourceRows, "coverage.sourceRows");
  safeInteger(value.coverage.voices, "coverage.voices");
  invariant(value.coverage.sourceRows === 76_124 && value.coverage.voices === 554, "coverage fonte inattesa");
  invariant(value.coverage.nationalRows === 5 && value.coverage.regionalRows === 105, "coverage OData inattesa");
  isoDate(value.coverage.updatedAtMin, "coverage.updatedAtMin");
  isoDate(value.coverage.updatedAtMax, "coverage.updatedAtMax");
  isoDate(value.coverage.officialUpdatedAtMin, "coverage.officialUpdatedAtMin");
  isoDate(value.coverage.officialUpdatedAtMax, "coverage.officialUpdatedAtMax");

  for (const metric of SSN_CCE_METRICS) {
    const regionTotal = value.regions.reduce((total, region) => total + region.values[metric], 0);
    invariant(regionTotal === value.national.values[metric], `somma regioni non riconciliata: ${metric}`);
    invariant(value.reconciliation.nationalRegionalDifferenceCents[metric] === value.national.values[metric] - regionTotal, `differenza nazionale/Regioni inattesa: ${metric}`);
    invariant(value.reconciliation.nationalRegionalDifferenceCents[metric] === 0, `nazionale e Regioni non riconciliati: ${metric}`);
    invariant(value.reconciliation.entityMetricRowCounts[metric] + value.detailCoverage.missing[metric] === 232, `conteggio dettaglio inatteso: ${metric}`);
    invariant(value.reconciliation.aggregateEntityMetricRowCounts[metric] === 21, `conteggio aggregati inatteso: ${metric}`);
  }
  invariant(value.reconciliation.nationalEqualsRegions === true, "flag regioni non riconciliato");
  invariant(value.reconciliation.regionalMatchesEntityAggregateRows === true, "flag codeSsn=999/Regioni non riconciliato");
  metricValues(value.reconciliation.nationalRegionalDifferenceCents, "nationalRegionalDifferenceCents");
  missingValues(value.reconciliation.entityMetricRowCounts, "reconciliation.entityMetricRowCounts");
  missingValues(value.reconciliation.aggregateEntityMetricRowCounts, "reconciliation.aggregateEntityMetricRowCounts");
  nonEmptyText(value.reconciliation.accounting, "reconciliation.accounting");

  const source = value.source;
  for (const key of ["owner", "publisher", "title", "catalogUrl", "landingUrl", "license", "licenseId", "licenseUrl", "rightsHolder", "catalogMetadataCreated", "catalogMetadataModified", "landingPageUpdatedAt", "dataObservedAt"] as const) nonEmptyText(source[key], `source.${key}`);
  for (const key of ["catalogUrl", "landingUrl"] as const) invariant(source[key].startsWith("https://bdap-opendata.rgs.mef.gov.it/"), `URL fonte non ufficiale: ${key}`);
  isoDate(source.catalogMetadataCreated, "source.catalogMetadataCreated");
  isoDate(source.catalogMetadataModified, "source.catalogMetadataModified");
  isoDate(source.landingPageUpdatedAt, "source.landingPageUpdatedAt");
  isoDate(source.dataObservedAt, "source.dataObservedAt");
  invariant(source.licenseUrl === "https://creativecommons.org/licenses/by/3.0/", "licenza inattesa");
  invariant(source.licenseId === "cc-by" && source.license === "Creative Commons Attribution" && source.licenseVersion === "3.0 Unported", "metadati licenza inattesi");
  const sourceDatasets = source.datasets;
  invariant(sourceDatasets !== null && typeof sourceDatasets === "object", "source.datasets mancante");
  const entitiesSource = sourceDatasets.entities;
  invariant(entitiesSource.datasetId === EXPECTED_SOURCE_DATASETS.entities.datasetId && entitiesSource.landingUrl === EXPECTED_SOURCE_DATASETS.entities.landingUrl && entitiesSource.csvUrl === EXPECTED_SOURCE_DATASETS.entities.csvUrl && entitiesSource.odataUrl === EXPECTED_SOURCE_DATASETS.entities.odataUrl, "provenienza enti inattesa");
  invariant(entitiesSource.sourceBytes === EXPECTED_SOURCE_DATASETS.entities.sourceBytes && entitiesSource.sourceSha256 === EXPECTED_SOURCE_DATASETS.entities.sourceSha256 && entitiesSource.expectedRows === EXPECTED_SOURCE_DATASETS.entities.expectedRows && entitiesSource.expectedExposedEntities === 232 && entitiesSource.expectedAggregateEntities === 21, "integrità dataset enti inattesa");
  invariant(entitiesSource.encoding === "UTF-8" && entitiesSource.delimiter === ";" && entitiesSource.quote === '"' && entitiesSource.lineEnding === "CRLF" && entitiesSource.columns.length === 11, "schema dataset enti inatteso");
  for (const name of ["national", "regional"] as const) {
    const dataset = sourceDatasets[name];
    const expected = EXPECTED_SOURCE_DATASETS[name];
    invariant(dataset.datasetId === expected.datasetId && dataset.landingUrl === expected.landingUrl && dataset.odataUrl === expected.odataUrl, `provenienza OData inattesa: ${name}`);
    invariant(dataset.sourceBytes === expected.sourceBytes && dataset.sourceSha256 === expected.sourceSha256 && dataset.expectedRows === expected.expectedRows, `integrità OData inattesa: ${name}`);
    invariant(dataset.properties.length === expected.properties.length && dataset.properties.every((property, index) => property === expected.properties[index]), `schema OData inatteso: ${name}`);
    if (name === "regional") invariant(dataset.expectedRegions === 21, "numero Regioni OData inatteso");
  }
  for (const key of ["definitions", "comparability", "interpretation", "externalStaffBoundary", "geography", "amountUnit"] as const) nonEmptyText(value.methodology[key], `methodology.${key}`);
  invariant(
    value.methodology.externalStaffBoundary === EXPECTED_EXTERNAL_STAFF_BOUNDARY,
    "limite semantico personale esterno divergente",
  );

  return value;
}
