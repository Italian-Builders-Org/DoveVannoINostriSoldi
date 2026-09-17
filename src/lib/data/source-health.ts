import { discoverLatestStatePaymentDataset } from "@/lib/bdap-payments";
import { discoverMopDataset } from "@/lib/bdap-public-works";
import { fetchOfficialSource } from "@/lib/data/source-fetch";
import { ipaRuntimeFetchOptions } from "@/lib/ipa-runtime-fetch";
import {
  ACTIVE_SOURCE_IDS,
  SOURCE_IDS,
  type SourceId,
} from "@/lib/data/source-policy";
import { IPA_ENTI_RESOURCE_ID } from "@/lib/ipa";
import { IPA_AOO_RESOURCE_ID, IPA_UO_RESOURCE_ID } from "@/lib/ipa-structure";
import { getSsnCceSourceHealth } from "@/lib/ssn-cce-snapshot";
import snapshotMetadata from "@/data/generated/source-health-snapshots.json";
import { baseHealth, freshnessFor, type SourceHealth } from "@/lib/data/source-health-common";
export type { SourceHealth, SourceIntegrationState, SourceReachability } from "@/lib/data/source-health-common";

type CkanDatastoreHealthResponse = {
  success?: boolean;
  result?: {
    total?: number;
  };
};

type CkanResourceResponse = {
  success?: boolean;
  result?: {
    last_modified?: unknown;
    metadata_modified?: unknown;
  };
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function unconfiguredOpenCupStorage(): SourceHealth {
  const base = baseHealth("opencup");
  return {
    ...base,
    reachability: base.integration === "active" ? "down" : "not-probed",
    freshness: freshnessFor("opencup", null),
    latencyMs: null,
    detail: "Manifest nazionale OpenCUP non configurato: dati non disponibili.",
    recordCount: null,
  };
}

async function probeOpenCup(signal?: AbortSignal): Promise<SourceHealth> {
  if (!process.env.DVNS_OPENCUP_PROJECTS_MANIFEST) return unconfiguredOpenCupStorage();
  const base = baseHealth("opencup");
  const startedAt = performance.now();
  try {
    const { probeOpenCupRelease } = await import("@/lib/opencup-projects-index");
    const release = await probeOpenCupRelease(signal);
    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("opencup", release.publicationDate),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: release.fixtureOnly
        ? `Fixture sintetica verificata · release ${release.releaseId.slice(0, 12)} · ${release.publicRows} righe · ${release.distinctCups} CUP distinti · copertura nazionale non attiva.`
        : `Manifest e canary verificati · release ${release.releaseId.slice(0, 12)} · ${release.publicRows.toLocaleString("it-IT")} righe · ${release.distinctCups.toLocaleString("it-IT")} CUP distinti${base.integration === "configured" ? " · dataset non ancora attivo" : ""}.`,
      recordCount: release.publicRows,
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("opencup", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : "Artifact OpenCUP non verificabile.",
      recordCount: null,
    };
  }
}

async function getIpaRecordCount(signal?: AbortSignal): Promise<number | null> {
  const url = `https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search?${new URLSearchParams({
    resource_id: IPA_ENTI_RESOURCE_ID,
    limit: "0",
  }).toString()}`;
  const response = await fetchOfficialSource("ipa", url, {
    kind: "discovery",
    headers: { Accept: "application/json" },
    tags: ["health:ipa", "dataset:ipa-enti"],
    ...ipaRuntimeFetchOptions({ signal }),
  });

  if (!response.ok) throw new Error(`IPA datastore HTTP ${response.status}`);
  const payload = (await response.json()) as CkanDatastoreHealthResponse;
  if (!payload.success) throw new Error("Risposta datastore IPA non valida");
  return typeof payload.result?.total === "number" ? payload.result.total : null;
}

async function getIpaResourceTimestamp(signal?: AbortSignal): Promise<string | null> {
  const url = `https://indicepa.gov.it/ipa-dati/api/3/action/resource_show?${new URLSearchParams({
    id: IPA_ENTI_RESOURCE_ID,
  }).toString()}`;
  const response = await fetchOfficialSource("ipa", url, {
    kind: "discovery",
    headers: { Accept: "application/json" },
    tags: ["health:ipa", "metadata:ipa-enti"],
    ...ipaRuntimeFetchOptions({ signal }),
  });

  if (!response.ok) throw new Error(`IPA resource_show HTTP ${response.status}`);
  const payload = (await response.json()) as CkanResourceResponse;
  if (!payload.success || !payload.result) {
    throw new Error("Risposta resource_show IPA non valida");
  }

  return text(payload.result.last_modified) ?? text(payload.result.metadata_modified);
}

async function probeIpa(signal?: AbortSignal): Promise<SourceHealth> {
  const base = baseHealth("ipa");
  const startedAt = performance.now();
  const [countResult, timestampResult] = await Promise.allSettled([
    getIpaRecordCount(signal),
    getIpaResourceTimestamp(signal),
  ]);
  const latencyMs = Math.round(performance.now() - startedAt);

  if (countResult.status === "rejected") {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("ipa", null),
      latencyMs,
      detail:
        countResult.reason instanceof Error
          ? countResult.reason.message
          : "Errore sconosciuto durante il probe IPA",
      recordCount: null,
    };
  }

  const sourceTimestamp =
    timestampResult.status === "fulfilled" ? timestampResult.value : null;
  const metadataDetail =
    timestampResult.status === "rejected"
      ? " · timestamp ufficiale non disponibile"
      : "";

  return {
    ...base,
    reachability: "up",
    freshness: freshnessFor("ipa", sourceTimestamp),
    latencyMs,
    detail: `Data API Enti raggiungibile${metadataDetail}`,
    recordCount: countResult.value,
  };
}

async function getIpaStructureResource(resourceId: string, signal?: AbortSignal): Promise<{
  count: number | null;
  timestamp: string | null;
}> {
  const countUrl = `https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search?${new URLSearchParams({
    resource_id: resourceId,
    limit: "0",
  }).toString()}`;
  const metadataUrl = `https://indicepa.gov.it/ipa-dati/api/3/action/resource_show?${new URLSearchParams({
    id: resourceId,
  }).toString()}`;
  const [countResponse, metadataResponse] = await Promise.all([
    fetchOfficialSource("ipa-struttura", countUrl, {
      kind: "discovery",
      headers: { Accept: "application/json" },
      tags: ["health:ipa-structure", `resource:${resourceId}`],
      ...ipaRuntimeFetchOptions({ signal }),
    }),
    fetchOfficialSource("ipa-struttura", metadataUrl, {
      kind: "discovery",
      headers: { Accept: "application/json" },
      tags: ["health:ipa-structure", `metadata:${resourceId}`],
      ...ipaRuntimeFetchOptions({ signal }),
    }),
  ]);

  if (!countResponse.ok || !metadataResponse.ok) {
    throw new Error(`IPA struttura HTTP ${countResponse.status}/${metadataResponse.status}`);
  }
  const countPayload = (await countResponse.json()) as CkanDatastoreHealthResponse;
  const metadataPayload = (await metadataResponse.json()) as CkanResourceResponse;
  if (!countPayload.success || !metadataPayload.success || !metadataPayload.result) {
    throw new Error("Risposta struttura IPA non valida");
  }
  return {
    count: typeof countPayload.result?.total === "number" ? countPayload.result.total : null,
    timestamp: text(metadataPayload.result.last_modified) ?? text(metadataPayload.result.metadata_modified),
  };
}

async function probeIpaStructure(signal?: AbortSignal): Promise<SourceHealth> {
  const base = baseHealth("ipa-struttura");
  const startedAt = performance.now();
  try {
    const [units, areas] = await Promise.all([
      getIpaStructureResource(IPA_UO_RESOURCE_ID, signal),
      getIpaStructureResource(IPA_AOO_RESOURCE_ID, signal),
    ]);
    const timestamps = [units.timestamp, areas.timestamp].filter((value): value is string => Boolean(value));
    const oldestTimestamp = timestamps.length === 2 ? timestamps.sort().at(0) ?? null : null;
    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("ipa-struttura", oldestTimestamp),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `UO: ${units.count ?? "non disponibile"} · AOO: ${areas.count ?? "non disponibile"}`,
      recordCount: (units.count ?? 0) + (areas.count ?? 0),
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("ipa-struttura", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : "Errore sconosciuto",
      recordCount: null,
    };
  }
}

async function probeOpenBdap(signal?: AbortSignal): Promise<SourceHealth> {
  const base = baseHealth("openbdap");
  const startedAt = performance.now();
  const ssnCce = getSsnCceSourceHealth();

  try {
    const [latest, mop] = await Promise.all([
      discoverLatestStatePaymentDataset("mission", { maxMonthsBack: 6, signal }),
      discoverMopDataset({ signal }),
    ]);
    const timestamps = [latest.metadataModified, mop.metadata.referenceDate]
      .filter((value): value is string => Boolean(value))
      .map((value) => ({ value, time: new Date(value).valueOf() }))
      .filter((entry) => !Number.isNaN(entry.time))
      .sort((left, right) => left.time - right.time);

    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("openbdap", timestamps.at(0)?.value ?? null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `Pagamenti: ${latest.title} · MOP aggiornato al ${mop.metadata.referenceDate} · ${mop.schema.cupCardinality.toLocaleString("it-IT")} CUP distinti · SSN 2024: artifact e 3 input verificati`,
      recordCount: mop.schema.localProjectCardinality,
      snapshot: ssnCce,
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("openbdap", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `${error instanceof Error ? error.message : "Errore sconosciuto"} · SSN 2024: artifact e 3 input verificati`,
      recordCount: null,
      snapshot: ssnCce,
    };
  }
}

async function probeSiope(signal?: AbortSignal): Promise<SourceHealth> {
  const base = baseHealth("siope");
  const startedAt = performance.now();
  const year = new Date().getUTCFullYear();
  try {
    const files = await Promise.all(["USCITE", "ENTRATE"].map(async (flow) => {
      const url = `https://www.siope.it/documenti/siope2/open/last/SIOPE_${flow}.${year}.zip`;
      const response = await fetchOfficialSource("siope", url, {
        kind: "discovery",
        headers: {
          Accept: "application/zip, application/octet-stream;q=0.9, */*;q=0.5",
          Range: "bytes=0-0",
        },
        tags: ["health:siope", `dataset:siope-${flow.toLowerCase()}-${year}`],
        signal,
      });
      const timestamp = response.headers.get("last-modified");
      await response.body?.cancel();
      if (!response.ok) throw new Error(`SIOPE ${flow.toLowerCase()} HTTP ${response.status}`);
      return { flow, timestamp };
    }));
    // Both flows must be reachable; the oldest validator avoids hiding a stale stream.
    const dates = files.map((file) => file.timestamp).filter((date): date is string => date !== null && Number.isFinite(Date.parse(date)));
    const sourceTimestamp = dates.length === files.length
      ? dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null;

    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("siope", sourceTimestamp),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `File nazionali incassi e pagamenti ${year} raggiungibili · ${files.map((file) => `${file.flow.toLowerCase()}: ${file.timestamp ?? "Last-Modified non dichiarato"}`).join(" · ")}. Il monitor verifica i file, non la copertura annuale degli snapshot.`,
      recordCount: null,
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("siope", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : "Errore sconosciuto",
      recordCount: null,
    };
  }
}

const LIVE_ADAPTERS: Partial<Record<SourceId, (signal?: AbortSignal) => Promise<SourceHealth>>> = {
  ipa: probeIpa,
  "ipa-struttura": probeIpaStructure,
  openbdap: probeOpenBdap,
  siope: probeSiope,
  opencup: probeOpenCup,
};

const snapshotById = new Map(snapshotMetadata.map((entry) => [entry.sourceId, entry]));
if (snapshotById.size !== snapshotMetadata.length
  || snapshotMetadata.some((entry) => !SOURCE_IDS.includes(entry.sourceId as SourceId) || LIVE_ADAPTERS[entry.sourceId as SourceId])
  || SOURCE_IDS.some((sourceId) => !LIVE_ADAPTERS[sourceId] && !snapshotById.has(sourceId))) {
  throw new Error("Riepilogo stato fonti incompleto o incoerente con il registro");
}

function snapshotManaged(sourceId: SourceId): SourceHealth {
  const snapshot = snapshotById.get(sourceId);
  if (!snapshot) throw new Error(`Riepilogo snapshot assente: ${sourceId}`);
  return {
    ...baseHealth(sourceId),
    reachability: "not-probed",
    freshness: freshnessFor(sourceId, snapshot.sourceTimestamp),
    latencyMs: null,
    detail: snapshot.detail,
    recordCount: snapshot.recordCount,
  };
}

export function getSnapshotManagedSourceHealth(): SourceHealth[] {
  return SOURCE_IDS.filter((sourceId) => snapshotById.has(sourceId)).map(snapshotManaged);
}

type SourceHealthAdapter = (signal?: AbortSignal) => SourceHealth | Promise<SourceHealth>;
export const SOURCE_HEALTH_ADAPTERS = Object.freeze(Object.fromEntries(
  SOURCE_IDS.map((sourceId) => [sourceId, LIVE_ADAPTERS[sourceId] ?? (() => snapshotManaged(sourceId))]),
) as Record<SourceId, SourceHealthAdapter>);

/** Orders every adapter by the public registry and fails closed on omissions. */
export function orderSourceHealth(entries: readonly SourceHealth[]): SourceHealth[] {
  const bySource = new Map(entries.map((entry) => [entry.sourceId, entry]));
  return ACTIVE_SOURCE_IDS.map((sourceId) => {
    const health = bySource.get(sourceId);
    if (!health) throw new Error(`Adapter operativo senza probe: ${sourceId}`);
    return health;
  });
}

export async function getSourceHealthOverview(
  options: { signal?: AbortSignal; deadlineMs?: number } = {},
): Promise<SourceHealth[]> {
  if (options.deadlineMs !== undefined && (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)) {
    throw new Error("Budget temporale stato fonti non valido");
  }
  const deadline = options.deadlineMs === undefined
    ? undefined
    : AbortSignal.timeout(Math.trunc(options.deadlineMs));
  const signal = options.signal && deadline
    ? AbortSignal.any([options.signal, deadline])
    : options.signal ?? deadline;
  const entries = await Promise.all(ACTIVE_SOURCE_IDS.map((sourceId) => {
    const adapter = SOURCE_HEALTH_ADAPTERS[sourceId] as SourceHealthAdapter | undefined;
    if (!adapter) throw new Error(`Adapter operativo senza probe: ${sourceId}`);
    return adapter(signal);
  }));
  return orderSourceHealth(entries);
}
