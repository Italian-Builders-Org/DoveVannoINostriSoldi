import { unstable_cache } from "next/cache.js";
import { getLegislatureSpendingCycles, type LegislatureSpendingCycle } from "@/lib/state-spending-legislature";
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

const readCachedLegislatureCycles = unstable_cache(
  () => getLegislatureSpendingCycles(),
  ["state-spending-legislatures-v2"],
  { revalidate: OPENBDAP_HISTORY_CACHE_SECONDS, tags: ["openbdap-legislatures"] },
);

let legislatureCyclesInFlight: Promise<LegislatureSpendingCycle[]> | null = null;
const legislatureCyclesProcessCache = new ProcessTtlCache<LegislatureSpendingCycle[]>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
);

const mcpLegislatureCyclesProcessCache = new ProcessTtlCache<LegislatureSpendingCycle[]>(
  OPENBDAP_HISTORY_CACHE_SECONDS,
  { failureTtlSeconds: MCP_HISTORY_FAILURE_TTL_SECONDS },
);

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
