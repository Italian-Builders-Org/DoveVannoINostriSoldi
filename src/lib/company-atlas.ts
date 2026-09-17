import "server-only";

import rawSnapshot from "@/data/generated/company-atlas-snapshot.json";
import {
  validateCompanyAtlasSnapshot,
  type CompanyAtlasMetric,
  type CompanyAtlasObservation,
  type CompanyAtlasSnapshot,
  type CompanyAtlasSource,
} from "@/lib/company-atlas-contract";
import { createCompanyAtlasObservationIndex } from "@/lib/company-atlas-index";

export const COMPANY_ATLAS_ALL = "all" as const;

export const COMPANY_ATLAS_METRICS = [
  {
    id: "active_enterprises",
    label: "Imprese attive",
    shortLabel: "Imprese attive",
    unit: "sedi di impresa",
    sourceId: "active-stock",
    periodKey: "activeStock",
    description: "Stock mensile delle sedi di impresa attive.",
  },
  {
    id: "employees",
    label: "Addetti",
    shortLabel: "Addetti",
    unit: "addetti",
    sourceId: "workforce",
    periodKey: "workforce",
    description: "Addetti aggregati al livello regionale e di sezione ATECO.",
  },
  {
    id: "active_local_units",
    label: "Localizzazioni attive",
    shortLabel: "Localizzazioni",
    unit: "localizzazioni",
    sourceId: "workforce",
    periodKey: "workforce",
    description: "Localizzazioni attive aggregate al livello regionale e di sezione ATECO.",
  },
  {
    id: "production_value_band_count",
    label: "Fasce di valore della produzione",
    shortLabel: "Valore della produzione",
    unit: "unità nei bilanci",
    sourceId: "production-value",
    periodKey: "productionValue",
    description: "Numero di unità attive per fascia di valore della produzione dichiarata nei bilanci.",
  },
] as const satisfies ReadonlyArray<{
  id: CompanyAtlasMetric;
  label: string;
  shortLabel: string;
  unit: string;
  sourceId: keyof CompanyAtlasSnapshot["sources"];
  periodKey: keyof CompanyAtlasSnapshot["periods"];
  description: string;
}>;

export type CompanyAtlasMetricId = (typeof COMPANY_ATLAS_METRICS)[number]["id"];

export type CompanyAtlasFilters = Readonly<{
  metric?: string;
  period?: string;
  region?: string;
  sector?: string;
  band?: string;
}>;

export type CompanyAtlasPoint = Readonly<{
  code: string;
  name: string;
  value: number | null;
}>;

export type CompanyAtlasSectorPoint = Readonly<{
  code: string;
  label: string;
  value: number | null;
}>;

export type CompanyAtlasView = Readonly<{
  metric: CompanyAtlasMetricId;
  metricLabel: string;
  metricUnit: string;
  metricDescription: string;
  period: string;
  periodLabel: string;
  region: string;
  sector: string;
  band: string;
  selectedRegion: CompanyAtlasPoint | null;
  selectedSectorLabel: string;
  selectedBandLabel: string;
  nationalValue: number | null;
  regionPoints: CompanyAtlasPoint[];
  ranking: CompanyAtlasPoint[];
  sectorBreakdown: CompanyAtlasSectorPoint[];
  sources: CompanyAtlasSource[];
  caveats: string[];
  matchedObservationCount: number;
}>;

export type CompanyAtlasDatasetId =
  | "company_active_enterprises"
  | "company_workforce"
  | "company_production_value_bands";

export type CompanyAtlasDatasetQuery = Readonly<{
  dataset: CompanyAtlasDatasetId;
  period?: string;
  region?: string;
  sector?: string;
  band?: string;
  limit?: number;
  offset?: number;
}>;

export const companyAtlasSnapshot = validateCompanyAtlasSnapshot(rawSnapshot);

const metricById = new Map(COMPANY_ATLAS_METRICS.map((metric) => [metric.id, metric]));
const regionByCode = new Map(companyAtlasSnapshot.regions.map((region) => [region.code, region]));
const sectorByCode = new Map(companyAtlasSnapshot.sectors.map((sector) => [sector.code, sector]));
const bandByCode = new Map(companyAtlasSnapshot.productionBands.map((band) => [band.code, band]));
let observationIndex: ReturnType<typeof createCompanyAtlasObservationIndex> | undefined;

function getObservationIndex() {
  return observationIndex ??= createCompanyAtlasObservationIndex(companyAtlasSnapshot.observations);
}

function metricDefinition(metric: string | undefined) {
  return metricById.get(metric as CompanyAtlasMetricId) ?? metricById.get("active_enterprises")!;
}

function periodOptions(metric: CompanyAtlasMetricId) {
  const definition = metricById.get(metric)!;
  return companyAtlasSnapshot.periods[definition.periodKey];
}

function normalizeValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 80 ? trimmed : fallback;
}

function normalizeRegion(value: string | undefined): string {
  const normalized = normalizeValue(value, COMPANY_ATLAS_ALL);
  if (normalized === COMPANY_ATLAS_ALL) return normalized;
  const byCode = regionByCode.get(normalized);
  if (byCode) return byCode.code;
  const byName = companyAtlasSnapshot.regions.find(
    (region) => region.name.localeCompare(normalized, "it", { sensitivity: "base" }) === 0,
  );
  return byName?.code ?? COMPANY_ATLAS_ALL;
}

function normalizeSector(value: string | undefined): string {
  const normalized = normalizeValue(value, COMPANY_ATLAS_ALL).toUpperCase();
  return sectorByCode.has(normalized) ? normalized : COMPANY_ATLAS_ALL;
}

function normalizeBand(value: string | undefined): string {
  const normalized = normalizeValue(value, COMPANY_ATLAS_ALL);
  return bandByCode.has(normalized) ? normalized : COMPANY_ATLAS_ALL;
}

function normalizePeriod(metric: CompanyAtlasMetricId, value: string | undefined): string {
  const options = periodOptions(metric);
  return options.some((period) => period.id === value) ? value! : options[options.length - 1]!.id;
}

function observationsFor(
  metric: CompanyAtlasMetricId,
  period: string,
  region: string,
  sector: string,
  band: string,
): readonly CompanyAtlasObservation[] {
  return getObservationIndex().select(metric, period, region, sector, band);
}

function observationsForMetrics(
  metrics: readonly CompanyAtlasMetric[],
  period: string,
  region: string,
  sector: string,
  band: string,
): readonly CompanyAtlasObservation[] {
  return getObservationIndex().selectMany(metrics, period, region, sector, band);
}

function valueForObservations(observations: readonly CompanyAtlasObservation[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const observation of observations) {
    if (observation.value === null) continue;
    total += observation.value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function valuesByCode(
  observations: readonly CompanyAtlasObservation[],
  codeKey: "geographyCode" | "sectorCode",
): Map<string, number | null> {
  const values = new Map<string, number | null>();
  for (const observation of observations) {
    const code = observation[codeKey];
    if (!values.has(code)) values.set(code, null);
    if (observation.value !== null) {
      values.set(code, (values.get(code) ?? 0) + observation.value);
    }
  }
  return values;
}

function periodLabel(metric: CompanyAtlasMetricId, period: string): string {
  return periodOptions(metric).find((option) => option.id === period)?.label ?? period;
}

function sourceForMetric(metric: CompanyAtlasMetricId): CompanyAtlasSource {
  const sourceId = metricById.get(metric)!.sourceId;
  return companyAtlasSnapshot.sources[sourceId];
}

function caveatsFor(metric: CompanyAtlasMetricId): string[] {
  const source = sourceForMetric(metric);
  const common = "Il POC espone soltanto aggregati regionali: non contiene nomi, identificativi o ricavi esatti di singole aziende.";
  return metric === "production_value_band_count"
    ? [source.caveat, common]
    : [source.caveat, common];
}

export function normalizeCompanyAtlasFilters(filters: CompanyAtlasFilters = {}) {
  const definition = metricDefinition(filters.metric);
  const metric = definition.id;
  return {
    metric,
    period: normalizePeriod(metric, filters.period),
    region: normalizeRegion(filters.region),
    sector: normalizeSector(filters.sector),
    band: metric === "production_value_band_count" ? normalizeBand(filters.band) : COMPANY_ATLAS_ALL,
  } as const;
}

export function getCompanyAtlasView(filters: CompanyAtlasFilters = {}): CompanyAtlasView {
  const normalized = normalizeCompanyAtlasFilters(filters);
  const definition = metricById.get(normalized.metric)!;
  const matching = observationsFor(
    normalized.metric,
    normalized.period,
    normalized.region,
    normalized.sector,
    normalized.band,
  );
  const sectorMatching = observationsFor(
    normalized.metric,
    normalized.period,
    normalized.region,
    COMPANY_ATLAS_ALL,
    normalized.band,
  );
  const mapMatching = observationsFor(
    normalized.metric,
    normalized.period,
    COMPANY_ATLAS_ALL,
    normalized.sector,
    normalized.band,
  );
  const valuesByRegion = valuesByCode(mapMatching, "geographyCode");
  const valuesBySector = valuesByCode(sectorMatching, "sectorCode");
  const regionPoints = companyAtlasSnapshot.regions.map((region) => ({
    code: region.code,
    name: region.name,
    value: valuesByRegion.get(region.code) ?? null,
  }));
  const ranking = [...regionPoints].sort((left, right) => (right.value ?? -1) - (left.value ?? -1));
  const sectorBreakdown = companyAtlasSnapshot.sectors
    .map((sector) => ({
      code: sector.code,
      label: sector.label,
      value: valuesBySector.get(sector.code) ?? null,
    }))
    .sort((left, right) => (right.value ?? -1) - (left.value ?? -1));
  const selectedRegion = normalized.region === COMPANY_ATLAS_ALL
    ? null
    : regionPoints.find((region) => region.code === normalized.region) ?? null;
  const selectedSectorLabel = normalized.sector === COMPANY_ATLAS_ALL
    ? "Tutti i settori"
    : sectorByCode.get(normalized.sector)?.label ?? normalized.sector;
  const selectedBandLabel = normalized.band === COMPANY_ATLAS_ALL
    ? "Tutte le fasce"
    : bandByCode.get(normalized.band)?.label ?? normalized.band;

  return {
    metric: normalized.metric,
    metricLabel: definition.label,
    metricUnit: definition.unit,
    metricDescription: definition.description,
    period: normalized.period,
    periodLabel: periodLabel(normalized.metric, normalized.period),
    region: normalized.region,
    sector: normalized.sector,
    band: normalized.band,
    selectedRegion,
    selectedSectorLabel,
    selectedBandLabel,
    nationalValue: valueForObservations(matching),
    regionPoints,
    ranking,
    sectorBreakdown,
    sources: [sourceForMetric(normalized.metric)],
    caveats: caveatsFor(normalized.metric),
    matchedObservationCount: matching.length,
  };
}

function resolveDatasetMetric(dataset: CompanyAtlasDatasetId): CompanyAtlasMetric[] {
  switch (dataset) {
    case "company_active_enterprises":
      return ["active_enterprises"];
    case "company_production_value_bands":
      return ["production_value_band_count"];
    case "company_workforce":
      return ["employees", "active_local_units"];
    default:
      throw new Error(`Dataset business non riconosciuto: ${String(dataset)}.`);
  }
}

function datasetCaveat(dataset: CompanyAtlasDatasetId): string {
  if (dataset === "company_production_value_bands") {
    return "Le fasce indicano il valore della produzione dichiarato nei bilanci depositati; non sono ricavi esatti e non identificano singole aziende.";
  }
  return "Le righe sono aggregati regionali per sezione ATECO 2025; non sono un elenco di aziende e non contengono dati personali.";
}

function filterValueIsAll(value: string | undefined): boolean {
  return value?.trim().toLocaleLowerCase("it-IT") === COMPANY_ATLAS_ALL;
}

function validateCompanyAtlasQueryFilters(
  query: CompanyAtlasDatasetQuery,
  metric: CompanyAtlasMetricId,
  normalized: ReturnType<typeof normalizeCompanyAtlasFilters>,
) {
  if (query.period !== undefined) {
    const period = query.period.trim();
    if (!period || !periodOptions(metric).some((option) => option.id === period)) {
      const available = periodOptions(metric).map((option) => option.id).join(", ");
      throw new Error(`Periodo non disponibile per ${query.dataset}. Periodi validi: ${available}.`);
    }
  }
  if (query.region !== undefined && !filterValueIsAll(query.region) && normalized.region === COMPANY_ATLAS_ALL) {
    throw new Error(`Regione non trovata nell'Atlante Imprese Italia: ${query.region}.`);
  }
  if (query.sector !== undefined && !filterValueIsAll(query.sector) && normalized.sector === COMPANY_ATLAS_ALL) {
    const available = companyAtlasSnapshot.sectors.map((sector) => sector.code).join(", ");
    throw new Error(`Settore ATECO non trovato: ${query.sector}. Codici validi: ${available}.`);
  }
  if (query.band !== undefined && query.dataset !== "company_production_value_bands") {
    throw new Error(`Filtro band non supportato per ${query.dataset}.`);
  }
  if (query.band !== undefined && !filterValueIsAll(query.band) && normalized.band === COMPANY_ATLAS_ALL) {
    const available = companyAtlasSnapshot.productionBands.map((band) => band.code).join(", ");
    throw new Error(`Fascia di valore della produzione non trovata: ${query.band}. Codici validi: ${available}.`);
  }
}

export function queryCompanyAtlasDataset(query: CompanyAtlasDatasetQuery) {
  const metrics = resolveDatasetMetric(query.dataset);
  const metric = metrics[0]!;
  const normalized = normalizeCompanyAtlasFilters({
    metric,
    period: query.period,
    region: query.region,
    sector: query.sector,
    band: query.band,
  });
  validateCompanyAtlasQueryFilters(query, metric, normalized);
  const observations = observationsForMetrics(
    metrics,
    normalized.period,
    normalized.region,
    normalized.sector,
    normalized.band,
  );
  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)));
  const offset = Math.min(100_000, Math.max(0, Math.trunc(query.offset ?? 0)));
  const items = observations.slice(offset, offset + limit);
  const sourceIds = [...new Set(observations.map((observation) => observation.sourceId))];
  return {
    schemaVersion: 1,
    dataset: query.dataset,
    observationType: "aggregate",
    geographyLevel: "region",
    atecoVersion: companyAtlasSnapshot.atecoVersion,
    query: {
      period: normalized.period,
      region: normalized.region,
      sector: normalized.sector,
      band: normalized.band,
    },
    pagination: {
      total: observations.length,
      offset,
      limit,
      returned: items.length,
      hasMore: offset + items.length < observations.length,
      nextOffset: offset + items.length < observations.length ? offset + items.length : null,
    },
    data: items,
    provenance: sourceIds.map((sourceId) => companyAtlasSnapshot.sources[sourceId]),
    caveat: datasetCaveat(query.dataset),
  };
}

export function companyAtlasMetricOptions() {
  return COMPANY_ATLAS_METRICS.map(({ id, label, description }) => ({ id, label, description }));
}

export function companyAtlasPeriodOptions(metric: string | undefined) {
  const normalizedMetric = metricDefinition(metric).id;
  return periodOptions(normalizedMetric);
}

export function companyAtlasRegionOptions() {
  return companyAtlasSnapshot.regions;
}

export function companyAtlasSectorOptions() {
  return companyAtlasSnapshot.sectors;
}

export function companyAtlasBandOptions() {
  return companyAtlasSnapshot.productionBands;
}
