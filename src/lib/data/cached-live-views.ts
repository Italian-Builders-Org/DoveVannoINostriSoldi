import { unstable_cache } from "next/cache.js";
import { getSourceHealthOverview, type SourceHealth } from "@/lib/data/source-health";
import { getSourcePolicy } from "@/lib/data/source-policy";
import {
  getSsnNationalHistory,
  type SsnNationalHistory,
} from "@/lib/ssn-national-history";
import {
  getLegislatureSpendingCycles,
  type LegislatureSpendingCycle,
} from "@/lib/state-spending-legislature";

const SOURCE_HEALTH_CACHE_SECONDS = 300;
const OPENBDAP_HISTORY_CACHE_SECONDS = getSourcePolicy("openbdap").dataRevalidateSeconds;
export const MCP_HISTORY_POPULATION_TIMEOUT_MS = 10_000;
const MCP_HISTORY_FAILURE_TTL_SECONDS = 60;

export type CachedSourceHealthStatus = Readonly<{
  checkedAt: string;
  sources: SourceHealth[];
}>;

async function loadSourceHealthStatus(): Promise<CachedSourceHealthStatus> {
  const sources = await getSourceHealthOverview({ deadlineMs: 6_000 });
  return { checkedAt: new Date().toISOString(), sources };
}

const readCachedSourceHealth = unstable_cache(
  loadSourceHealthStatus,
  ["source-health-overview-v2"],
  { revalidate: SOURCE_HEALTH_CACHE_SECONDS, tags: ["source-health"] },
);

const readCachedSsnHistory = unstable_cache(
  () => getSsnNationalHistory(),
  ["ssn-national-history-v1"],
  { revalidate: OPENBDAP_HISTORY_CACHE_SECONDS, tags: ["openbdap-ssn-history"] },
);

const readCachedLegislatureCycles = unstable_cache(
  () => getLegislatureSpendingCycles(),
  ["state-spending-legislatures-v1"],
  { revalidate: OPENBDAP_HISTORY_CACHE_SECONDS, tags: ["openbdap-legislatures"] },
);

/**
 * Next's persistent Data Cache is the cross-instance guard. These promises also
 * collapse simultaneous misses inside one warm process, so a burst cannot start
 * duplicate multi-file reads before the shared cache entry is populated.
 */
let sourceHealthInFlight: Promise<CachedSourceHealthStatus> | null = null;
let ssnHistoryInFlight: Promise<SsnNationalHistory> | null = null;
let legislatureCyclesInFlight: Promise<LegislatureSpendingCycle[]> | null = null;

type ProcessCacheEntry<T> = Readonly<{ promise: Promise<T>; expiresAt: number }>;

export class ProcessTtlCache<T> {
  readonly #ttlMs: number;
  readonly #failureTtlMs: number;
  #entry: ProcessCacheEntry<T> | null = null;

  constructor(
    ttlSeconds: number,
    { failureTtlSeconds = 0 }: { failureTtlSeconds?: number } = {},
  ) {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error("Process cache TTL must be a positive integer");
    }
    if (!Number.isSafeInteger(failureTtlSeconds) || failureTtlSeconds < 0) {
      throw new Error("Process cache failure TTL must be a non-negative integer");
    }
    this.#ttlMs = ttlSeconds * 1_000;
    this.#failureTtlMs = failureTtlSeconds * 1_000;
  }

  get(loader: () => Promise<T>, now = Date.now()): Promise<T> {
    if (this.#entry && this.#entry.expiresAt > now) return this.#entry.promise;

    const promise = loader();
    const entry = { promise, expiresAt: now + this.#ttlMs };
    this.#entry = entry;
    void promise.catch(() => {
      if (this.#entry !== entry) return;
      this.#entry = this.#failureTtlMs > 0
        ? { promise, expiresAt: Date.now() + this.#failureTtlMs }
        : null;
    });
    return promise;
  }
}

const sourceHealthProcessCache = new ProcessTtlCache<CachedSourceHealthStatus>(
  SOURCE_HEALTH_CACHE_SECONDS,
);
const ssnHistoryProcessCache = new ProcessTtlCache<SsnNationalHistory>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
);
const legislatureCyclesProcessCache = new ProcessTtlCache<LegislatureSpendingCycle[]>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
);
const mcpSsnHistoryProcessCache = new ProcessTtlCache<SsnNationalHistory>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
  { failureTtlSeconds: MCP_HISTORY_FAILURE_TTL_SECONDS },
);
const mcpLegislatureCyclesProcessCache = new ProcessTtlCache<LegislatureSpendingCycle[]>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
  { failureTtlSeconds: MCP_HISTORY_FAILURE_TTL_SECONDS },
);

export async function readPersistentOrDirect<T>(
  cached: () => Promise<T>,
  direct: () => Promise<T>,
): Promise<T> {
  try {
    return await cached();
  } catch (error) {
    // Direct Node consumers (source-verification tests and scripts) do not
    // install Next's request cache. They still receive the same bounded data,
    // while App Router requests retain the persistent cross-instance cache.
    if (
      error instanceof Error
      && error.message.startsWith("Invariant: incrementalCache missing in unstable_cache")
    ) {
      return direct();
    }
    throw error;
  }
}

function singleFlight<T>(
  current: Promise<T> | null,
  setCurrent: (value: Promise<T> | null) => void,
  loader: () => Promise<T>,
): Promise<T> {
  if (current) return current;
  const pending = loader();
  setCurrent(pending);
  void pending.finally(() => {
    setCurrent(null);
  }).catch(() => undefined);
  return pending;
}

function waitForCachedValue<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  const abortReason = () => signal.reason ?? new DOMException("Request aborted", "AbortError");
  if (signal.aborted) return Promise.reject(abortReason());

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function readMcpProcessCached<T>(
  cache: ProcessTtlCache<T>,
  callerSignal: AbortSignal | undefined,
  loader: (populationSignal: AbortSignal) => Promise<T>,
  populationTimeoutMs = MCP_HISTORY_POPULATION_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isSafeInteger(populationTimeoutMs) || populationTimeoutMs < 1) {
    throw new Error("MCP history population timeout must be a positive integer");
  }
  const population = cache.get(
    () => loader(AbortSignal.timeout(populationTimeoutMs)),
  );
  return waitForCachedValue(population, callerSignal);
}

export function getCachedSourceHealthOverview(): Promise<CachedSourceHealthStatus> {
  return singleFlight(
    sourceHealthInFlight,
    (value) => { sourceHealthInFlight = value; },
    () => readPersistentOrDirect(
      readCachedSourceHealth,
      () => sourceHealthProcessCache.get(loadSourceHealthStatus),
    ),
  );
}

export function getCachedSsnNationalHistory(
  options: { signal?: AbortSignal } = {},
): Promise<SsnNationalHistory> {
  const promise = singleFlight(
    ssnHistoryInFlight,
    (value) => { ssnHistoryInFlight = value; },
    () => readPersistentOrDirect(
      readCachedSsnHistory,
      () => ssnHistoryProcessCache.get(getSsnNationalHistory),
    ),
  );
  return waitForCachedValue(promise, options.signal);
}

export function getMcpCachedSsnNationalHistory(
  options: { signal?: AbortSignal } = {},
): Promise<SsnNationalHistory> {
  return readMcpProcessCached(
    mcpSsnHistoryProcessCache,
    options.signal,
    (signal) => getSsnNationalHistory({ signal, deadlineMs: MCP_HISTORY_POPULATION_TIMEOUT_MS }),
  );
}

export function getCachedLegislatureSpendingCycles(
  options: { signal?: AbortSignal } = {},
): Promise<LegislatureSpendingCycle[]> {
  const promise = singleFlight(
    legislatureCyclesInFlight,
    (value) => { legislatureCyclesInFlight = value; },
    () => readPersistentOrDirect(
      readCachedLegislatureCycles,
      () => legislatureCyclesProcessCache.get(getLegislatureSpendingCycles),
    ),
  );
  return waitForCachedValue(promise, options.signal);
}

export function getMcpCachedLegislatureSpendingCycles(
  options: { signal?: AbortSignal } = {},
): Promise<LegislatureSpendingCycle[]> {
  return readMcpProcessCached(
    mcpLegislatureCyclesProcessCache,
    options.signal,
    (signal) => getLegislatureSpendingCycles({
      signal,
      deadlineMs: MCP_HISTORY_POPULATION_TIMEOUT_MS,
    }),
  );
}
