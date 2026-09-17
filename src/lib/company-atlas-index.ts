import "server-only";

import type {
  CompanyAtlasMetric,
  CompanyAtlasObservation,
} from "@/lib/company-atlas-contract";

const INDEX_SEPARATOR = "\u001f";
const ALL = "all";
const EMPTY_BUCKET: ObservationBucket = Object.freeze([]);

type ObservationBucket = readonly CompanyAtlasObservation[];

type BucketMap = Map<string, CompanyAtlasObservation[]>;

export type CompanyAtlasObservationIndex = Readonly<{
  select: (
    metric: CompanyAtlasMetric,
    period: string,
    region: string,
    sector: string,
    band: string,
  ) => ObservationBucket;
  selectMany: (
    metrics: readonly CompanyAtlasMetric[],
    period: string,
    region: string,
    sector: string,
    band: string,
  ) => ObservationBucket;
}>;

function key(...parts: string[]): string {
  return parts.join(INDEX_SEPARATOR);
}

function add(map: BucketMap, bucketKey: string, observation: CompanyAtlasObservation): void {
  const bucket = map.get(bucketKey);
  if (bucket) {
    bucket.push(observation);
  } else {
    map.set(bucketKey, [observation]);
  }
}

function freezeBuckets(map: BucketMap): void {
  for (const bucket of map.values()) Object.freeze(bucket);
}

/**
 * Build deterministic lookup buckets once for the immutable generated
 * snapshot. Each query then selects the narrowest applicable bucket instead
 * of scanning every observation for every filter and every chart series.
 */
export function createCompanyAtlasObservationIndex(
  observations: readonly CompanyAtlasObservation[],
): CompanyAtlasObservationIndex {
  const byMetricPeriod: BucketMap = new Map();
  const byRegion: BucketMap = new Map();
  const bySector: BucketMap = new Map();
  const byBand: BucketMap = new Map();
  const byRegionSector: BucketMap = new Map();
  const byRegionBand: BucketMap = new Map();
  const bySectorBand: BucketMap = new Map();
  const byExact: BucketMap = new Map();
  const observationOrder = new Map<CompanyAtlasObservation, number>();

  for (const [index, observation] of observations.entries()) {
    observationOrder.set(observation, index);
    const metricPeriod = key(observation.metric, observation.period);
    const region = observation.geographyCode;
    const sector = observation.sectorCode;
    const band = observation.bandCode ?? ALL;

    add(byMetricPeriod, metricPeriod, observation);
    add(byRegion, key(metricPeriod, region), observation);
    add(bySector, key(metricPeriod, sector), observation);
    add(byBand, key(metricPeriod, band), observation);
    add(byRegionSector, key(metricPeriod, region, sector), observation);
    add(byRegionBand, key(metricPeriod, region, band), observation);
    add(bySectorBand, key(metricPeriod, sector, band), observation);
    add(byExact, key(metricPeriod, region, sector, band), observation);
  }

  for (const map of [
    byMetricPeriod,
    byRegion,
    bySector,
    byBand,
    byRegionSector,
    byRegionBand,
    bySectorBand,
    byExact,
  ]) {
    freezeBuckets(map);
  }

  function select(
    metric: CompanyAtlasMetric,
    period: string,
    region: string,
    sector: string,
    band: string,
  ): ObservationBucket {
    const metricPeriod = key(metric, period);
    if (region !== ALL && sector !== ALL && band !== ALL) {
      return byExact.get(key(metricPeriod, region, sector, band)) ?? EMPTY_BUCKET;
    }
    if (region !== ALL && sector !== ALL) {
      return byRegionSector.get(key(metricPeriod, region, sector)) ?? EMPTY_BUCKET;
    }
    if (region !== ALL && band !== ALL) {
      return byRegionBand.get(key(metricPeriod, region, band)) ?? EMPTY_BUCKET;
    }
    if (sector !== ALL && band !== ALL) {
      return bySectorBand.get(key(metricPeriod, sector, band)) ?? EMPTY_BUCKET;
    }
    if (region !== ALL) return byRegion.get(key(metricPeriod, region)) ?? EMPTY_BUCKET;
    if (sector !== ALL) return bySector.get(key(metricPeriod, sector)) ?? EMPTY_BUCKET;
    if (band !== ALL) return byBand.get(key(metricPeriod, band)) ?? EMPTY_BUCKET;
    return byMetricPeriod.get(metricPeriod) ?? EMPTY_BUCKET;
  }

  return Object.freeze({
    select,
    selectMany(metrics, period, region, sector, band) {
      const selected = metrics.flatMap((metric) => select(metric, period, region, sector, band));
      if (metrics.length < 2 || selected.length < 2) return selected;
      return [...selected].sort((left, right) => observationOrder.get(left)! - observationOrder.get(right)!);
    },
  });
}
