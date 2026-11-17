/**
 * Roma Mobilità GTFS-RT VehiclePositions: fetch boundary and a minimal,
 * spec-numbered protobuf reader (no dependency, no generated code).
 *
 * Field numbers follow gtfs-realtime.proto 2.0:
 * FeedMessage{1 header, 2 entity}; FeedHeader{3 timestamp};
 * FeedEntity{1 id, 4 vehicle}; VehiclePosition{1 trip, 2 position,
 * 3 current_stop_sequence, 4 current_status, 5 timestamp, 7 stop_id,
 * 8 vehicle, 9 occupancy_status}; TripDescriptor{1 trip_id, 2 start_time,
 * 5 route_id, 6 direction_id}; VehicleDescriptor{1 id, 2 label};
 * Position{1 latitude, 2 longitude, 3 bearing}.
 */
import { fields, readBytes, readFloat32, readHeaderTimestamp, readVarint, text } from "@/lib/mobilita/protobuf-wire";

export const ROMA_VEHICLE_POSITIONS_URL =
  "https://romamobilita.it/wp-content/uploads/shared/rome_rtgtfs_vehicle_positions_feed.pb";

export const ROMA_OPEN_DATA_URL = "https://romamobilita.it/sistemi-e-tecnologie/open-data/";

export const ROMA_RT_HOLDER = "Roma Servizi per la Mobilità (ATAC e Roma TPL)";

/** A feed older than this is shown as not current instead of "live". */
export const ROMA_FEED_STALE_SECONDS = 300;

export const MAX_FEED_BYTES = 5_000_000;
export const FETCH_TIMEOUT_MS = 14_000;

/** Hard ceiling for one upstream read (timeout + at most one retry) under route maxDuration. */
export const FEED_FETCH_BUDGET_MS = 28_000;

/** Upstream read ceiling for mobilita_roma_bus_live (below the MCP handler deadline). */
export const MCP_VEHICLES_FEED_FETCH_BUDGET_MS = 10_000;

/** Reuse the last successful in-memory snapshot after upstream failure for this long. */
export const LAST_GOOD_SNAPSHOT_MS = 5 * 60 * 1000;

// Generous box around Roma Capitale and the lines that leave it; drops (0,0)
// placeholders and corrupt coordinates without hiding suburban termini.
const AREA = { minLat: 41.4, maxLat: 42.4, minLon: 11.9, maxLon: 13.1 };

export type RomaVehicleStatus = "incoming" | "stopped" | "in_transit";

export type RomaRealtimeVehicle = {
  /** VehicleDescriptor.id, falling back to the entity id. */
  id: string;
  /** Fleet number shown on the bus (VehicleDescriptor.label). */
  label?: string;
  tripId?: string;
  routeId?: string;
  directionId?: 0 | 1;
  /** Scheduled start of the trip, HH:MM:SS as published. */
  startTime?: string;
  lat: number;
  lon: number;
  bearing?: number;
  /** Unix seconds of the position fix. */
  ts?: number;
  /** Stop the vehicle is at or heading to (current_status qualifies it). */
  stopId?: string;
  status?: RomaVehicleStatus;
  /** GTFS-RT OccupancyStatus enum (0 empty … 6 full / not accepting). */
  occupancy?: number;
};

type Source = { holder: string; openDataUrl: string; feedUrl: string };

export type RomaRealtimeVehiclesView = {
  status: "ok";
  source: Source;
  fetchedAt: string;
  feedTimestamp: number | null;
  /** Seconds between feed header timestamp and fetch; null without header. */
  feedAgeSeconds: number | null;
  stale: boolean;
  /** True when positions come from the in-memory snapshot after an upstream failure. */
  fallback?: boolean;
  vehicleCount: number;
  vehicles: RomaRealtimeVehicle[];
};

export type RomaRealtimeUnavailable = {
  status: "unavailable";
  error: string;
  message: string;
  source: Source;
  fetchedAt: string;
};

/** Maps a loader failure to stable error codes, HTTP status and user-facing copy. */
export function classifyRomaFeedFailure(error: unknown): {
  code: string;
  httpStatus: number;
  message: string;
} {
  const name = error instanceof Error ? error.name : "";
  const text = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || name === "AbortError" || text === "upstream_timeout") {
    return {
      code: "upstream_timeout",
      httpStatus: 504,
      message: "Il feed ATAC è lento a rispondere.",
    };
  }
  if (/^upstream_[a-z0-9_]+$/.test(text)) {
    return {
      code: text,
      httpStatus: 502,
      message: "Il feed ATAC non è raggiungibile in questo momento.",
    };
  }
  return {
    code: "upstream_error",
    httpStatus: 502,
    message: "Il feed ATAC non è raggiungibile in questo momento.",
  };
}

export const ROMA_RT_SOURCE: Source = {
  holder: ROMA_RT_HOLDER,
  openDataUrl: ROMA_OPEN_DATA_URL,
  feedUrl: ROMA_VEHICLE_POSITIONS_URL,
};

export const ROMA_RT_USER_AGENT = "DoveVannoINostriSoldi/1.0 (+https://www.dovevannoinostrisoldi.com; mobilita-roma-rt)";

function decodeTrip(buffer: Uint8Array) {
  const trip: Pick<RomaRealtimeVehicle, "tripId" | "routeId" | "directionId" | "startTime"> = {};
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 2) trip.tripId = text(readBytes(buffer, at));
    else if (field === 2 && wire === 2) trip.startTime = text(readBytes(buffer, at));
    else if (field === 5 && wire === 2) trip.routeId = text(readBytes(buffer, at));
    else if (field === 6 && wire === 0) {
      const direction = readVarint(buffer, at);
      if (direction === 0 || direction === 1) trip.directionId = direction;
    }
  }
  return trip;
}

function decodeDescriptor(buffer: Uint8Array) {
  const descriptor: { id?: string; label?: string } = {};
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 2) descriptor.id = text(readBytes(buffer, at));
    else if (field === 2 && wire === 2) descriptor.label = text(readBytes(buffer, at));
  }
  return descriptor;
}

function decodePosition(buffer: Uint8Array) {
  const position: { lat?: number; lon?: number; bearing?: number } = {};
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 5) position.lat = readFloat32(buffer, at);
    else if (field === 2 && wire === 5) position.lon = readFloat32(buffer, at);
    else if (field === 3 && wire === 5) position.bearing = readFloat32(buffer, at);
  }
  return position;
}

const STATUS: Record<number, RomaVehicleStatus> = {
  0: "incoming",
  1: "stopped",
  2: "in_transit",
};

function inArea(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= AREA.minLat &&
    lat <= AREA.maxLat &&
    lon >= AREA.minLon &&
    lon <= AREA.maxLon
  );
}

function decodeVehiclePosition(buffer: Uint8Array, entityId: string): RomaRealtimeVehicle | null {
  let trip: ReturnType<typeof decodeTrip> = {};
  let position: ReturnType<typeof decodePosition> = {};
  let descriptor: ReturnType<typeof decodeDescriptor> = {};
  let ts: number | undefined;
  let status: RomaVehicleStatus | undefined;
  let stopId: string | undefined;
  let occupancy: number | undefined;
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 2) trip = decodeTrip(readBytes(buffer, at));
    else if (field === 2 && wire === 2) position = decodePosition(readBytes(buffer, at));
    else if (field === 4 && wire === 0) status = STATUS[readVarint(buffer, at)];
    else if (field === 5 && wire === 0) ts = readVarint(buffer, at);
    else if (field === 7 && wire === 2) stopId = text(readBytes(buffer, at));
    else if (field === 8 && wire === 2) descriptor = decodeDescriptor(readBytes(buffer, at));
    else if (field === 9 && wire === 0) occupancy = readVarint(buffer, at);
  }
  if (!inArea(position.lat, position.lon)) return null;
  const vehicle: RomaRealtimeVehicle = {
    id: descriptor.id || entityId,
    lat: position.lat,
    lon: position.lon!,
  };
  if (descriptor.label) vehicle.label = descriptor.label;
  if (trip.tripId) vehicle.tripId = trip.tripId;
  if (trip.routeId) vehicle.routeId = trip.routeId;
  if (trip.directionId !== undefined) vehicle.directionId = trip.directionId;
  if (trip.startTime) vehicle.startTime = trip.startTime;
  if (typeof position.bearing === "number" && Number.isFinite(position.bearing)) {
    vehicle.bearing = ((position.bearing % 360) + 360) % 360;
  }
  // Only absolute epoch seconds; 0 or relative values mean "unknown".
  if (typeof ts === "number" && ts > 1_000_000_000) vehicle.ts = ts;
  if (stopId) vehicle.stopId = stopId;
  if (status) vehicle.status = status;
  if (occupancy !== undefined && occupancy <= 8) vehicle.occupancy = occupancy;
  return vehicle;
}

export function parseRomaVehiclePositionsFeed(buffer: Uint8Array): {
  feedTimestamp: number | null;
  vehicles: RomaRealtimeVehicle[];
  dropped: number;
} {
  let feedTimestamp: number | null = null;
  const vehicles: RomaRealtimeVehicle[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 2) {
      feedTimestamp = readHeaderTimestamp(readBytes(buffer, at));
    } else if (field === 2 && wire === 2) {
      const entity = readBytes(buffer, at);
      let id = "";
      let vehicleBytes: Uint8Array | null = null;
      for (const [entityField, entityWire, eAt] of fields(entity)) {
        if (entityField === 1 && entityWire === 2) id = text(readBytes(entity, eAt));
        else if (entityField === 4 && entityWire === 2) vehicleBytes = readBytes(entity, eAt);
      }
      if (!vehicleBytes) continue;
      const vehicle = decodeVehiclePosition(vehicleBytes, id || "unknown");
      // One marker per physical vehicle: duplicates would double-count service.
      if (!vehicle || seen.has(vehicle.id)) {
        dropped += 1;
        continue;
      }
      seen.add(vehicle.id);
      vehicles.push(vehicle);
    }
  }
  return { feedTimestamp, vehicles, dropped };
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "headers" | "arrayBuffer">>;

const RETRY_DELAY_MS = 250;

export function feedAgeSecondsAt(feedTimestamp: number | null, nowMs: number): number | null {
  if (feedTimestamp === null) return null;
  return Math.max(0, Math.round(nowMs / 1000 - feedTimestamp));
}

export function feedIsStale(feedAgeSeconds: number | null): boolean {
  return feedAgeSeconds === null || feedAgeSeconds > ROMA_FEED_STALE_SECONDS;
}

/**
 * Downloads a GTFS-RT feed with size limits. A network error or 5xx is retried
 * once after a short pause (the upstream connection occasionally drops); 4xx,
 * timeouts and oversize bodies fail at once.
 */
export async function fetchFeedBytes(
  url: string,
  fetchImpl: FetchLike,
  budgetStartedAt: number = Date.now(),
  feedFetchBudgetMs: number = FEED_FETCH_BUDGET_MS,
): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt += 1) {
    const remaining = feedFetchBudgetMs - (Date.now() - budgetStartedAt);
    if (remaining <= 0) throw new DOMException("The operation was aborted", "TimeoutError");
    const attemptTimeoutMs = Math.min(FETCH_TIMEOUT_MS, remaining);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": ROMA_RT_USER_AGENT, Accept: "application/octet-stream,*/*" },
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        if (attempt === 1 && response.status >= 500 && remaining > RETRY_DELAY_MS + 500) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        throw new Error(`upstream_${response.status}`);
      }
      const declared = Number(response.headers?.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) throw new Error("upstream_size");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 16 || bytes.byteLength > MAX_FEED_BYTES) throw new Error("upstream_size");
      return bytes;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : "";
      if (/^upstream_/.test(message)) throw error;
      if (attempt === 1 && name !== "TimeoutError" && name !== "AbortError" && remaining > RETRY_DELAY_MS + 500) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type LastGood<T> = { savedAt: number; view: T };

let lastGoodVehicles: LastGood<RomaRealtimeVehiclesView> | null = null;

export function lastGoodFallbackView<T extends {
  feedTimestamp: number | null;
  feedAgeSeconds: number | null;
  stale: boolean;
  fallback?: boolean;
}>(entry: LastGood<T> | null, nowMs: number): T | null {
  if (!entry || nowMs - entry.savedAt > LAST_GOOD_SNAPSHOT_MS) return null;
  const feedAgeSeconds = feedAgeSecondsAt(entry.view.feedTimestamp, nowMs);
  return {
    ...entry.view,
    feedAgeSeconds,
    stale: feedIsStale(feedAgeSeconds),
    fallback: true,
  };
}

/** Clears the in-memory last-good cache (unit tests only). */
export function resetRomaVehicleLastGoodForTests(): void {
  lastGoodVehicles = null;
}

async function fetchRomaRealtimeVehicles(
  fetchImpl: FetchLike,
  now: () => number,
  feedFetchBudgetMs: number,
): Promise<RomaRealtimeVehiclesView> {
  const budgetStartedAt = Date.now();
  const bytes = await fetchFeedBytes(
    ROMA_VEHICLE_POSITIONS_URL,
    fetchImpl,
    budgetStartedAt,
    feedFetchBudgetMs,
  );
  const { feedTimestamp, vehicles } = parseRomaVehiclePositionsFeed(bytes);
  const fetchedMs = now();
  const feedAgeSeconds = feedAgeSecondsAt(feedTimestamp, fetchedMs);
  return {
    status: "ok",
    source: ROMA_RT_SOURCE,
    fetchedAt: new Date(fetchedMs).toISOString(),
    feedTimestamp,
    feedAgeSeconds,
    stale: feedIsStale(feedAgeSeconds),
    vehicleCount: vehicles.length,
    vehicles,
  };
}

export async function loadRomaRealtimeVehicles(
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
  feedFetchBudgetMs: number = FEED_FETCH_BUDGET_MS,
): Promise<RomaRealtimeVehiclesView> {
  try {
    const view = await fetchRomaRealtimeVehicles(fetchImpl, now, feedFetchBudgetMs);
    lastGoodVehicles = { savedAt: now(), view };
    return view;
  } catch (error) {
    const fallback = lastGoodFallbackView(lastGoodVehicles, now());
    if (fallback) return fallback;
    throw error;
  }
}
