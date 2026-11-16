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
export const ROMA_VEHICLE_POSITIONS_URL =
  "https://romamobilita.it/sites/default/files/rome_rtgtfs_vehicle_positions_feed.pb";

export const ROMA_OPEN_DATA_URL = "https://romamobilita.it/sistemi-e-tecnologie/open-data/";

export const ROMA_RT_HOLDER = "Roma Servizi per la Mobilità (ATAC e Roma TPL)";

/** A feed older than this is shown as not current instead of "live". */
export const ROMA_FEED_STALE_SECONDS = 300;

const MAX_FEED_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 10_000;

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
  vehicleCount: number;
  vehicles: RomaRealtimeVehicle[];
};

export type RomaRealtimeUnavailable = {
  status: "unavailable";
  error: string;
  source: Source;
  fetchedAt: string;
};

export const ROMA_RT_SOURCE: Source = {
  holder: ROMA_RT_HOLDER,
  openDataUrl: ROMA_OPEN_DATA_URL,
  feedUrl: ROMA_VEHICLE_POSITIONS_URL,
};

const UA = "DoveVannoINostriSoldi/1.0 (+https://www.dovevannoinostrisoldi.com; mobilita-roma-rt)";

type Cursor = { i: number };

// Arithmetic (not bitwise) so 64-bit timestamps do not wrap at 2^31.
function readVarint(buffer: Uint8Array, offset: Cursor): number {
  let result = 0;
  let multiplier = 1;
  for (let n = 0; n < 10; n += 1) {
    if (offset.i >= buffer.length) throw new Error("varint_truncated");
    const byte = buffer[offset.i++]!;
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return result;
    multiplier *= 128;
  }
  throw new Error("varint_overflow");
}

function need(buffer: Uint8Array, offset: Cursor, bytes: number): void {
  if (offset.i + bytes > buffer.length) throw new Error("bytes_truncated");
}

function readBytes(buffer: Uint8Array, offset: Cursor): Uint8Array {
  const length = readVarint(buffer, offset);
  need(buffer, offset, length);
  const start = offset.i;
  offset.i += length;
  return buffer.subarray(start, start + length);
}

function readFloat32(buffer: Uint8Array, offset: Cursor): number {
  need(buffer, offset, 4);
  const value = new DataView(buffer.buffer, buffer.byteOffset + offset.i, 4).getFloat32(0, true);
  offset.i += 4;
  return value;
}

function readFixed64(buffer: Uint8Array, offset: Cursor): number {
  need(buffer, offset, 8);
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset.i, 8);
  offset.i += 8;
  return view.getUint32(4, true) * 2 ** 32 + view.getUint32(0, true);
}

function skipField(buffer: Uint8Array, offset: Cursor, wireType: number): void {
  if (wireType === 0) readVarint(buffer, offset);
  else if (wireType === 1) {
    need(buffer, offset, 8);
    offset.i += 8;
  } else if (wireType === 2) readBytes(buffer, offset);
  else if (wireType === 5) {
    need(buffer, offset, 4);
    offset.i += 4;
  } else throw new Error(`unsupported_wire_${wireType}`);
}

const decoder = new TextDecoder("utf-8", { fatal: false });
const text = (bytes: Uint8Array) => decoder.decode(bytes);

function* fields(buffer: Uint8Array): Generator<[number, number, Cursor]> {
  const offset: Cursor = { i: 0 };
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const before = offset.i;
    yield [Math.floor(tag / 8), tag % 8, offset];
    // The consumer did not read the value: skip it.
    if (offset.i === before) skipField(buffer, offset, tag % 8);
  }
}

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
      const header = readBytes(buffer, at);
      for (const [headerField, headerWire, hAt] of fields(header)) {
        if (headerField === 3 && headerWire === 0) feedTimestamp = readVarint(header, hAt);
        else if (headerField === 3 && headerWire === 1) feedTimestamp = readFixed64(header, hAt);
      }
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
  if (feedTimestamp !== null && feedTimestamp < 1_000_000_000) feedTimestamp = null;
  return { feedTimestamp, vehicles, dropped };
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "headers" | "arrayBuffer">>;

export async function loadRomaRealtimeVehicles(
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<RomaRealtimeVehiclesView> {
  const response = await fetchImpl(ROMA_VEHICLE_POSITIONS_URL, {
    headers: { "User-Agent": UA, Accept: "application/octet-stream,*/*" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  const declared = Number(response.headers?.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) throw new Error("upstream_size");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_FEED_BYTES) throw new Error("upstream_size");
  const { feedTimestamp, vehicles } = parseRomaVehiclePositionsFeed(bytes);
  const fetchedMs = now();
  const feedAgeSeconds =
    feedTimestamp === null ? null : Math.max(0, Math.round(fetchedMs / 1000 - feedTimestamp));
  return {
    status: "ok",
    source: ROMA_RT_SOURCE,
    fetchedAt: new Date(fetchedMs).toISOString(),
    feedTimestamp,
    feedAgeSeconds,
    stale: feedAgeSeconds === null || feedAgeSeconds > ROMA_FEED_STALE_SECONDS,
    vehicleCount: vehicles.length,
    vehicles,
  };
}
