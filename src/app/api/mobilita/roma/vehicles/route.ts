import {
  loadRomaRealtimeVehicles,
  ROMA_RT_SOURCE,
  type RomaRealtimeUnavailable,
  type RomaRealtimeVehiclesView,
} from "@/lib/mobilita/roma-gtfs-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cost model: one public URL, no query parameters read. The upstream feed is
// regenerated about every 30 s and positions are already ~40 s old, so a 15 s
// shared CDN cache bounds upstream fetches to ~4/min per region regardless of
// visitors. Errors are never cached publicly.
const CACHE_CONTROL = "public, max-age=5, s-maxage=15, stale-while-revalidate=30";
const INSTANCE_TTL_MS = 10_000;

// Coalesces concurrent CDN misses that land on the same Fluid instance.
let inflight: { at: number; promise: Promise<RomaRealtimeVehiclesView> } | null = null;

function load(): Promise<RomaRealtimeVehiclesView> {
  const now = Date.now();
  if (inflight && now - inflight.at < INSTANCE_TTL_MS) return inflight.promise;
  const promise = loadRomaRealtimeVehicles();
  const entry = { at: now, promise };
  inflight = entry;
  // A failure must not be served as success to later requests.
  promise.catch(() => {
    if (inflight === entry) inflight = null;
  });
  return promise;
}

function unavailable(error: string, status = 502): Response {
  const body: RomaRealtimeUnavailable = {
    status: "unavailable",
    error,
    source: ROMA_RT_SOURCE,
    fetchedAt: new Date().toISOString(),
  };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const view = await load();
    return Response.json(view, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "TimeoutError" || name === "AbortError") return unavailable("upstream_timeout", 504);
    return unavailable(/^upstream_[a-z0-9_]+$/.test(message) ? message : "upstream_error");
  }
}
