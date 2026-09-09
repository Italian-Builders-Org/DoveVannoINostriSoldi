import { unstable_cache } from "next/cache.js";
import { getSsnNationalHistory, type SsnNationalHistory } from "@/lib/ssn-national-history";
import { getSourcePolicy } from "@/lib/data/source-policy";
import {
  MCP_HISTORY_FAILURE_TTL_SECONDS,
  MCP_HISTORY_POPULATION_TIMEOUT_MS,
  ProcessTtlCache,
  readMcpProcessCached,
  readPersistentOrDirect,
  singleFlight,
  waitForCachedValue,
} from "@/lib/data/live-view-cache";

const OPENBDAP_HISTORY_CACHE_SECONDS = getSourcePolicy("openbdap").dataRevalidateSeconds;

const readCachedSsnHistory = unstable_cache(
  () => getSsnNationalHistory(),
  ["ssn-national-history-v1"],
  { revalidate: OPENBDAP_HISTORY_CACHE_SECONDS, tags: ["openbdap-ssn-history"] },
);

let ssnHistoryInFlight: Promise<SsnNationalHistory> | null = null;
const ssnHistoryProcessCache = new ProcessTtlCache<SsnNationalHistory>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
);

const mcpSsnHistoryProcessCache = new ProcessTtlCache<SsnNationalHistory>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
  { failureTtlSeconds: MCP_HISTORY_FAILURE_TTL_SECONDS },
);

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
