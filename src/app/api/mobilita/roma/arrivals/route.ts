import { loadRomaArrivals, ROMA_TRIP_UPDATES_SOURCE, type RomaArrivalsView } from "@/lib/mobilita/roma-trip-updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cost model: one public URL, no query parameters read (no per-stop or
// per-trip URLs to multiply cache entries). The upstream TripUpdates feed is
// ~0.9 MB and parses in ~100 ms, so the shared CDN cache is longer than for
// positions: at most ~2 upstream reads/min per region. The client asks for it
// only while a bus is followed, a stop board is open or delay colours are on.
const CACHE_CONTROL = "public, max-age=10, s-maxage=30, stale-while-revalidate=30";
const INSTANCE_TTL_MS = 20_000;

let inflight: { at: number; promise: Promise<RomaArrivalsView> } | null = null;

function load(): Promise<RomaArrivalsView> {
  const now = Date.now();
  if (inflight && now - inflight.at < INSTANCE_TTL_MS) return inflight.promise;
  const promise = loadRomaArrivals();
  const entry = { at: now, promise };
  inflight = entry;
  promise.catch(() => {
    if (inflight === entry) inflight = null;
  });
  return promise;
}

function unavailable(error: string, status = 502): Response {
  return Response.json(
    { status: "unavailable", error, source: ROMA_TRIP_UPDATES_SOURCE, fetchedAt: new Date().toISOString() },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  try {
    return Response.json(await load(), { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "TimeoutError" || name === "AbortError") return unavailable("upstream_timeout", 504);
    return unavailable(/^upstream_[a-z0-9_]+$/.test(message) ? message : "upstream_error");
  }
}
