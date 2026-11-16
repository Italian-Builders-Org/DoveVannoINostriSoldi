import {
  loadRomaRealtimeVehicles,
  ROMA_OPEN_DATA_URL,
  ROMA_RT_HOLDER,
  ROMA_VEHICLE_POSITIONS_URL,
  type RomaRealtimeUnavailable,
} from "@/lib/mobilita/roma-gtfs-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=20, s-maxage=20, stale-while-revalidate=40";

function unavailable(error: string, status = 502): Response {
  const body: RomaRealtimeUnavailable = {
    status: "unavailable",
    error,
    source: {
      holder: ROMA_RT_HOLDER,
      openDataUrl: ROMA_OPEN_DATA_URL,
      feedUrl: ROMA_VEHICLE_POSITIONS_URL,
    },
    fetchedAt: new Date().toISOString(),
  };
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    const view = await loadRomaRealtimeVehicles();
    return Response.json(view, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream_error";
    if (message.includes("Timeout") || message.includes("abort") || message.includes("TimeoutError")) {
      return unavailable("upstream_timeout", 504);
    }
    return unavailable(message.startsWith("upstream_") ? message : "upstream_error");
  }
}
