/** Official Roma Mobilità GTFS-RT VehiclePositions (redirects to wp-content/uploads/shared). */
export const ROMA_VEHICLE_POSITIONS_URL =
  "https://romamobilita.it/sites/default/files/rome_rtgtfs_vehicle_positions_feed.pb";

export const ROMA_OPEN_DATA_URL =
  "https://romamobilita.it/sistemi-e-tecnologie/open-data/";

export const ROMA_RT_HOLDER = "Roma Servizi per la Mobilità (ATAC e Roma TPL)";

export type RomaRealtimeVehicle = {
  id: string;
  tripId?: string;
  routeId?: string;
  lat: number;
  lon: number;
  bearing?: number;
  ts?: number;
};

export type RomaRealtimeVehiclesView = {
  status: "ok";
  source: {
    holder: string;
    openDataUrl: string;
    feedUrl: string;
  };
  fetchedAt: string;
  feedTimestamp: number | null;
  vehicleCount: number;
  vehicles: RomaRealtimeVehicle[];
};

export type RomaRealtimeUnavailable = {
  status: "unavailable";
  error: string;
  source: {
    holder: string;
    openDataUrl: string;
    feedUrl: string;
  };
  fetchedAt: string;
};

const UA = "DoveVannoINostriSoldi/1.0 (+https://www.dovevannoinostrisoldi.com; mobilita-roma-rt)";

/** Minimal protobuf wire reader for GTFS-RT VehiclePositions only. */
function readVarint(buffer: Uint8Array, offset: { i: number }): number {
  let result = 0;
  let shift = 0;
  while (offset.i < buffer.length) {
    const byte = buffer[offset.i++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 35) throw new Error("varint_overflow");
  }
  throw new Error("varint_truncated");
}

function readBytes(buffer: Uint8Array, offset: { i: number }): Uint8Array {
  const length = readVarint(buffer, offset);
  const start = offset.i;
  const end = start + length;
  if (end > buffer.length) throw new Error("bytes_truncated");
  offset.i = end;
  return buffer.subarray(start, end);
}

function readFloat32(buffer: Uint8Array, offset: { i: number }): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset.i, 4);
  offset.i += 4;
  return view.getFloat32(0, true);
}

function readFixed64AsNumber(buffer: Uint8Array, offset: { i: number }): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset.i, 8);
  const low = view.getUint32(0, true);
  const high = view.getUint32(4, true);
  offset.i += 8;
  return high * 2 ** 32 + low;
}

function skipField(buffer: Uint8Array, offset: { i: number }, wireType: number): void {
  if (wireType === 0) {
    readVarint(buffer, offset);
    return;
  }
  if (wireType === 1) {
    offset.i += 8;
    return;
  }
  if (wireType === 2) {
    readBytes(buffer, offset);
    return;
  }
  if (wireType === 5) {
    offset.i += 4;
    return;
  }
  throw new Error(`unsupported_wire_${wireType}`);
}

function decodeString(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function decodeTrip(buffer: Uint8Array): { tripId?: string; routeId?: string } {
  const offset = { i: 0 };
  let tripId: string | undefined;
  let routeId: string | undefined;
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) tripId = decodeString(readBytes(buffer, offset));
    else if (field === 5 && wire === 2) routeId = decodeString(readBytes(buffer, offset));
    else skipField(buffer, offset, wire);
  }
  return { tripId, routeId };
}

function decodeVehicleDescriptor(buffer: Uint8Array): { id?: string } {
  const offset = { i: 0 };
  let id: string | undefined;
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) id = decodeString(readBytes(buffer, offset));
    else skipField(buffer, offset, wire);
  }
  return { id };
}

function decodePosition(buffer: Uint8Array): { lat?: number; lon?: number; bearing?: number } {
  const offset = { i: 0 };
  let lat: number | undefined;
  let lon: number | undefined;
  let bearing: number | undefined;
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 5) lat = readFloat32(buffer, offset);
    else if (field === 2 && wire === 5) lon = readFloat32(buffer, offset);
    else if (field === 3 && wire === 5) bearing = readFloat32(buffer, offset);
    else skipField(buffer, offset, wire);
  }
  return { lat, lon, bearing };
}

function decodeVehiclePosition(
  buffer: Uint8Array,
  entityId: string,
): RomaRealtimeVehicle | null {
  const offset = { i: 0 };
  let trip: { tripId?: string; routeId?: string } = {};
  let position: { lat?: number; lon?: number; bearing?: number } = {};
  let ts: number | undefined;
  let vehicleId: string | undefined;
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) trip = decodeTrip(readBytes(buffer, offset));
    else if (field === 2 && wire === 2) position = decodePosition(readBytes(buffer, offset));
    else if (field === 4 && wire === 0) ts = readVarint(buffer, offset);
    else if (field === 4 && wire === 1) ts = readFixed64AsNumber(buffer, offset);
    else if (field === 8 && wire === 2) vehicleId = decodeVehicleDescriptor(readBytes(buffer, offset)).id;
    else skipField(buffer, offset, wire);
  }
  if (
    typeof position.lat !== "number" ||
    typeof position.lon !== "number" ||
    !Number.isFinite(position.lat) ||
    !Number.isFinite(position.lon) ||
    Math.abs(position.lat) > 90 ||
    Math.abs(position.lon) > 180
  ) {
    return null;
  }
  const vehicle: RomaRealtimeVehicle = {
    id: vehicleId || entityId,
    lat: position.lat,
    lon: position.lon,
  };
  if (trip.tripId) vehicle.tripId = trip.tripId;
  if (trip.routeId) vehicle.routeId = trip.routeId;
  if (typeof position.bearing === "number" && Number.isFinite(position.bearing)) {
    vehicle.bearing = position.bearing;
  }
  // Ignore relative/placeholder timestamps; keep only unix epoch seconds.
  if (typeof ts === "number" && ts > 1_000_000_000) vehicle.ts = ts;
  return vehicle;
}

function decodeEntity(buffer: Uint8Array): RomaRealtimeVehicle | null {
  const offset = { i: 0 };
  let id = "";
  let vehicleBytes: Uint8Array | null = null;
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) id = decodeString(readBytes(buffer, offset));
    // FeedEntity: trip_update=3, vehicle=4, alert=5
    else if (field === 4 && wire === 2) vehicleBytes = readBytes(buffer, offset);
    else skipField(buffer, offset, wire);
  }
  if (!vehicleBytes) return null;
  return decodeVehiclePosition(vehicleBytes, id || "unknown");
}

export function parseRomaVehiclePositionsFeed(buffer: Uint8Array): {
  feedTimestamp: number | null;
  vehicles: RomaRealtimeVehicle[];
} {
  const offset = { i: 0 };
  let feedTimestamp: number | null = null;
  const vehicles: RomaRealtimeVehicle[] = [];
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const header = readBytes(buffer, offset);
      const headerOffset = { i: 0 };
      while (headerOffset.i < header.length) {
        const headerTag = readVarint(header, headerOffset);
        const headerField = headerTag >>> 3;
        const headerWire = headerTag & 7;
        if (headerField === 3 && headerWire === 0) {
          feedTimestamp = readVarint(header, headerOffset);
        } else if (headerField === 3 && headerWire === 1) {
          feedTimestamp = readFixed64AsNumber(header, headerOffset);
        } else {
          skipField(header, headerOffset, headerWire);
        }
      }
    } else if (field === 2 && wire === 2) {
      const vehicle = decodeEntity(readBytes(buffer, offset));
      if (vehicle) vehicles.push(vehicle);
    } else {
      skipField(buffer, offset, wire);
    }
  }
  return { feedTimestamp, vehicles };
}

export async function loadRomaRealtimeVehicles(
  fetchImpl: typeof fetch = fetch,
): Promise<RomaRealtimeVehiclesView> {
  const fetchedAt = new Date().toISOString();
  const response = await fetchImpl(ROMA_VEHICLE_POSITIONS_URL, {
    headers: { "User-Agent": UA, Accept: "application/octet-stream,*/*" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`upstream_${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 16 || bytes.byteLength > 5_000_000) {
    throw new Error("upstream_size");
  }
  const { feedTimestamp, vehicles } = parseRomaVehiclePositionsFeed(bytes);
  return {
    status: "ok",
    source: {
      holder: ROMA_RT_HOLDER,
      openDataUrl: ROMA_OPEN_DATA_URL,
      feedUrl: ROMA_VEHICLE_POSITIONS_URL,
    },
    fetchedAt,
    feedTimestamp,
    vehicleCount: vehicles.length,
    vehicles,
  };
}
