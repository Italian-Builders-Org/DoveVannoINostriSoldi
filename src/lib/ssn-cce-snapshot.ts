import { createHash } from "node:crypto";
import rawSnapshot from "@/data/generated/ssn-cce-2024.json";
import {
  SSN_CCE_METRICS,
  validateSsnCceSnapshot,
  type SsnCceMetricId,
  type SsnCceSnapshot,
} from "@/lib/data/ssn-cce-contract";

const SSN_CCE_ARTIFACT_INTEGRITY = Object.freeze({
  bytes: 126_487,
  sha256: "83475a59d4afc9555420f8abbddd89ec818cc56cb1cab73b18fb15303c7e1d9c",
  lockSha256: "8c8057b9c8dbff29223e11f9f7d78811cf5140ea4f1f8595fdfbc78da9fe5c3a",
});

// The ETL writes canonical compact JSON plus one trailing newline. Keep the
// byte-level binding here so a reformatted or replaced artifact fails closed
// before any page, API route, or MCP tool can expose it.
const serializedSnapshot = `${JSON.stringify(rawSnapshot)}\n`;
const actualArtifactIntegrity = {
  bytes: Buffer.byteLength(serializedSnapshot, "utf8"),
  sha256: createHash("sha256").update(serializedSnapshot, "utf8").digest("hex"),
};
if (
  actualArtifactIntegrity.bytes !== SSN_CCE_ARTIFACT_INTEGRITY.bytes ||
  actualArtifactIntegrity.sha256 !== SSN_CCE_ARTIFACT_INTEGRITY.sha256
) {
  throw new Error(
    `Artifact SSN Conto Economico non riconosciuto: ${actualArtifactIntegrity.bytes} byte / ${actualArtifactIntegrity.sha256}`,
  );
}

export const ssnCceSnapshot = validateSsnCceSnapshot(rawSnapshot as SsnCceSnapshot);

export type SsnCceSourceDatasetHealth = Readonly<{
  datasetId: string;
  sourceUrl: string;
  landingUrl: string;
  expectedRows: number;
  sourceBytes: number;
  sourceSha256: string;
  status: "verified";
}>;

export type SsnCceSourceHealth = Readonly<{
  status: "verified";
  check: "offline-source-lock-and-snapshot-contract";
  runtimeFetch: false;
  artifact: Readonly<{
    schemaVersion: typeof ssnCceSnapshot.schemaVersion;
    bytes: number;
    sha256: string;
    lockSha256: string;
  }>;
  datasets: Readonly<{
    entities: SsnCceSourceDatasetHealth;
    national: SsnCceSourceDatasetHealth;
    regional: SsnCceSourceDatasetHealth;
  }>;
}>;

function sourceDatasetHealth(
  sourceUrl: string,
  dataset: {
    datasetId: string;
    landingUrl: string;
    expectedRows: number;
    sourceBytes: number;
    sourceSha256: string;
  },
): SsnCceSourceDatasetHealth {
  return {
    datasetId: dataset.datasetId,
    sourceUrl,
    landingUrl: dataset.landingUrl,
    expectedRows: dataset.expectedRows,
    sourceBytes: dataset.sourceBytes,
    sourceSha256: dataset.sourceSha256,
    status: "verified",
  };
}

/**
 * Runtime health for the managed SSN snapshot. It describes the three
 * version-pinned official inputs; it never fetches or silently refreshes them.
 */
export function getSsnCceSourceHealth(): SsnCceSourceHealth {
  const { datasets } = ssnCceSnapshot.source;
  return {
    status: "verified",
    check: "offline-source-lock-and-snapshot-contract",
    runtimeFetch: false,
    artifact: {
      schemaVersion: ssnCceSnapshot.schemaVersion,
      ...SSN_CCE_ARTIFACT_INTEGRITY,
    },
    datasets: {
      entities: sourceDatasetHealth(datasets.entities.csvUrl, datasets.entities),
      national: sourceDatasetHealth(datasets.national.odataUrl, datasets.national),
      regional: sourceDatasetHealth(datasets.regional.odataUrl, datasets.regional),
    },
  };
}

export type SsnCceQuery = {
  year?: number;
  region?: string;
  code?: string;
  limit?: number;
  offset?: number;
};

export class SsnCceQueryError extends Error {
  code: "invalid_query" | "not_found";

  constructor(code: "invalid_query" | "not_found", message: string) {
    super(message);
    this.name = "SsnCceQueryError";
    this.code = code;
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SsnCceQueryError("invalid_query", "Il filtro di paginazione non è valido.");
  }
  return value;
}

function valuesFor(items: typeof ssnCceSnapshot.entities, metric: SsnCceMetricId) {
  return items.map((item) => ({
    id: item.id,
    regionCode: item.regionCode,
    region: item.region,
    codeBdap: item.codeBdap,
    codeSsn: item.codeSsn,
    name: item.name,
    amountCents: item.values[metric],
    missing: item.missing[metric] === 1,
  }));
}

export function querySsnCce(query: SsnCceQuery = {}) {
  if (query.year !== undefined && query.year !== ssnCceSnapshot.referenceYear) {
    throw new SsnCceQueryError(
      "not_found",
      `Il dataset SSN Conto Economico è disponibile solo per il ${ssnCceSnapshot.referenceYear}.`,
    );
  }
  if (query.region !== undefined && query.region.trim().length === 0) {
    throw new SsnCceQueryError("invalid_query", "Il filtro regione non può essere vuoto.");
  }
  if (query.code !== undefined && query.code.trim().length === 0) {
    throw new SsnCceQueryError("invalid_query", "Il filtro code non può essere vuoto.");
  }
  const limit = bounded(query.limit, 50, 1, 100);
  const offset = bounded(query.offset, 0, 0, 100_000);
  const region = query.region ? normalize(query.region) : null;
  const code = query.code?.trim() ?? null;
  const entities = ssnCceSnapshot.entities.filter((item) =>
    (!region || normalize(item.region) === region) && (!code || item.codeBdap === code || item.codeSsn === code || item.id === code),
  );
  if ((region || code) && entities.length === 0) {
    throw new SsnCceQueryError("not_found", "Nessun ente SSN corrisponde ai filtri richiesti.");
  }
  const selectedRegionCodes = code
    ? new Set(entities.map((item) => item.regionCode))
    : null;
  const selectedRegions = region
    ? ssnCceSnapshot.regions.filter((item) => normalize(item.name) === region)
    : selectedRegionCodes
      ? ssnCceSnapshot.regions.filter((item) => selectedRegionCodes.has(item.code))
      : ssnCceSnapshot.regions;
  if (region && selectedRegions.length === 0) {
    throw new SsnCceQueryError("not_found", `Regione non disponibile: ${query.region}.`);
  }
  const selectedEntities = code ? entities : entities.filter((item) => !region || normalize(item.region) === region);
  const data = selectedEntities.slice(offset, offset + limit);
  return {
    query: {
      year: ssnCceSnapshot.referenceYear,
      region: region ? selectedRegions[0]?.name ?? null : null,
      code,
    },
    selectedAggregate: code
      ? {
          level: "entity_match" as const,
          code: null,
          name: null,
          values: null,
          contextRegion:
            selectedRegions.length === 1
              ? { code: selectedRegions[0].code, name: selectedRegions[0].name }
              : null,
        }
      : region
        ? {
            level: "region" as const,
            code: selectedRegions[0]?.code ?? null,
            name: selectedRegions[0]?.name ?? null,
            values: selectedRegions[0]?.values ?? null,
          }
        : {
            level: "national" as const,
            code: null,
            name: "Italia",
            values: ssnCceSnapshot.national.values,
          },
    referenceYear: ssnCceSnapshot.referenceYear,
    observation: ssnCceSnapshot.observation,
    metrics: ssnCceSnapshot.metrics,
    national: ssnCceSnapshot.national,
    regions: selectedRegions,
    pagination: { total: selectedEntities.length, offset, limit, returned: data.length },
    entities: data,
    coverage: ssnCceSnapshot.coverage,
    methodology: ssnCceSnapshot.methodology,
    provenance: ssnCceSnapshot.source,
  };
}

export function querySsnCceMetric(
  query: SsnCceQuery & { metric?: SsnCceMetricId } = {},
) {
  const metric = query.metric ?? "personnelCost";
  if (!SSN_CCE_METRICS.includes(metric)) {
    throw new SsnCceQueryError("invalid_query", `Metrica SSN non supportata: ${metric}.`);
  }
  const normalizedCode = query.code?.trim() ?? null;
  const base = querySsnCce({ ...query, code: normalizedCode ?? undefined });
  const selectedEntities = ssnCceSnapshot.entities.filter((item) =>
    (!query.region || normalize(item.region) === normalize(query.region)) &&
    (!normalizedCode || item.codeBdap === normalizedCode || item.codeSsn === normalizedCode || item.id === normalizedCode),
  );
  const limit = bounded(query.limit, 50, 1, 100);
  const offset = bounded(query.offset, 0, 0, 100_000);
  return {
    ...base,
    metric,
    values: valuesFor(selectedEntities.slice(offset, offset + limit), metric),
    total: selectedEntities.length,
  };
}
