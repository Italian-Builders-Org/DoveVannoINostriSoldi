import { classifyRomaFeedFailure } from "@/lib/mobilita/roma-gtfs-realtime";
import {
  loadRomaArrivals,
  punctualitySummary,
  ROMA_TRIP_UPDATES_SOURCE,
  type PunctualitySummary,
} from "@/lib/mobilita/roma-trip-updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Cost model: one public URL, no query parameters read. Same upstream feed and
// CDN window as /arrivals (≤ ~2 upstream reads/min per region), but the
// response is a few hundred bytes, so the live view can show punctuality
// percentages all the time without downloading every predicted arrival.
const CACHE_CONTROL = "public, max-age=10, s-maxage=30, stale-while-revalidate=30";
const INSTANCE_TTL_MS = 20_000;

type PunctualityView = PunctualitySummary & {
  status: "ok";
  source: typeof ROMA_TRIP_UPDATES_SOURCE;
  fetchedAt: string;
  feedTimestamp: number | null;
  stale: boolean;
  fallback?: boolean;
};

let inflight: { at: number; promise: Promise<PunctualityView> } | null = null;

function load(): Promise<PunctualityView> {
  const now = Date.now();
  if (inflight && now - inflight.at < INSTANCE_TTL_MS) return inflight.promise;
  const promise = loadRomaArrivals().then((view) => ({
    status: "ok" as const,
    source: view.source,
    fetchedAt: view.fetchedAt,
    feedTimestamp: view.feedTimestamp,
    stale: view.stale,
    ...(view.fallback ? { fallback: true as const } : {}),
    ...punctualitySummary(view.trips),
  }));
  const entry = { at: now, promise };
  inflight = entry;
  promise.catch(() => {
    if (inflight === entry) inflight = null;
  });
  return promise;
}

function unavailable(failure: ReturnType<typeof classifyRomaFeedFailure>): Response {
  return Response.json(
    {
      status: "unavailable",
      error: failure.code,
      message: failure.message,
      source: ROMA_TRIP_UPDATES_SOURCE,
      fetchedAt: new Date().toISOString(),
    },
    { status: failure.httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  try {
    return Response.json(await load(), { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    return unavailable(classifyRomaFeedFailure(error));
  }
}
