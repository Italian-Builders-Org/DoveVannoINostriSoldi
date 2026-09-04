import "server-only";

import rawSnapshot from "@/data/generated/education-atlas-snapshot.json";
import {
  validateEducationAtlasSnapshot,
  type EducationAtlasAddressObservation,
  type EducationAtlasPathwayCode,
  type EducationAtlasPathwayObservation,
  type EducationAtlasRegionalObservation,
  type EducationAtlasSnapshot,
  type EducationAtlasSource,
  type EducationSchoolType,
} from "@/lib/education-atlas-contract";

export const EDUCATION_ATLAS_ALL = "all" as const;
export type EducationAtlasSelection = typeof EDUCATION_ATLAS_ALL;

export type EducationAtlasFilters = Readonly<{
  period?: string;
  region?: string;
  schoolType?: string;
  pathway?: string;
}>;

export type EducationAtlasPoint = Readonly<{
  code: string;
  name: string;
  value: number | null;
}>;

export type EducationAtlasPathwayPoint = Readonly<{
  code: string;
  label: string;
  value: number | null;
  maleCount: number | null;
  femaleCount: number | null;
}>;

export type EducationAtlasAddressPoint = Readonly<{
  pathwayCode: string;
  pathwayLabel: string;
  addressLabel: string;
  value: number;
  maleCount: number;
  femaleCount: number;
}>;

export type EducationAtlasTrendPoint = Readonly<{
  period: string;
  periodLabel: string;
  value: number | null;
  maleCount: number | null;
  femaleCount: number | null;
}>;

export type EducationAtlasView = Readonly<{
  period: string;
  periodLabel: string;
  region: string;
  schoolType: EducationSchoolType | EducationAtlasSelection;
  pathway: string;
  selectedRegion: EducationAtlasPoint | null;
  selectedPathwayLabel: string;
  perimeterValue: number | null;
  perimeterMaleCount: number | null;
  perimeterFemaleCount: number | null;
  nationalValue: number | null;
  regionPoints: EducationAtlasPoint[];
  ranking: EducationAtlasPoint[];
  pathwayBreakdown: EducationAtlasPathwayPoint[];
  trend: EducationAtlasTrendPoint[];
  addressRanking: EducationAtlasAddressPoint[];
  sources: EducationAtlasSource[];
  sourceFiles: EducationAtlasSnapshot["sourceFiles"];
  coverage: EducationAtlasSnapshot["coverage"];
  missingRegionNames: string[];
  matchedObservationCount: number;
}>;

export type EducationAtlasDatasetQuery = Readonly<{
  dataset?: string;
  period?: string;
  region?: string;
  schoolType?: string;
  pathway?: string;
  limit?: number;
  offset?: number;
}>;

export const educationAtlasSnapshot: EducationAtlasSnapshot = validateEducationAtlasSnapshot(rawSnapshot);

const periodById = new Map(educationAtlasSnapshot.periods.map((period) => [period.id, period]));
const regionByCode = new Map(educationAtlasSnapshot.regions.map((region) => [region.code, region]));
const pathwayByCode = new Map(educationAtlasSnapshot.pathways.map((pathway) => [pathway.code, pathway]));
const schoolTypeByCode = new Map(educationAtlasSnapshot.schoolTypes.map((schoolType) => [schoolType.code, schoolType]));

function normalizePeriod(value: string | undefined): string {
  return value && periodById.has(value.trim()) ? value.trim() : educationAtlasSnapshot.periods.at(-1)!.id;
}

function normalizeRegion(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.toLocaleLowerCase("it-IT") === EDUCATION_ATLAS_ALL) return EDUCATION_ATLAS_ALL;
  if (regionByCode.has(normalized)) return normalized;
  const match = educationAtlasSnapshot.regions.find(
    (region) => region.name.localeCompare(normalized, "it", { sensitivity: "base" }) === 0,
  );
  return match?.code ?? EDUCATION_ATLAS_ALL;
}

function normalizeSchoolType(value: string | undefined): EducationSchoolType | EducationAtlasSelection {
  const normalized = value?.trim().toLocaleLowerCase("it-IT");
  if (!normalized || normalized === EDUCATION_ATLAS_ALL || normalized === "tutte") return EDUCATION_ATLAS_ALL;
  if (normalized === "statale" || normalized === "statali") return "state";
  if (schoolTypeByCode.has(normalized as EducationSchoolType)) return normalized as EducationSchoolType;
  return EDUCATION_ATLAS_ALL;
}

function normalizePathway(value: string | undefined): EducationAtlasPathwayCode | EducationAtlasSelection {
  const normalized = value?.trim();
  if (!normalized || normalized.toLocaleLowerCase("it-IT") === EDUCATION_ATLAS_ALL) return EDUCATION_ATLAS_ALL;
  const codeMatch = educationAtlasSnapshot.pathways.find((pathway) => pathway.code === normalized.toUpperCase());
  if (codeMatch) return codeMatch.code;
  const match = educationAtlasSnapshot.pathways.find(
    (pathway) => pathway.label.localeCompare(normalized, "it", { sensitivity: "base" }) === 0,
  );
  return match?.code ?? EDUCATION_ATLAS_ALL;
}

export function normalizeEducationAtlasFilters(filters: EducationAtlasFilters = {}) {
  const period = normalizePeriod(filters.period);
  const region = normalizeRegion(filters.region);
  const schoolType = normalizeSchoolType(filters.schoolType);
  const pathway = normalizePathway(filters.pathway);
  return { period, region, schoolType, pathway } as const;
}

function selectedSchoolTypes(schoolType: EducationSchoolType | EducationAtlasSelection): EducationSchoolType[] {
  return schoolType === EDUCATION_ATLAS_ALL ? ["state", "paritaria"] : [schoolType];
}

function sumNullable(values: readonly (number | null | undefined)[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function valueFromRegionalRows(rows: readonly EducationAtlasRegionalObservation[]): number | null {
  return sumNullable(rows.map((row) => row.studentCount));
}

function valueFromPathwayRows(rows: readonly EducationAtlasPathwayObservation[]): number | null {
  return sumNullable(rows.map((row) => row.studentCount));
}

function genderFromRows(
  rows: readonly { maleCount: number; femaleCount: number }[],
): { maleCount: number | null; femaleCount: number | null } {
  return {
    maleCount: sumNullable(rows.map((row) => row.maleCount)),
    femaleCount: sumNullable(rows.map((row) => row.femaleCount)),
  };
}

function pathRowsFor(
  period: string,
  schoolType: EducationSchoolType | EducationAtlasSelection,
  region: string,
  pathway: string,
): EducationAtlasPathwayObservation[] {
  const types = new Set(selectedSchoolTypes(schoolType));
  return educationAtlasSnapshot.pathwayObservations.filter(
    (row) => row.period === period
      && types.has(row.schoolType)
      && (region === EDUCATION_ATLAS_ALL || row.regionCode === region)
      && (pathway === EDUCATION_ATLAS_ALL || row.pathwayCode === pathway),
  );
}

function regionalRowsFor(
  period: string,
  schoolType: EducationSchoolType | EducationAtlasSelection,
  region: string,
): EducationAtlasRegionalObservation[] {
  const types = new Set(selectedSchoolTypes(schoolType));
  return educationAtlasSnapshot.regionalObservations.filter(
    (row) => row.period === period
      && types.has(row.schoolType)
      && (region === EDUCATION_ATLAS_ALL || row.regionCode === region),
  );
}

function addressRowsFor(
  period: string,
  schoolType: EducationSchoolType | EducationAtlasSelection,
  region: string,
  pathway: string,
): EducationAtlasAddressObservation[] {
  const types = new Set(selectedSchoolTypes(schoolType));
  return educationAtlasSnapshot.addressObservations.filter(
    (row) => row.period === period
      && types.has(row.schoolType)
      && (region === EDUCATION_ATLAS_ALL || row.regionCode === region)
      && (pathway === EDUCATION_ATLAS_ALL || row.pathwayCode === pathway),
  );
}

function periodLabel(period: string): string {
  return periodById.get(period)?.label ?? period;
}

function pathwayLabel(pathway: EducationAtlasPathwayCode | EducationAtlasSelection): string {
  if (pathway === EDUCATION_ATLAS_ALL) return "Tutti i percorsi";
  return pathwayByCode.get(pathway)?.label ?? pathway;
}

function mapRegionPoints(
  period: string,
  schoolType: EducationSchoolType | EducationAtlasSelection,
  pathway: string,
): EducationAtlasPoint[] {
  return educationAtlasSnapshot.regions.map((region) => {
    const value = pathway === EDUCATION_ATLAS_ALL
      ? valueFromRegionalRows(regionalRowsFor(period, schoolType, region.code))
      : valueFromPathwayRows(pathRowsFor(period, schoolType, region.code, pathway));
    return { code: region.code, name: region.name, value };
  });
}

function mapPathwayBreakdown(
  period: string,
  schoolType: EducationSchoolType | EducationAtlasSelection,
  region: string,
): EducationAtlasPathwayPoint[] {
  const selectedRows = educationAtlasSnapshot.pathwayObservations.filter(
    (row) => row.period === period
      && selectedSchoolTypes(schoolType).includes(row.schoolType)
      && (region === EDUCATION_ATLAS_ALL || row.regionCode === region),
  );
  return educationAtlasSnapshot.pathways
    .map((pathway) => {
      const rows = selectedRows.filter((row) => row.pathwayCode === pathway.code);
      return {
        code: pathway.code,
        label: pathway.label,
        value: valueFromPathwayRows(rows),
        ...genderFromRows(rows),
      };
    })
    .filter((pathway) => pathway.value !== null)
    .sort((left, right) => (right.value ?? -1) - (left.value ?? -1));
}

function mapTrend(
  schoolType: EducationSchoolType | EducationAtlasSelection,
  region: string,
  pathway: string,
): EducationAtlasTrendPoint[] {
  return educationAtlasSnapshot.periods.map((period) => {
    const pathRows = pathway === EDUCATION_ATLAS_ALL
      ? []
      : pathRowsFor(period.id, schoolType, region, pathway);
    const regionalRows = pathway === EDUCATION_ATLAS_ALL
      ? regionalRowsFor(period.id, schoolType, region)
      : [];
    const rows = pathway === EDUCATION_ATLAS_ALL ? regionalRows : pathRows;
    return {
      period: period.id,
      periodLabel: period.label,
      value: pathway === EDUCATION_ATLAS_ALL ? valueFromRegionalRows(regionalRows) : valueFromPathwayRows(pathRows),
      ...genderFromRows(rows),
    };
  });
}

function mapAddressRanking(
  period: string,
  schoolType: EducationSchoolType | EducationAtlasSelection,
  region: string,
  pathway: string,
): EducationAtlasAddressPoint[] {
  const buckets = new Map<string, EducationAtlasAddressPoint>();
  for (const row of addressRowsFor(period, schoolType, region, pathway)) {
    const key = `${row.pathwayCode}|${row.addressLabel}`;
    const current = buckets.get(key);
    buckets.set(key, {
      pathwayCode: row.pathwayCode,
      pathwayLabel: row.pathwayLabel,
      addressLabel: row.addressLabel,
      value: (current?.value ?? 0) + row.studentCount,
      maleCount: (current?.maleCount ?? 0) + row.maleCount,
      femaleCount: (current?.femaleCount ?? 0) + row.femaleCount,
    });
  }
  return [...buckets.values()].sort((left, right) => right.value - left.value).slice(0, 14);
}

export function getEducationAtlasView(filters: EducationAtlasFilters = {}): EducationAtlasView {
  const normalized = normalizeEducationAtlasFilters(filters);
  const regionPoints = mapRegionPoints(normalized.period, normalized.schoolType, normalized.pathway);
  const ranking = [...regionPoints].sort((left, right) => (right.value ?? -1) - (left.value ?? -1));
  const selectedRegion = normalized.region === EDUCATION_ATLAS_ALL
    ? null
    : regionPoints.find((region) => region.code === normalized.region) ?? null;
  const nationalValue = normalized.pathway === EDUCATION_ATLAS_ALL
    ? valueFromRegionalRows(regionalRowsFor(normalized.period, normalized.schoolType, EDUCATION_ATLAS_ALL))
    : valueFromPathwayRows(pathRowsFor(normalized.period, normalized.schoolType, EDUCATION_ATLAS_ALL, normalized.pathway));
  const nationalRows = normalized.pathway === EDUCATION_ATLAS_ALL
    ? regionalRowsFor(normalized.period, normalized.schoolType, EDUCATION_ATLAS_ALL)
    : pathRowsFor(normalized.period, normalized.schoolType, EDUCATION_ATLAS_ALL, normalized.pathway);
  const perimeterRows = normalized.region === EDUCATION_ATLAS_ALL
    ? nationalRows
    : normalized.pathway === EDUCATION_ATLAS_ALL
      ? regionalRowsFor(normalized.period, normalized.schoolType, normalized.region)
      : pathRowsFor(normalized.period, normalized.schoolType, normalized.region, normalized.pathway);
  const gender = genderFromRows(perimeterRows);
  const perimeterValue = normalized.region === EDUCATION_ATLAS_ALL
    ? nationalValue
    : normalized.pathway === EDUCATION_ATLAS_ALL
      ? valueFromRegionalRows(regionalRowsFor(normalized.period, normalized.schoolType, normalized.region))
      : valueFromPathwayRows(pathRowsFor(normalized.period, normalized.schoolType, normalized.region, normalized.pathway));
  const pathwayBreakdown = mapPathwayBreakdown(normalized.period, normalized.schoolType, normalized.region);
  const addressRanking = mapAddressRanking(
    normalized.period,
    normalized.schoolType,
    normalized.region,
    normalized.pathway,
  );

  return {
    period: normalized.period,
    periodLabel: periodLabel(normalized.period),
    region: normalized.region,
    schoolType: normalized.schoolType,
    pathway: normalized.pathway,
    selectedRegion,
    selectedPathwayLabel: pathwayLabel(normalized.pathway),
    perimeterValue,
    perimeterMaleCount: gender.maleCount,
    perimeterFemaleCount: gender.femaleCount,
    nationalValue,
    regionPoints,
    ranking,
    pathwayBreakdown,
    trend: mapTrend(normalized.schoolType, normalized.region, normalized.pathway),
    addressRanking,
    sources: educationAtlasSnapshot.sources,
    sourceFiles: educationAtlasSnapshot.sourceFiles,
    coverage: educationAtlasSnapshot.coverage,
    missingRegionNames: educationAtlasSnapshot.coverage.missingRegionCodes.map(
      (code) => regionByCode.get(code)?.name ?? code,
    ),
    matchedObservationCount: normalized.pathway === EDUCATION_ATLAS_ALL
      ? regionalRowsFor(normalized.period, normalized.schoolType, normalized.region).length
      : pathRowsFor(normalized.period, normalized.schoolType, normalized.region, normalized.pathway).length,
  };
}

export function educationAtlasPeriodOptions() {
  return educationAtlasSnapshot.periods;
}

export function educationAtlasRegionOptions() {
  return educationAtlasSnapshot.regions;
}

export function educationAtlasSchoolTypeOptions() {
  return educationAtlasSnapshot.schoolTypes;
}

export function educationAtlasPathwayOptions() {
  return educationAtlasSnapshot.pathways;
}

function filterValueIsAll(value: string | undefined): boolean {
  return value?.trim().toLocaleLowerCase("it-IT") === EDUCATION_ATLAS_ALL;
}

export function queryEducationAtlasDataset(query: EducationAtlasDatasetQuery = {}) {
  if (query.dataset && query.dataset !== "education_students_by_pathway") {
    throw new Error(`Dataset istruzione non riconosciuto: ${query.dataset}.`);
  }
  const requestedPeriod = query.period?.trim();
  if (requestedPeriod && !periodById.has(requestedPeriod)) {
    throw new Error(`Periodo scolastico non disponibile. Periodi validi: ${educationAtlasSnapshot.periods.map((period) => period.id).join(", ")}.`);
  }
  const regionInput = query.region?.trim();
  const region = normalizeRegion(regionInput);
  if (regionInput && !filterValueIsAll(regionInput) && region === EDUCATION_ATLAS_ALL) {
    throw new Error(`Regione non trovata nell'Atlante Istruzione: ${regionInput}.`);
  }
  const pathwayInput = query.pathway?.trim();
  const pathway = normalizePathway(pathwayInput);
  if (pathwayInput && !filterValueIsAll(pathwayInput) && pathway === EDUCATION_ATLAS_ALL) {
    throw new Error(`Percorso non trovato nell'Atlante Istruzione: ${pathwayInput}.`);
  }
  const schoolType = normalizeSchoolType(query.schoolType);
  if (query.schoolType && !filterValueIsAll(query.schoolType) && schoolType === EDUCATION_ATLAS_ALL) {
    throw new Error(`Tipo di scuola non valido: ${query.schoolType}. Valori: state, paritaria.`);
  }
  const periods = requestedPeriod ? [requestedPeriod] : educationAtlasSnapshot.periods.map((period) => period.id);
  const types = selectedSchoolTypes(schoolType);
  const data = educationAtlasSnapshot.pathwayObservations.filter(
    (row) => periods.includes(row.period)
      && types.includes(row.schoolType)
      && (region === EDUCATION_ATLAS_ALL || row.regionCode === region)
      && (pathway === EDUCATION_ATLAS_ALL || row.pathwayCode === pathway),
  );
  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)));
  const offset = Math.min(100_000, Math.max(0, Math.trunc(query.offset ?? 0)));
  const items = data.slice(offset, offset + limit);
  return {
    schemaVersion: 1,
    dataset: "education_students_by_pathway",
    observationType: "aggregate",
    geographyLevel: "region",
    query: {
      period: requestedPeriod ?? EDUCATION_ATLAS_ALL,
      region,
      schoolType,
      pathway,
    },
    pagination: {
      total: data.length,
      offset,
      limit,
      returned: items.length,
      hasMore: offset + items.length < data.length,
      nextOffset: offset + items.length < data.length ? offset + items.length : null,
    },
    data: items,
    coverage: educationAtlasSnapshot.coverage,
    sources: educationAtlasSnapshot.sources,
    provenance: educationAtlasSnapshot.sourceFiles,
    caveat: "Studenti aggregati per Regione, tipo di scuola, percorso e anno scolastico. Le variazioni descrivono il file osservato: non misurano qualità, esiti, domanda futura o carenze occupazionali. Le Regioni assenti dalla fonte restano n.d.; non vengono imputate.",
  };
}
