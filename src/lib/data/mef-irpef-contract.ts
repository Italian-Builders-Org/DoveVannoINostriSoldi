export const MEF_IRPEF_DATASET_ID = "mef_irpef_comunale" as const;
export const MEF_IRPEF_TAX_YEAR = 2024 as const;
export const MEF_IRPEF_MEASURE_ORDER = [
  "comprehensiveIncome",
  "taxableIncome",
  "netTaxDeclared",
  "regionalSurtaxDue",
  "municipalSurtaxDue",
] as const;

export type MefIrpefMeasureKey = (typeof MEF_IRPEF_MEASURE_ORDER)[number];

export type MefIrpefPackedMunicipality = readonly [
  istatCode: string,
  cadastralCode: string,
  name: string,
  provinceCode: string,
  provinceAbbreviation: string,
  regionCode: string,
  taxpayers: number,
  comprehensiveIncomeFrequency: number | null,
  comprehensiveIncomeAmountCents: number | null,
  taxableIncomeFrequency: number | null,
  taxableIncomeAmountCents: number | null,
  netTaxDeclaredFrequency: number | null,
  netTaxDeclaredAmountCents: number | null,
  regionalSurtaxDueFrequency: number | null,
  regionalSurtaxDueAmountCents: number | null,
  municipalSurtaxDueFrequency: number | null,
  municipalSurtaxDueAmountCents: number | null,
];

export type MefIrpefAggregateMeasure = readonly [
  knownFrequency: number,
  knownAmountCents: number,
  suppressedRows: number,
];

export type MefIrpefStoredAggregate = Readonly<{
  taxpayers: number;
  measures: readonly MefIrpefAggregateMeasure[];
}>;

export type MefIrpefStoredProvince = MefIrpefStoredAggregate & Readonly<{
  code: string;
  abbreviation: string;
  regionCode: string;
}>;

export type MefIrpefStoredRegion = MefIrpefStoredAggregate & Readonly<{
  code: string;
  name: string;
  sourceNames: readonly string[];
}>;

export type MefIrpefStoredNational = Readonly<{
  assigned: MefIrpefStoredAggregate;
  unassigned: MefIrpefStoredAggregate & Readonly<{ label: "Mancante/errata" }>;
  allSource: MefIrpefStoredAggregate;
}>;

export type MefIrpefSnapshotData = Readonly<{
  schemaVersion: 1;
  datasetId: typeof MEF_IRPEF_DATASET_ID;
  taxYear: typeof MEF_IRPEF_TAX_YEAR;
  measureOrder: typeof MEF_IRPEF_MEASURE_ORDER;
  municipalities: readonly MefIrpefPackedMunicipality[];
  provinces: readonly MefIrpefStoredProvince[];
  regions: readonly MefIrpefStoredRegion[];
  national: MefIrpefStoredNational;
}>;

export type MefIrpefSnapshotMeta = Readonly<{
  schemaVersion: 1;
  datasetId: typeof MEF_IRPEF_DATASET_ID;
  period: Readonly<{
    taxYear: typeof MEF_IRPEF_TAX_YEAR;
    declarationYear: 2025;
    publishedAt: "2026-04-23";
    observedAt: string;
    municipalityAssignmentDateRule: string;
    surtaxDomicileDate: string;
  }>;
  source: Readonly<{
    owner: string;
    landingUrl: string;
    assetUrl: string;
    methodologyUrl: string;
    definitionsUrl: string;
    license: string;
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/it/";
    attribution: string;
    zip: Readonly<{ bytes: number; sha256: string; lastModified: string }>;
    csvMember: Readonly<{ name: string; bytes: number; sha256: string; crc32: string }>;
    methodologyDocument: Readonly<{ bytes: number; sha256: string; lastModified: string }>;
    definitionsDocument: Readonly<{ bytes: number; sha256: string; lastModified: string }>;
    format: Readonly<{
      encoding: string;
      delimiter: string;
      lineEnding: string;
      rawHeaderSha256: string;
      normalizedHeaderSha256: string;
    }>;
  }>;
  coverage: Readonly<{
    sourceRows: 7_897;
    municipalities: 7_896;
    provinces: 107;
    regions: 20;
    unassignedRows: 1;
    taxpayers: Readonly<{
      assigned: number;
      unassigned: number;
      allSource: number;
    }>;
  }>;
  definitions: Readonly<Record<MefIrpefMeasureKey | "taxpayers", string>>;
  methodology: Readonly<{
    municipalityAssignment: string;
    missingValues: string;
    amounts: string;
    aggregation: string;
    semanticWarning: string;
  }>;
  lockSha256: string;
  dataArtifactBytes: number;
  dataArtifactSha256: string;
}>;

export type ValidatedMefIrpefSnapshot = Readonly<{
  meta: MefIrpefSnapshotMeta;
  data: MefIrpefSnapshotData;
}>;

export class MefIrpefContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MefIrpefContractError";
  }
}

type MutableAggregate = {
  taxpayers: number;
  measures: Array<[number, number, number]>;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ISTAT_MUNICIPALITY_PATTERN = /^\d{6}$/;
const ISTAT_PROVINCE_PATTERN = /^\d{3}$/;
const ISTAT_REGION_PATTERN = /^(?:0[1-9]|1\d|20)$/;
const CADASTRAL_PATTERN = /^[A-Z][0-9]{3}$/;
const PROVINCE_ABBREVIATION_PATTERN = /^[A-Z]{2}$/;

function fail(message: string): never {
  throw new MefIrpefContractError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label}: oggetto atteso.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label}: chiavi non conformi (${actual.join(", ")}).`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${label}: stringa non vuota e normalizzata attesa.`);
  }
  return value;
}

function matchingText(value: unknown, pattern: RegExp, label: string): string {
  const parsed = text(value, label);
  if (!pattern.test(parsed)) fail(`${label}: formato non valido.`);
  return parsed;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${label}: intero non negativo sicuro atteso.`);
  }
  return value as number;
}

function cents(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  if (parsed % 100 !== 0) fail(`${label}: il dato MEF deve mantenere la risoluzione di un euro.`);
  return parsed;
}

function sha256(value: unknown, label: string): string {
  return matchingText(value, SHA256_PATTERN, label);
}

function httpsUrl(value: unknown, label: string): string {
  const parsed = text(value, label);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    fail(`${label}: URL non valido.`);
  }
  if (url.protocol !== "https:") fail(`${label}: è richiesto HTTPS.`);
  return parsed;
}

function assertJsonValue(value: unknown, label: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label}: numero JSON non finito.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`));
    return;
  }
  const parsed = record(value, label);
  for (const [key, item] of Object.entries(parsed)) assertJsonValue(item, `${label}.${key}`);
}

function parseMeasureTriple(value: unknown, label: string): MefIrpefAggregateMeasure {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label}: tripla aggregata attesa.`);
  return [
    safeInteger(value[0], `${label}.knownFrequency`),
    cents(value[1], `${label}.knownAmountCents`),
    safeInteger(value[2], `${label}.suppressedRows`),
  ];
}

function parseMeasures(value: unknown, label: string): readonly MefIrpefAggregateMeasure[] {
  if (!Array.isArray(value) || value.length !== MEF_IRPEF_MEASURE_ORDER.length) {
    fail(`${label}: attese esattamente cinque metriche.`);
  }
  return value.map((measure, index) =>
    parseMeasureTriple(measure, `${label}.${MEF_IRPEF_MEASURE_ORDER[index]}`));
}

function parseAggregate(value: unknown, label: string): MefIrpefStoredAggregate {
  const parsed = record(value, label);
  exactKeys(parsed, ["taxpayers", "measures"], label);
  return {
    taxpayers: safeInteger(parsed.taxpayers, `${label}.taxpayers`),
    measures: parseMeasures(parsed.measures, `${label}.measures`),
  };
}

function parseMunicipality(value: unknown, index: number): MefIrpefPackedMunicipality {
  const label = `data.municipalities[${index}]`;
  if (!Array.isArray(value) || value.length !== 17) fail(`${label}: tupla di 17 campi attesa.`);

  const result: unknown[] = [
    matchingText(value[0], ISTAT_MUNICIPALITY_PATTERN, `${label}.istatCode`),
    matchingText(value[1], CADASTRAL_PATTERN, `${label}.cadastralCode`),
    text(value[2], `${label}.name`),
    matchingText(value[3], ISTAT_PROVINCE_PATTERN, `${label}.provinceCode`),
    matchingText(value[4], PROVINCE_ABBREVIATION_PATTERN, `${label}.provinceAbbreviation`),
    matchingText(value[5], ISTAT_REGION_PATTERN, `${label}.regionCode`),
    safeInteger(value[6], `${label}.taxpayers`),
  ];

  for (let metricIndex = 0; metricIndex < MEF_IRPEF_MEASURE_ORDER.length; metricIndex += 1) {
    const frequency = value[7 + metricIndex * 2];
    const amount = value[8 + metricIndex * 2];
    const metricLabel = `${label}.${MEF_IRPEF_MEASURE_ORDER[metricIndex]}`;
    if ((frequency === null) !== (amount === null)) {
      fail(`${metricLabel}: frequenza e importo devono essere entrambi presenti o entrambi oscurati.`);
    }
    if (frequency === null) {
      result.push(null, null);
    } else {
      result.push(
        safeInteger(frequency, `${metricLabel}.frequency`),
        cents(amount, `${metricLabel}.amountCents`),
      );
    }
  }

  if ((result[0] as string).slice(0, 3) !== result[3]) {
    fail(`${label}: il codice provincia non coincide con le prime tre cifre ISTAT.`);
  }
  return result as unknown as MefIrpefPackedMunicipality;
}

function parseProvince(value: unknown, index: number): MefIrpefStoredProvince {
  const label = `data.provinces[${index}]`;
  const parsed = record(value, label);
  exactKeys(parsed, ["code", "abbreviation", "regionCode", "taxpayers", "measures"], label);
  return {
    code: matchingText(parsed.code, ISTAT_PROVINCE_PATTERN, `${label}.code`),
    abbreviation: matchingText(
      parsed.abbreviation,
      PROVINCE_ABBREVIATION_PATTERN,
      `${label}.abbreviation`,
    ),
    regionCode: matchingText(parsed.regionCode, ISTAT_REGION_PATTERN, `${label}.regionCode`),
    taxpayers: safeInteger(parsed.taxpayers, `${label}.taxpayers`),
    measures: parseMeasures(parsed.measures, `${label}.measures`),
  };
}

function parseRegion(value: unknown, index: number): MefIrpefStoredRegion {
  const label = `data.regions[${index}]`;
  const parsed = record(value, label);
  exactKeys(parsed, ["code", "name", "sourceNames", "taxpayers", "measures"], label);
  if (!Array.isArray(parsed.sourceNames) || parsed.sourceNames.length === 0) {
    fail(`${label}.sourceNames: elenco non vuoto atteso.`);
  }
  const sourceNames = parsed.sourceNames.map((item, sourceIndex) =>
    text(item, `${label}.sourceNames[${sourceIndex}]`));
  if (new Set(sourceNames).size !== sourceNames.length) fail(`${label}.sourceNames: duplicati.`);
  return {
    code: matchingText(parsed.code, ISTAT_REGION_PATTERN, `${label}.code`),
    name: text(parsed.name, `${label}.name`),
    sourceNames,
    taxpayers: safeInteger(parsed.taxpayers, `${label}.taxpayers`),
    measures: parseMeasures(parsed.measures, `${label}.measures`),
  };
}

function emptyAggregate(): MutableAggregate {
  return {
    taxpayers: 0,
    measures: MEF_IRPEF_MEASURE_ORDER.map(() => [0, 0, 0]),
  };
}

function addMunicipality(target: MutableAggregate, row: MefIrpefPackedMunicipality) {
  target.taxpayers += row[6];
  if (!Number.isSafeInteger(target.taxpayers)) fail("Riconciliazione contribuenti fuori intervallo sicuro.");
  for (let index = 0; index < MEF_IRPEF_MEASURE_ORDER.length; index += 1) {
    const frequency = row[7 + index * 2] as number | null;
    const amount = row[8 + index * 2] as number | null;
    if (frequency === null || amount === null) {
      target.measures[index][2] += 1;
    } else {
      target.measures[index][0] += frequency;
      target.measures[index][1] += amount;
    }
    if (!target.measures[index].every(Number.isSafeInteger)) {
      fail(`Riconciliazione ${MEF_IRPEF_MEASURE_ORDER[index]} fuori intervallo sicuro.`);
    }
  }
}

function addStoredAggregate(target: MutableAggregate, source: MefIrpefStoredAggregate) {
  target.taxpayers += source.taxpayers;
  source.measures.forEach((measure, index) => {
    target.measures[index][0] += measure[0];
    target.measures[index][1] += measure[1];
    target.measures[index][2] += measure[2];
  });
  if (
    !Number.isSafeInteger(target.taxpayers) ||
    target.measures.some((measure) => !measure.every(Number.isSafeInteger))
  ) {
    fail("Riconciliazione aggregata fuori intervallo sicuro.");
  }
}

function assertAggregateEqual(
  expected: MefIrpefStoredAggregate,
  actual: MutableAggregate,
  label: string,
) {
  if (expected.taxpayers !== actual.taxpayers) fail(`${label}: contribuenti non riconciliati.`);
  expected.measures.forEach((measure, index) => {
    if (measure.some((value, cell) => value !== actual.measures[index][cell])) {
      fail(`${label}: metrica ${MEF_IRPEF_MEASURE_ORDER[index]} non riconciliata.`);
    }
  });
}

function parseMeta(value: unknown): MefIrpefSnapshotMeta {
  const meta = record(value, "meta");
  exactKeys(meta, [
    "schemaVersion",
    "datasetId",
    "period",
    "source",
    "coverage",
    "definitions",
    "methodology",
    "lockSha256",
    "dataArtifactBytes",
    "dataArtifactSha256",
  ], "meta");
  if (meta.schemaVersion !== 1) fail("meta.schemaVersion: atteso 1.");
  if (meta.datasetId !== MEF_IRPEF_DATASET_ID) fail("meta.datasetId non valido.");

  const period = record(meta.period, "meta.period");
  exactKeys(period, [
    "taxYear",
    "declarationYear",
    "publishedAt",
    "observedAt",
    "municipalityAssignmentDateRule",
    "surtaxDomicileDate",
  ], "meta.period");
  if (period.taxYear !== MEF_IRPEF_TAX_YEAR) fail("meta.period.taxYear non valido.");
  if (period.declarationYear !== 2025) fail("meta.period.declarationYear non valido.");
  if (period.publishedAt !== "2026-04-23") fail("meta.period.publishedAt non valido.");
  matchingText(period.observedAt, ISO_INSTANT_PATTERN, "meta.period.observedAt");
  text(period.municipalityAssignmentDateRule, "meta.period.municipalityAssignmentDateRule");
  text(period.surtaxDomicileDate, "meta.period.surtaxDomicileDate");

  const coverage = record(meta.coverage, "meta.coverage");
  exactKeys(coverage, [
    "sourceRows",
    "municipalities",
    "provinces",
    "regions",
    "unassignedRows",
    "taxpayers",
  ], "meta.coverage");
  if (coverage.sourceRows !== 7_897) fail("meta.coverage.sourceRows non valido.");
  if (coverage.municipalities !== 7_896) fail("meta.coverage.municipalities non valido.");
  if (coverage.provinces !== 107) fail("meta.coverage.provinces non valido.");
  if (coverage.regions !== 20) fail("meta.coverage.regions non valido.");
  if (coverage.unassignedRows !== 1) fail("meta.coverage.unassignedRows non valido.");
  const taxpayers = record(coverage.taxpayers, "meta.coverage.taxpayers");
  exactKeys(taxpayers, ["assigned", "unassigned", "allSource"], "meta.coverage.taxpayers");
  safeInteger(taxpayers.assigned, "meta.coverage.taxpayers.assigned");
  safeInteger(taxpayers.unassigned, "meta.coverage.taxpayers.unassigned");
  safeInteger(taxpayers.allSource, "meta.coverage.taxpayers.allSource");
  if ((taxpayers.assigned as number) + (taxpayers.unassigned as number) !== taxpayers.allSource) {
    fail("meta.coverage.taxpayers: assegnati e non assegnati non riconciliati.");
  }

  const source = record(meta.source, "meta.source");
  exactKeys(source, [
    "owner",
    "landingUrl",
    "assetUrl",
    "methodologyUrl",
    "definitionsUrl",
    "license",
    "licenseUrl",
    "attribution",
    "zip",
    "csvMember",
    "methodologyDocument",
    "definitionsDocument",
    "format",
  ], "meta.source");
  text(source.owner, "meta.source.owner");
  httpsUrl(source.landingUrl, "meta.source.landingUrl");
  httpsUrl(source.assetUrl, "meta.source.assetUrl");
  httpsUrl(source.methodologyUrl, "meta.source.methodologyUrl");
  httpsUrl(source.definitionsUrl, "meta.source.definitionsUrl");
  if (source.license !== "CC BY 3.0") fail("meta.source.license non valida.");
  if (source.licenseUrl !== "https://creativecommons.org/licenses/by/3.0/it/") {
    fail("meta.source.licenseUrl non valido.");
  }
  text(source.attribution, "meta.source.attribution");

  const zip = record(source.zip, "meta.source.zip");
  exactKeys(zip, ["bytes", "sha256", "lastModified"], "meta.source.zip");
  safeInteger(zip.bytes, "meta.source.zip.bytes");
  sha256(zip.sha256, "meta.source.zip.sha256");
  matchingText(zip.lastModified, ISO_INSTANT_PATTERN, "meta.source.zip.lastModified");

  const csvMember = record(source.csvMember, "meta.source.csvMember");
  exactKeys(csvMember, ["name", "bytes", "sha256", "crc32"], "meta.source.csvMember");
  text(csvMember.name, "meta.source.csvMember.name");
  safeInteger(csvMember.bytes, "meta.source.csvMember.bytes");
  sha256(csvMember.sha256, "meta.source.csvMember.sha256");
  matchingText(csvMember.crc32, /^[a-f0-9]{8}$/, "meta.source.csvMember.crc32");

  for (const documentKey of ["methodologyDocument", "definitionsDocument"] as const) {
    const document = record(source[documentKey], `meta.source.${documentKey}`);
    exactKeys(document, ["bytes", "sha256", "lastModified"], `meta.source.${documentKey}`);
    safeInteger(document.bytes, `meta.source.${documentKey}.bytes`);
    sha256(document.sha256, `meta.source.${documentKey}.sha256`);
    matchingText(
      document.lastModified,
      ISO_INSTANT_PATTERN,
      `meta.source.${documentKey}.lastModified`,
    );
  }

  const format = record(source.format, "meta.source.format");
  exactKeys(format, [
    "encoding",
    "delimiter",
    "lineEnding",
    "rawHeaderSha256",
    "normalizedHeaderSha256",
  ], "meta.source.format");
  if (format.encoding !== "ascii") fail("meta.source.format.encoding non valido.");
  if (format.delimiter !== ";") fail("meta.source.format.delimiter non valido.");
  if (format.lineEnding !== "CRLF") fail("meta.source.format.lineEnding non valido.");
  sha256(format.rawHeaderSha256, "meta.source.format.rawHeaderSha256");
  sha256(format.normalizedHeaderSha256, "meta.source.format.normalizedHeaderSha256");

  const definitions = record(meta.definitions, "meta.definitions");
  exactKeys(definitions, ["taxpayers", ...MEF_IRPEF_MEASURE_ORDER], "meta.definitions");
  for (const [key, value] of Object.entries(definitions)) text(value, `meta.definitions.${key}`);
  const methodology = record(meta.methodology, "meta.methodology");
  exactKeys(methodology, [
    "municipalityAssignment",
    "missingValues",
    "amounts",
    "aggregation",
    "semanticWarning",
  ], "meta.methodology");
  for (const [key, value] of Object.entries(methodology)) text(value, `meta.methodology.${key}`);
  assertJsonValue(source, "meta.source");
  sha256(meta.lockSha256, "meta.lockSha256");
  safeInteger(meta.dataArtifactBytes, "meta.dataArtifactBytes");
  sha256(meta.dataArtifactSha256, "meta.dataArtifactSha256");

  return meta as unknown as MefIrpefSnapshotMeta;
}

function parseData(value: unknown): MefIrpefSnapshotData {
  const data = record(value, "data");
  exactKeys(data, [
    "schemaVersion",
    "datasetId",
    "taxYear",
    "measureOrder",
    "municipalities",
    "provinces",
    "regions",
    "national",
  ], "data");
  if (data.schemaVersion !== 1) fail("data.schemaVersion: atteso 1.");
  if (data.datasetId !== MEF_IRPEF_DATASET_ID) fail("data.datasetId non valido.");
  if (data.taxYear !== MEF_IRPEF_TAX_YEAR) fail("data.taxYear non valido.");
  if (
    !Array.isArray(data.measureOrder) ||
    data.measureOrder.length !== MEF_IRPEF_MEASURE_ORDER.length ||
    data.measureOrder.some((item, index) => item !== MEF_IRPEF_MEASURE_ORDER[index])
  ) {
    fail("data.measureOrder non valido.");
  }
  if (!Array.isArray(data.municipalities) || data.municipalities.length !== 7_896) {
    fail("data.municipalities: attesi 7.896 record.");
  }
  if (!Array.isArray(data.provinces) || data.provinces.length !== 107) {
    fail("data.provinces: attesi 107 record.");
  }
  if (!Array.isArray(data.regions) || data.regions.length !== 20) {
    fail("data.regions: attesi 20 record.");
  }

  const municipalities = data.municipalities.map(parseMunicipality);
  const provinces = data.provinces.map(parseProvince);
  const regions = data.regions.map(parseRegion);
  const nationalRecord = record(data.national, "data.national");
  exactKeys(nationalRecord, ["assigned", "unassigned", "allSource"], "data.national");
  const assigned = parseAggregate(nationalRecord.assigned, "data.national.assigned");
  const unassignedRecord = record(nationalRecord.unassigned, "data.national.unassigned");
  exactKeys(unassignedRecord, ["label", "taxpayers", "measures"], "data.national.unassigned");
  if (unassignedRecord.label !== "Mancante/errata") {
    fail("data.national.unassigned.label non valido.");
  }
  const unassigned = {
    label: "Mancante/errata" as const,
    taxpayers: safeInteger(unassignedRecord.taxpayers, "data.national.unassigned.taxpayers"),
    measures: parseMeasures(unassignedRecord.measures, "data.national.unassigned.measures"),
  };
  const allSource = parseAggregate(nationalRecord.allSource, "data.national.allSource");

  const municipalCodes = new Set<string>();
  const cadastralCodes = new Set<string>();
  const provinceHierarchy = new Map<string, { abbreviation: string; regionCode: string }>();
  let previousMunicipalCode = "";
  for (const municipality of municipalities) {
    if (municipality[0] <= previousMunicipalCode) fail("data.municipalities non ordinati o duplicati.");
    previousMunicipalCode = municipality[0];
    if (municipalCodes.has(municipality[0])) fail(`Comune duplicato: ${municipality[0]}.`);
    if (cadastralCodes.has(municipality[1])) fail(`Codice catastale duplicato: ${municipality[1]}.`);
    municipalCodes.add(municipality[0]);
    cadastralCodes.add(municipality[1]);
    const existing = provinceHierarchy.get(municipality[3]);
    const hierarchy = { abbreviation: municipality[4], regionCode: municipality[5] };
    if (existing && (
      existing.abbreviation !== hierarchy.abbreviation ||
      existing.regionCode !== hierarchy.regionCode
    )) {
      fail(`Gerarchia provinciale incoerente: ${municipality[3]}.`);
    }
    provinceHierarchy.set(municipality[3], hierarchy);
  }

  const provincesByCode = new Map<string, MefIrpefStoredProvince>();
  let previousProvinceCode = "";
  for (const province of provinces) {
    if (province.code <= previousProvinceCode) fail("data.provinces non ordinate o duplicate.");
    previousProvinceCode = province.code;
    const hierarchy = provinceHierarchy.get(province.code);
    if (!hierarchy) fail(`Provincia senza Comuni: ${province.code}.`);
    if (
      hierarchy.abbreviation !== province.abbreviation ||
      hierarchy.regionCode !== province.regionCode
    ) {
      fail(`Gerarchia della provincia ${province.code} non riconciliata.`);
    }
    provincesByCode.set(province.code, province);
  }

  const regionsByCode = new Map<string, MefIrpefStoredRegion>();
  let previousRegionCode = "";
  for (const region of regions) {
    if (region.code <= previousRegionCode) fail("data.regions non ordinate o duplicate.");
    previousRegionCode = region.code;
    regionsByCode.set(region.code, region);
  }
  for (const province of provinces) {
    if (!regionsByCode.has(province.regionCode)) {
      fail(`Regione della provincia ${province.code} non presente.`);
    }
  }

  const foldedProvinces = new Map<string, MutableAggregate>();
  const foldedRegions = new Map<string, MutableAggregate>();
  const foldedAssigned = emptyAggregate();
  for (const municipality of municipalities) {
    const province = foldedProvinces.get(municipality[3]) ?? emptyAggregate();
    const region = foldedRegions.get(municipality[5]) ?? emptyAggregate();
    addMunicipality(province, municipality);
    addMunicipality(region, municipality);
    addMunicipality(foldedAssigned, municipality);
    foldedProvinces.set(municipality[3], province);
    foldedRegions.set(municipality[5], region);
  }
  for (const province of provinces) {
    assertAggregateEqual(province, foldedProvinces.get(province.code) ?? emptyAggregate(), `Provincia ${province.code}`);
  }
  for (const region of regions) {
    assertAggregateEqual(region, foldedRegions.get(region.code) ?? emptyAggregate(), `Regione ${region.code}`);
  }
  assertAggregateEqual(assigned, foldedAssigned, "Nazionale assegnato");
  const foldedAllSource = emptyAggregate();
  addStoredAggregate(foldedAllSource, assigned);
  addStoredAggregate(foldedAllSource, unassigned);
  assertAggregateEqual(allSource, foldedAllSource, "Nazionale fonte completa");

  return {
    schemaVersion: 1,
    datasetId: MEF_IRPEF_DATASET_ID,
    taxYear: MEF_IRPEF_TAX_YEAR,
    measureOrder: MEF_IRPEF_MEASURE_ORDER,
    municipalities,
    provinces,
    regions,
    national: { assigned, unassigned, allSource },
  };
}

export function validateMefIrpefSnapshot(
  metaValue: unknown,
  dataValue: unknown,
  actualDataArtifact: Readonly<{ bytes: number; sha256: string }>,
): ValidatedMefIrpefSnapshot {
  const meta = parseMeta(metaValue);
  const data = parseData(dataValue);
  const actualBytes = safeInteger(actualDataArtifact.bytes, "actualDataArtifact.bytes");
  const actualSha256 = sha256(actualDataArtifact.sha256, "actualDataArtifact.sha256");
  if (meta.dataArtifactBytes !== actualBytes) fail("Dimensione artefatto dati non riconciliata.");
  if (meta.dataArtifactSha256 !== actualSha256) fail("SHA-256 artefatto dati non riconciliato.");
  if (meta.coverage.taxpayers.assigned !== data.national.assigned.taxpayers) {
    fail("Contribuenti assegnati meta/data non riconciliati.");
  }
  if (meta.coverage.taxpayers.unassigned !== data.national.unassigned.taxpayers) {
    fail("Contribuenti non assegnati meta/data non riconciliati.");
  }
  if (meta.coverage.taxpayers.allSource !== data.national.allSource.taxpayers) {
    fail("Contribuenti complessivi meta/data non riconciliati.");
  }
  return { meta, data };
}

export function validateMefIrpefMeta(value: unknown): MefIrpefSnapshotMeta {
  return parseMeta(value);
}

export function validateMefIrpefData(value: unknown): MefIrpefSnapshotData {
  return parseData(value);
}
