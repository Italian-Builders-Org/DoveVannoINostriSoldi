import { unstable_cache } from "next/cache.js";
import { getSourceHealthOverview, type SourceHealth } from "@/lib/data/source-health";
import { ProcessTtlCache, readPersistentOrDirect, singleFlight } from "@/lib/data/live-view-cache";

const SOURCE_HEALTH_CACHE_SECONDS = 300;

export type CachedSourceHealthStatus = Readonly<{
  checkedAt: string;
  sources: SourceHealth[];
}>;

async function loadSourceHealthStatus(): Promise<CachedSourceHealthStatus> {
  // Termina i probe entro la scadenza API di 6 secondi: le fonti interrotte
  // producono un esito nel registro, senza causare un timeout HTTP della route.
  const sources = await getSourceHealthOverview({ deadlineMs: 4_000 });
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
