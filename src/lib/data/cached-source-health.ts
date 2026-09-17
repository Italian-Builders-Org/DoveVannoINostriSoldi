import { unstable_cache } from "next/cache.js";
import type { SourceHealth } from "@/lib/data/source-health";
import { ProcessTtlCache, readPersistentOrDirect, singleFlight } from "@/lib/data/live-view-cache";

const SOURCE_HEALTH_CACHE_SECONDS = 300;

export type CachedSourceHealthStatus = Readonly<{
  checkedAt: string;
  sources: SourceHealth[];
}>;

async function loadSourceHealthStatus(): Promise<CachedSourceHealthStatus> {
  // Il budget include il caricamento e la validazione degli snapshot. Una cache
  // persistente disponibile evita anche questo costo all'avvio della funzione.
  const signal = AbortSignal.timeout(4_000);
  const { getSourceHealthOverview } = await import("@/lib/data/source-health");
  const sources = await getSourceHealthOverview({ signal });
  return { checkedAt: new Date().toISOString(), sources };
}

const readCachedSourceHealth = unstable_cache(
  loadSourceHealthStatus,
  ["source-health-overview-v2"],
  { revalidate: SOURCE_HEALTH_CACHE_SECONDS, tags: ["source-health"] },
);

let sourceHealthInFlight: Promise<CachedSourceHealthStatus> | null = null;
const sourceHealthProcessCache = new ProcessTtlCache<CachedSourceHealthStatus>(
  SOURCE_HEALTH_CACHE_SECONDS,
);

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
