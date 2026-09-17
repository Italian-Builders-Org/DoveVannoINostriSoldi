import {
  computeSpendingOutliers,
  type SpendingOutlierSummary,
} from "@/lib/anomaly-indicators";
import type { OpenCivitasMunicipality } from "@/lib/data/opencivitas-contract";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";

const municipalitiesByRegion = new Map<string, OpenCivitasMunicipality[]>();
for (const municipality of openCivitasSnapshot.municipalities) {
  const bucket = municipalitiesByRegion.get(municipality.region) ?? [];
  bucket.push(municipality);
  municipalitiesByRegion.set(municipality.region, bucket);
}

export const openCivitasSpendingOutliers = computeSpendingOutliers(
  openCivitasSnapshot.municipalities,
);

function getOpenCivitasSpendingOutliers(region: string | null): SpendingOutlierSummary | null {
  if (region === null) return openCivitasSpendingOutliers;
  const municipalities = municipalitiesByRegion.get(region);
  return municipalities ? computeSpendingOutliers(municipalities) : null;
}

export class OpenCivitasOutlierQueryError extends Error {}

type OpenCivitasOutlierQuery = {
  year?: number;
  region?: string;
  limit?: number;
  offset?: number;
};

function boundedInteger(
  value: number | undefined,
  field: "limit" | "offset",
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new OpenCivitasOutlierQueryError(
      `${field}: valore ammesso da ${minimum} a ${maximum}`,
    );
  }
  return value;
}

export function queryOpenCivitasSpendingOutliers(query: OpenCivitasOutlierQuery = {}) {
  const year = query.year ?? openCivitasSnapshot.referenceYear;
  if (year !== openCivitasSnapshot.referenceYear) {
    throw new OpenCivitasOutlierQueryError(
      `OpenCivitas è disponibile per il ${openCivitasSnapshot.referenceYear}.`,
    );
  }

  const limit = boundedInteger(query.limit, "limit", 50, 1, 100);
  const offset = boundedInteger(query.offset, "offset", 0, 0, 100_000);
  const normalizedRegion = query.region?.trim().toLocaleUpperCase("it-IT") ?? null;
  if (query.region !== undefined && !normalizedRegion) {
    throw new OpenCivitasOutlierQueryError("regione: testo non vuoto atteso");
  }

  const summary = getOpenCivitasSpendingOutliers(normalizedRegion);
  if (!summary) {
    throw new OpenCivitasOutlierQueryError(
      `Territorio OpenCivitas non disponibile: ${normalizedRegion}.`,
    );
  }

  const outliers = summary.outliers.slice(offset, offset + limit);
  return {
    ...summary,
    outliers,
    filters: { year, region: normalizedRegion, limit, offset },
    pagination: {
      total: summary.outliers.length,
      offset,
      limit,
      returned: outliers.length,
      hasMore: offset + outliers.length < summary.outliers.length,
    },
    period: {
      referenceYear: openCivitasSnapshot.referenceYear,
      publishedAt: openCivitasSnapshot.publishedAt,
      observedAt: openCivitasSnapshot.source.observedAt,
    },
    provenance: {
      generatedAt: openCivitasSnapshot.generatedAt,
      source: openCivitasSnapshot.source,
      territorialScope: openCivitasSnapshot.coverage.territorialScope,
    },
    warnings: [
      summary.methodologyWarning,
      summary.populationMethodWarning,
      openCivitasSnapshot.methodology.coverageWarning,
      openCivitasSnapshot.methodology.rankingWarning,
    ],
  };
}
