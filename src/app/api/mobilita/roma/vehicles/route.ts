import { loadRomaRealtimeVehiclesCoalesced } from "@/lib/mobilita/roma-vehicles-shared";
import {
  ROMA_RT_SOURCE,
  type RomaRealtimeUnavailable,
} from "@/lib/mobilita/roma-gtfs-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Headroom above FETCH_TIMEOUT_MS (15 s) and a single retry on transient errors.
export const maxDuration = 30;

// Cost model: one public URL, no query parameters read. The upstream feed is
// regenerated about every 30 s and positions are already ~40 s old, so a 15 s
// shared CDN cache bounds upstream fetches to ~4/min per region regardless of
// visitors. Errors are never cached publicly.
const CACHE_CONTROL = "public, max-age=5, s-maxage=15, stale-while-revalidate=30";

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
    const view = await loadRomaRealtimeVehiclesCoalesced();
    return Response.json(view, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "TimeoutError" || name === "AbortError") return unavailable("upstream_timeout", 504);
    return unavailable(/^upstream_[a-z0-9_]+$/.test(message) ? message : "upstream_error");
  }
}
