import { createHash } from "node:crypto";
import mefIrpefDataJson from "@/data/generated/mef-irpef-2024.data.json";
import mefIrpefMetaJson from "@/data/generated/mef-irpef-2024.meta.json";
import {
  MEF_IRPEF_DATASET_ID,
  MEF_IRPEF_INCOME_BAND_MEASURE_ORDER,
  MEF_IRPEF_INCOME_SOURCE_MEASURE_ORDER,
  MEF_IRPEF_MEASURE_ORDER,
  MEF_IRPEF_SUMMARY_MEASURE_ORDER,
  MEF_IRPEF_TAX_YEAR,
  type MefIrpefAggregateMeasure,
  type MefIrpefIncomeBandMeasureKey,
  type MefIrpefIncomeSourceMeasureKey,
  type MefIrpefMeasureKey,
  type MefIrpefPackedMunicipality,
  type MefIrpefSnapshotMeta,
  type MefIrpefStoredAggregate,
  type MefIrpefStoredProvince,
  type MefIrpefStoredRegion,
  type MefIrpefSummaryMeasureKey,
  validateMefIrpefSnapshot,
} from "@/lib/data/mef-irpef-contract";

export type MefIrpefLevel = "region" | "province" | "municipality";
export type MefIrpefDetail = "summary" | "income-sources" | "income-bands" | "all";

export type MefIrpefQuery = Readonly<{
  year?: number;
  level?: MefIrpefLevel;
  region?: string;
  province?: string;
  code?: string;
  query?: string;
  detail?: MefIrpefDetail;
  limit?: number;
  offset?: number;
}>;

export type ReportedMeasure =
  | Readonly<{
      coverage: "complete";
      frequency: number;
      amountCents: number;
    }>
  | Readonly<{
      coverage: "partial";
      knownFrequency: number;
      knownAmountCents: number;
      suppressedRows: number;
      suppressedFrequencyRows?: number;
      suppressedAmountRows?: number;
    }>;

type MefIrpefMeasureGroup<Key extends MefIrpefMeasureKey> = Readonly<
  Record<Key, ReportedMeasure>
>;

export type MefIrpefMeasures = MefIrpefMeasureGroup<MefIrpefSummaryMeasureKey>;
export type MefIrpefIncomeSources = MefIrpefMeasureGroup<MefIrpefIncomeSourceMeasureKey>;
export type MefIrpefIncomeBands = MefIrpefMeasureGroup<MefIrpefIncomeBandMeasureKey>;
export type MefIrpefBreakdowns = Readonly<{
  incomeSources?: MefIrpefIncomeSources;
  incomeBands?: MefIrpefIncomeBands;
}>;

export type MefIrpefPublicAggregate = Readonly<{
  taxpayers: number;
  measures: MefIrpefMeasures;
  breakdowns?: MefIrpefBreakdowns;
}>;

export type MefIrpefTerritoryRecord = Readonly<{
  territory:
    | Readonly<{ level: "region"; code: string; name: string; sourceNames: readonly string[] }>
    | Readonly<{
        level: "province";
        code: string;
        abbreviation: string;
        regionCode: string;
      }>
    | Readonly<{
        level: "municipality";
        code: string;
        cadastralCode: string;
        name: string;
        provinceCode: string;
        provinceAbbreviation: string;
        regionCode: string;
      }>;
  taxpayers: number;
  measures: MefIrpefMeasures;
  breakdowns?: MefIrpefBreakdowns;
}>;

export type MefIrpefPublicDefinitions = Readonly<
  Record<"taxpayers" | MefIrpefSummaryMeasureKey, string> &
  Partial<Record<MefIrpefIncomeSourceMeasureKey | MefIrpefIncomeBandMeasureKey, string>>
>;

export type MefIrpefQueryResult = Readonly<{
  dataset: typeof MEF_IRPEF_DATASET_ID;
  period: MefIrpefSnapshotMeta["period"];
  level: MefIrpefLevel;
  query: Readonly<Required<Pick<MefIrpefQuery, "limit" | "offset">> & Omit<MefIrpefQuery, "limit" | "offset">>;
  pagination: Readonly<{
    total: number;
    offset: number;
    limit: number;
    returned: number;
  }>;
  matchedTotals: MefIrpefPublicAggregate;
  data: readonly MefIrpefTerritoryRecord[];
  national: Readonly<{
    assigned: MefIrpefPublicAggregate;
    unassigned: MefIrpefPublicAggregate & Readonly<{ label: "Mancante/errata" }>;
    allSource: MefIrpefPublicAggregate;
  }>;
  coverage: MefIrpefSnapshotMeta["coverage"];
  definitions: MefIrpefPublicDefinitions;
  methodology: MefIrpefSnapshotMeta["methodology"];
  caveats: readonly string[];
  provenance: Readonly<{
    source: MefIrpefSnapshotMeta["source"];
    lockSha256: string;
    dataArtifactBytes: number;
    dataArtifactSha256: string;
  }>;
}>;

export type MefIrpefQueryErrorCode = "invalid_query" | "not_found";

export class MefIrpefQueryError extends Error {
  readonly code: MefIrpefQueryErrorCode;
  readonly status: 400 | 404;

  constructor(code: MefIrpefQueryErrorCode, message: string) {
    super(message);
    this.name = "MefIrpefQueryError";
    this.code = code;
    this.status = code === "not_found" ? 404 : 400;
  }
}

type NormalizedQuery = Readonly<{
  year: typeof MEF_IRPEF_TAX_YEAR;
  level: MefIrpefLevel;
  region?: string;
  province?: string;
  code?: string;
  query?: string;
  detail: MefIrpefDetail;
  limit: number;
  offset: number;
}>;

type InternalRecord = Readonly<{
  territory: MefIrpefTerritoryRecord["territory"];
  aggregate: MefIrpefStoredAggregate;
  sortKey: string;
  regionCode: string;
  provinceCode?: string;
  searchText?: string;
}>;

// The ETL writes canonical compact JSON plus one trailing newline. Keep this
// byte-for-byte binding here so a reformatted or replaced artifact fails closed.
const serializedData = `${JSON.stringify(mefIrpefDataJson)}\n`;
const validatedSnapshot = validateMefIrpefSnapshot(mefIrpefMetaJson, mefIrpefDataJson, {
  bytes: Buffer.byteLength(serializedData, "utf8"),
  sha256: createHash("sha256").update(serializedData, "utf8").digest("hex"),
});

export const mefIrpefMetadata = validatedSnapshot.meta;
const snapshot = validatedSnapshot.data;

const CAVEATS = Object.freeze([
  "L’imposta netta è l’imposta netta dichiarata nelle statistiche MEF: non è il gettito fiscale totale.",
  "I valori IRPEF non vengono sottratti alla spesa o al saldo CPT: fonti, perimetri e significati non sono equivalenti.",
  "I valori oscurati per tutela statistica restano parziali: non vengono trasformati in zero né stimati.",
  "La riga Mancante/errata resta separata dagli aggregati territoriali e compare soltanto nella riconciliazione nazionale.",
  "Questi aggregati non dimostrano evasione, frode, responsabilità individuali o qualità dei servizi.",
]);
const INCOME_SOURCE_CAVEAT =
  "Le frequenze delle fonti di reddito si sovrappongono: la stessa persona può comparire in più categorie e non vanno sommate come contribuenti distinti.";
const INCOME_BAND_CAVEAT =
  "Le fasce di reddito complessivo sono disgiunte; la fascia non positiva può avere un ammontare negativo e le celle oscurate impediscono una riconciliazione completa.";

function invalid(message: string): never {
  throw new MefIrpefQueryError("invalid_query", message);
}

function notFound(message: string): never {
  throw new MefIrpefQueryError("not_found", message);
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(`Il filtro ${label} deve essere testuale.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalid(`Il filtro ${label} deve contenere da 1 a ${maxLength} caratteri.`);
  }
  return normalized;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`Il filtro ${label} deve essere un intero tra ${minimum} e ${maximum}.`);
  }
  return value as number;
}

function inferLevel(query: MefIrpefQuery): MefIrpefLevel {
  if (query.level !== undefined) {
    if (!(["region", "province", "municipality"] as const).includes(query.level)) {
      invalid("Il livello deve essere region, province oppure municipality.");
    }
    return query.level;
  }
  if (typeof query.code === "string") {
    const length = query.code.trim().length;
    if (length === 2) return "region";
    if (length === 3) return "province";
    if (length === 6) return "municipality";
  }
  if (query.query !== undefined || query.province !== undefined) return "municipality";
  return "region";
}

function normalizeQuery(query: MefIrpefQuery | undefined): NormalizedQuery {
  const input = query ?? {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid("La query MEF IRPEF deve essere un oggetto.");
  }
  const allowedKeys = new Set([
    "year",
    "level",
    "region",
    "province",
    "code",
    "query",
    "detail",
    "limit",
    "offset",
  ]);
  const unsupportedKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length > 0) {
    invalid(`Filtri MEF IRPEF non supportati: ${unsupportedKeys.join(", ")}.`);
  }
  const year = input.year ?? MEF_IRPEF_TAX_YEAR;
  if (year !== MEF_IRPEF_TAX_YEAR) {
    invalid(`Anno d’imposta non disponibile. Anno valido: ${MEF_IRPEF_TAX_YEAR}.`);
  }
  const level = inferLevel(input);
  const region = optionalText(input.region, "region", 100);
  const province = optionalText(input.province, "province", 3);
  const code = optionalText(input.code, "code", 6);
  const term = optionalText(input.query, "query", 100);
  const detail = input.detail ?? "summary";
  if (!(["summary", "income-sources", "income-bands", "all"] as const).includes(detail)) {
    invalid("Il dettaglio deve essere summary, income-sources, income-bands oppure all.");
  }
  const limit = boundedInteger(input.limit, 20, 1, 100, "limit");
  const offset = boundedInteger(input.offset, 0, 0, 100_000, "offset");

  if (code && !/^\d+$/.test(code)) invalid("Il filtro code deve contenere soltanto cifre.");
  const expectedCodeLength = level === "region" ? 2 : level === "province" ? 3 : 6;
  if (code && code.length !== expectedCodeLength) {
    invalid(`Il filtro code deve contenere ${expectedCodeLength} cifre per il livello ${level}.`);
  }
  if (level !== "municipality" && term) invalid("Il filtro query è ammesso soltanto per i Comuni.");
  if (level === "region" && province) invalid("Il filtro province non è ammesso per le Regioni.");
  if (code && term) invalid("Usa code oppure query, non entrambi.");
  if (level === "region" && code && region) invalid("Usa code oppure region, non entrambi.");
  if (level === "province" && code && province) invalid("Usa code oppure province, non entrambi.");
  if (level === "municipality" && !code && !term && !region && !province) {
    invalid("Per interrogare i Comuni indica almeno code, query, region oppure province.");
  }

  return { year, level, region, province, code, query: term, detail, limit, offset };
}

function normalizedSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/\s+/g, " ")
    .trim();
}

const italianNameCollator = new Intl.Collator("it-IT", { sensitivity: "base" });

function compareRecords(left: InternalRecord, right: InternalRecord): number {
  const nameOrder = italianNameCollator.compare(left.sortKey, right.sortKey);
  if (nameOrder !== 0) return nameOrder;
  return left.territory.code < right.territory.code ? -1 : left.territory.code > right.territory.code ? 1 : 0;
}

function toReportedMeasure(measure: MefIrpefAggregateMeasure): ReportedMeasure {
  if (measure[2] === 0) {
    return { coverage: "complete", frequency: measure[0], amountCents: measure[1] };
  }
  const reported: Extract<ReportedMeasure, { coverage: "partial" }> = {
    coverage: "partial",
    knownFrequency: measure[0],
    knownAmountCents: measure[1],
    suppressedRows: measure[2],
  };
  if (measure[2] !== measure[3] || measure[2] !== measure[4]) {
    return {
      ...reported,
      suppressedFrequencyRows: measure[3],
      suppressedAmountRows: measure[4],
    };
  }
  return reported;
}

function toMeasureGroup<Key extends MefIrpefMeasureKey>(
  measures: readonly MefIrpefAggregateMeasure[],
  keys: readonly Key[],
): MefIrpefMeasureGroup<Key> {
  return Object.fromEntries(
    keys.map((key) => {
      const index = MEF_IRPEF_MEASURE_ORDER.indexOf(key);
      return [key, toReportedMeasure(measures[index])];
    }),
  ) as MefIrpefMeasureGroup<Key>;
}

function toBreakdowns(
  measures: readonly MefIrpefAggregateMeasure[],
  detail: MefIrpefDetail,
): MefIrpefBreakdowns | undefined {
  const incomeSources = detail === "income-sources" || detail === "all"
    ? toMeasureGroup(measures, MEF_IRPEF_INCOME_SOURCE_MEASURE_ORDER)
    : undefined;
  const incomeBands = detail === "income-bands" || detail === "all"
    ? toMeasureGroup(measures, MEF_IRPEF_INCOME_BAND_MEASURE_ORDER)
    : undefined;
  return incomeSources || incomeBands
    ? {
        ...(incomeSources ? { incomeSources } : {}),
        ...(incomeBands ? { incomeBands } : {}),
      }
    : undefined;
}

function toPublicAggregate(
  aggregate: MefIrpefStoredAggregate,
  detail: MefIrpefDetail,
): MefIrpefPublicAggregate {
  const breakdowns = toBreakdowns(aggregate.measures, detail);
  return {
    taxpayers: aggregate.taxpayers,
    measures: toMeasureGroup(aggregate.measures, MEF_IRPEF_SUMMARY_MEASURE_ORDER),
    ...(breakdowns ? { breakdowns } : {}),
  };
}

function toPublicRecord(
  record: InternalRecord,
  detail: MefIrpefDetail,
): MefIrpefTerritoryRecord {
  const territory = record.territory.level === "region"
    ? { ...record.territory, sourceNames: [...record.territory.sourceNames] }
    : { ...record.territory };
  return { territory, ...toPublicAggregate(record.aggregate, detail) };
}

function municipalityAggregate(row: MefIrpefPackedMunicipality): MefIrpefStoredAggregate {
  return {
    taxpayers: row[6],
    measures: MEF_IRPEF_MEASURE_ORDER.map((_, index) => {
      const frequency = row[7 + index * 2] as number | null;
      const amount = row[8 + index * 2] as number | null;
      return [
        frequency ?? 0,
        amount ?? 0,
        frequency === null || amount === null ? 1 : 0,
        frequency === null ? 1 : 0,
        amount === null ? 1 : 0,
      ] as const;
    }),
  };
}

function regionRecord(region: MefIrpefStoredRegion): InternalRecord {
  return {
    aggregate: region,
    sortKey: normalizedSearch(region.name),
    regionCode: region.code,
    territory: {
      level: "region",
      code: region.code,
      name: region.name,
      sourceNames: region.sourceNames,
    },
  };
}

function provinceRecord(province: MefIrpefStoredProvince): InternalRecord {
  return {
    aggregate: province,
    sortKey: normalizedSearch(province.abbreviation),
    regionCode: province.regionCode,
    provinceCode: province.code,
    territory: {
      level: "province",
      code: province.code,
      abbreviation: province.abbreviation,
      regionCode: province.regionCode,
    },
  };
}

function municipalityRecord(row: MefIrpefPackedMunicipality): InternalRecord {
  const aggregate = municipalityAggregate(row);
  return {
    aggregate,
    sortKey: normalizedSearch(row[2]),
    regionCode: row[5],
    provinceCode: row[3],
    searchText: [row[0], row[1], row[2]].map(normalizedSearch).join("\n"),
    territory: {
      level: "municipality",
      code: row[0],
      cadastralCode: row[1],
      name: row[2],
      provinceCode: row[3],
      provinceAbbreviation: row[4],
      regionCode: row[5],
    },
  };
}

const regionRecords = snapshot.regions.map(regionRecord).sort(compareRecords);
const provinceRecords = snapshot.provinces.map(provinceRecord).sort(compareRecords);
const municipalityRecords = snapshot.municipalities.map(municipalityRecord).sort(compareRecords);

const regionsByCode = new Map(regionRecords.map((record) => [record.territory.code, record]));
const provincesByCode = new Map(provinceRecords.map((record) => [record.territory.code, record]));
const municipalitiesByCode = new Map(
  municipalityRecords.map((record) => [record.territory.code, record]),
);

function emptyAggregate(): {
  taxpayers: number;
  measures: Array<[number, number, number, number, number]>;
} {
  return {
    taxpayers: 0,
    measures: MEF_IRPEF_MEASURE_ORDER.map(() => [0, 0, 0, 0, 0]),
  };
}

function foldAggregates(records: readonly InternalRecord[]): MefIrpefStoredAggregate {
  const result = emptyAggregate();
  for (const record of records) {
    result.taxpayers += record.aggregate.taxpayers;
    record.aggregate.measures.forEach((measure, index) => {
      result.measures[index][0] += measure[0];
      result.measures[index][1] += measure[1];
      result.measures[index][2] += measure[2];
      result.measures[index][3] += measure[3];
      result.measures[index][4] += measure[4];
    });
  }
  return result;
}

function selectedDefinitions(detail: MefIrpefDetail): MefIrpefPublicDefinitions {
  const keys: MefIrpefMeasureKey[] = [...MEF_IRPEF_SUMMARY_MEASURE_ORDER];
  if (detail === "income-sources" || detail === "all") {
    keys.push(...MEF_IRPEF_INCOME_SOURCE_MEASURE_ORDER);
  }
  if (detail === "income-bands" || detail === "all") {
    keys.push(...MEF_IRPEF_INCOME_BAND_MEASURE_ORDER);
  }
  return Object.fromEntries([
    ["taxpayers", mefIrpefMetadata.definitions.taxpayers],
    ...keys.map((key) => [key, mefIrpefMetadata.definitions[key]]),
  ]) as MefIrpefPublicDefinitions;
}

function selectedCaveats(detail: MefIrpefDetail): readonly string[] {
  return [
    ...CAVEATS,
    ...(detail === "income-sources" || detail === "all" ? [INCOME_SOURCE_CAVEAT] : []),
    ...(detail === "income-bands" || detail === "all" ? [INCOME_BAND_CAVEAT] : []),
  ];
}

function resolveRegionCode(value: string): string {
  const normalized = normalizedSearch(value);
  const region = snapshot.regions.find((candidate) =>
    candidate.code === value ||
    normalizedSearch(candidate.name) === normalized ||
    candidate.sourceNames.some((sourceName) => normalizedSearch(sourceName) === normalized));
  if (!region) notFound(`Regione non trovata: ${value}.`);
  return region.code;
}

function resolveProvinceCode(value: string): string {
  const normalized = value.toLocaleUpperCase("it-IT");
  const province = snapshot.provinces.find((candidate) =>
    candidate.code === value || candidate.abbreviation === normalized);
  if (!province) notFound(`Provincia non trovata: ${value}.`);
  return province.code;
}

function selectRecords(query: NormalizedQuery): InternalRecord[] {
  const regionCode = query.region ? resolveRegionCode(query.region) : undefined;
  const provinceCode = query.province ? resolveProvinceCode(query.province) : undefined;

  if (query.level === "region") {
    if (query.code) {
      const match = regionsByCode.get(query.code);
      if (!match) notFound(`Regione non trovata: ${query.code}.`);
      return [match];
    }
    return regionRecords.filter((record) => !regionCode || record.regionCode === regionCode);
  }

  if (query.level === "province") {
    if (query.code) {
      const match = provincesByCode.get(query.code);
      if (!match || (regionCode && match.regionCode !== regionCode)) {
        notFound(`Provincia non trovata: ${query.code}.`);
      }
      return [match];
    }
    return provinceRecords.filter((record) =>
      (!regionCode || record.regionCode === regionCode) &&
      (!provinceCode || record.provinceCode === provinceCode));
  }

  if (query.code) {
    const match = municipalitiesByCode.get(query.code);
    if (
      !match ||
      (regionCode && match.regionCode !== regionCode) ||
      (provinceCode && match.provinceCode !== provinceCode)
    ) {
      notFound(`Comune non trovato: ${query.code}.`);
    }
    return [match];
  }

  const term = query.query ? normalizedSearch(query.query) : undefined;
  return municipalityRecords.filter((record) =>
    (!regionCode || record.regionCode === regionCode) &&
    (!provinceCode || record.provinceCode === provinceCode) &&
    (!term || record.searchText?.includes(term)));
}

export function queryMefMunicipalIrpef(query?: MefIrpefQuery): MefIrpefQueryResult {
  const normalized = normalizeQuery(query);
  const matches = selectRecords(normalized);
  if (matches.length > 0 && normalized.offset >= matches.length) {
    notFound(`Offset oltre i ${matches.length} risultati disponibili.`);
  }
  const page = matches.slice(normalized.offset, normalized.offset + normalized.limit);
  const unassigned = toPublicAggregate(snapshot.national.unassigned, normalized.detail);

  return {
    dataset: MEF_IRPEF_DATASET_ID,
    period: mefIrpefMetadata.period,
    level: normalized.level,
    query: normalized,
    pagination: {
      total: matches.length,
      offset: normalized.offset,
      limit: normalized.limit,
      returned: page.length,
    },
    matchedTotals: toPublicAggregate(foldAggregates(matches), normalized.detail),
    data: page.map((record) => toPublicRecord(record, normalized.detail)),
    national: {
      assigned: toPublicAggregate(snapshot.national.assigned, normalized.detail),
      unassigned: { label: "Mancante/errata", ...unassigned },
      allSource: toPublicAggregate(snapshot.national.allSource, normalized.detail),
    },
    coverage: mefIrpefMetadata.coverage,
    definitions: selectedDefinitions(normalized.detail),
    methodology: mefIrpefMetadata.methodology,
    caveats: selectedCaveats(normalized.detail),
    provenance: {
      source: mefIrpefMetadata.source,
      lockSha256: mefIrpefMetadata.lockSha256,
      dataArtifactBytes: mefIrpefMetadata.dataArtifactBytes,
      dataArtifactSha256: mefIrpefMetadata.dataArtifactSha256,
    },
  };
}
