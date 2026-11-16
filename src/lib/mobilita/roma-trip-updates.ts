/**
 * Roma Mobilità GTFS-RT TripUpdates: predicted arrivals per stop.
 *
 * gtfs-realtime.proto 2.0 numbering: FeedEntity{1 id, 3 trip_update};
 * TripUpdate{1 trip, 2 stop_time_update, 3 vehicle}; TripDescriptor{1 trip_id,
 * 4 schedule_relationship (3 = CANCELED), 5 route_id, 6 direction_id};
 * StopTimeUpdate{1 stop_sequence, 2 arrival, 3 departure, 4 stop_id,
 * 5 schedule_relationship (1 = SKIPPED)}; StopTimeEvent{1 delay int32,
 * 2 time int64}.
 */
import {
  fetchFeedBytes,
  ROMA_FEED_STALE_SECONDS,
  ROMA_OPEN_DATA_URL,
  ROMA_RT_HOLDER,
  type FetchLike,
} from "@/lib/mobilita/roma-gtfs-realtime";
import { fields, readBytes, readHeaderTimestamp, readInt32, readVarint, text } from "@/lib/mobilita/protobuf-wire";
import { delayBucket, type DelayBucket } from "@/lib/mobilita/roma-live-model";

export const ROMA_TRIP_UPDATES_URL =
  "https://romamobilita.it/sites/default/files/rome_rtgtfs_trip_updates_feed.pb";

/** Arrivals further ahead than this are not useful for a live board. */
export const ARRIVALS_HORIZON_SECONDS = 2 * 3600;
/** A stop whose predicted time passed more than this ago is dropped. */
const PASSED_GRACE_SECONDS = 30;

export type TripStopPrediction = {
  stopId: string;
  sequence?: number;
  /** Unix seconds (arrival, else departure). */
  time?: number;
  /** Seconds late (+) or early (−) versus the timetable. */
  delay?: number;
};

export type TripPrediction = {
  tripId: string;
  routeId?: string;
  directionId?: 0 | 1;
  vehicleId?: string;
  cancelled: boolean;
  stops: TripStopPrediction[];
};

function decodeEvent(buffer: Uint8Array) {
  const event: { delay?: number; time?: number } = {};
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 0) event.delay = readInt32(buffer, at);
    else if (field === 2 && wire === 0) {
      const time = readVarint(buffer, at);
      if (time > 1_000_000_000) event.time = time;
    }
  }
  return event;
}

function decodeStopTimeUpdate(buffer: Uint8Array): TripStopPrediction | null {
  let stopId = "";
  let sequence: number | undefined;
  let arrival: ReturnType<typeof decodeEvent> | null = null;
  let departure: ReturnType<typeof decodeEvent> | null = null;
  let relationship = 0;
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 0) sequence = readVarint(buffer, at);
    else if (field === 2 && wire === 2) arrival = decodeEvent(readBytes(buffer, at));
    else if (field === 3 && wire === 2) departure = decodeEvent(readBytes(buffer, at));
    else if (field === 4 && wire === 2) stopId = text(readBytes(buffer, at));
    else if (field === 5 && wire === 0) relationship = readVarint(buffer, at);
  }
  // SKIPPED (1) and NO_DATA (2) carry no usable prediction.
  if (!stopId || relationship !== 0) return null;
  const time = arrival?.time ?? departure?.time;
  const delay = arrival?.delay ?? departure?.delay;
  const out: TripStopPrediction = { stopId };
  if (sequence !== undefined) out.sequence = sequence;
  if (time !== undefined) out.time = time;
  if (delay !== undefined && Math.abs(delay) < 6 * 3600) out.delay = delay;
  return out;
}

function decodeTripUpdate(buffer: Uint8Array): TripPrediction | null {
  const trip: TripPrediction = { tripId: "", cancelled: false, stops: [] };
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 2) {
      const descriptor = readBytes(buffer, at);
      for (const [f, w, a] of fields(descriptor)) {
        if (f === 1 && w === 2) trip.tripId = text(readBytes(descriptor, a));
        else if (f === 4 && w === 0) trip.cancelled = readVarint(descriptor, a) === 3;
        else if (f === 5 && w === 2) trip.routeId = text(readBytes(descriptor, a));
        else if (f === 6 && w === 0) {
          const direction = readVarint(descriptor, a);
          if (direction === 0 || direction === 1) trip.directionId = direction;
        }
      }
    } else if (field === 2 && wire === 2) {
      const stop = decodeStopTimeUpdate(readBytes(buffer, at));
      if (stop) trip.stops.push(stop);
    } else if (field === 3 && wire === 2) {
      const vehicle = readBytes(buffer, at);
      for (const [f, w, a] of fields(vehicle)) {
        if (f === 1 && w === 2) trip.vehicleId = text(readBytes(vehicle, a));
      }
    }
  }
  return trip.tripId ? trip : null;
}

export function parseRomaTripUpdatesFeed(buffer: Uint8Array): {
  feedTimestamp: number | null;
  trips: TripPrediction[];
} {
  let feedTimestamp: number | null = null;
  const trips: TripPrediction[] = [];
  const seen = new Set<string>();
  for (const [field, wire, at] of fields(buffer)) {
    if (field === 1 && wire === 2) feedTimestamp = readHeaderTimestamp(readBytes(buffer, at));
    else if (field === 2 && wire === 2) {
      const entity = readBytes(buffer, at);
      for (const [f, w, a] of fields(entity)) {
        if (f === 3 && w === 2) {
          const trip = decodeTripUpdate(readBytes(entity, a));
          if (trip && !seen.has(trip.tripId)) {
            seen.add(trip.tripId);
            trips.push(trip);
          }
        }
      }
    }
  }
  return { feedTimestamp, trips };
}

/**
 * Compact public shape: one entry per trip, upcoming stops only, times as
 * offsets from `base` (seconds). ~5× smaller than the expanded objects.
 */
export type CompactTrip = {
  /** trip_id */
  t: string;
  /** route_id */
  r?: string;
  /** direction_id */
  k?: 0 | 1;
  /** vehicle id (matches VehiclePositions `id`) */
  v?: string;
  /** cancelled trip */
  c?: true;
  /** current delay: the one predicted at the next stop, null if unknown */
  d: number | null;
  /** stop ids, in travel order */
  s: string[];
  /** predicted time offset from base, seconds */
  a: number[];
  /** delay at each stop, seconds; null when not published */
  y: (number | null)[];
};

export type CompactArrivals = { base: number; trips: CompactTrip[] };

export function compactArrivals(
  parsed: { feedTimestamp: number | null; trips: TripPrediction[] },
  nowSeconds: number,
  horizonSeconds = ARRIVALS_HORIZON_SECONDS,
): CompactArrivals {
  const base = Math.round(nowSeconds);
  const out: CompactTrip[] = [];
  for (const trip of parsed.trips) {
    const s: string[] = [];
    const a: number[] = [];
    const y: (number | null)[] = [];
    for (const stop of trip.stops) {
      if (stop.time === undefined) continue;
      const offset = stop.time - base;
      if (offset < -PASSED_GRACE_SECONDS || offset > horizonSeconds) continue;
      s.push(stop.stopId);
      a.push(offset);
      y.push(stop.delay ?? null);
    }
    if (s.length === 0 && !trip.cancelled) continue;
    const entry: CompactTrip = { t: trip.tripId, d: y.find((v) => v !== null) ?? null, s, a, y };
    if (trip.routeId) entry.r = trip.routeId;
    if (trip.directionId !== undefined) entry.k = trip.directionId;
    if (trip.vehicleId) entry.v = trip.vehicleId;
    if (trip.cancelled) entry.c = true;
    out.push(entry);
  }
  return { base, trips: out };
}

export type RomaArrivalsView = {
  status: "ok";
  source: { holder: string; openDataUrl: string; feedUrl: string };
  fetchedAt: string;
  feedTimestamp: number | null;
  feedAgeSeconds: number | null;
  stale: boolean;
  tripCount: number;
  cancelledCount: number;
} & CompactArrivals;

export const ROMA_TRIP_UPDATES_SOURCE = {
  holder: ROMA_RT_HOLDER,
  openDataUrl: ROMA_OPEN_DATA_URL,
  feedUrl: ROMA_TRIP_UPDATES_URL,
};

export async function loadRomaArrivals(
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<RomaArrivalsView> {
  const bytes = await fetchFeedBytes(ROMA_TRIP_UPDATES_URL, fetchImpl);
  const parsed = parseRomaTripUpdatesFeed(bytes);
  const fetchedMs = now();
  const compact = compactArrivals(parsed, fetchedMs / 1000);
  const feedAgeSeconds =
    parsed.feedTimestamp === null ? null : Math.max(0, Math.round(fetchedMs / 1000 - parsed.feedTimestamp));
  return {
    status: "ok",
    source: ROMA_TRIP_UPDATES_SOURCE,
    fetchedAt: new Date(fetchedMs).toISOString(),
    feedTimestamp: parsed.feedTimestamp,
    feedAgeSeconds,
    stale: feedAgeSeconds === null || feedAgeSeconds > ROMA_FEED_STALE_SECONDS,
    tripCount: compact.trips.length,
    cancelledCount: compact.trips.filter((t) => t.c).length,
    ...compact,
  };
}

export type PunctualitySummary = { total: number; buckets: Record<DelayBucket, number> };

/**
 * Buses on the road by current delay band: one count per vehicle (its trip
 * with the nearest upcoming stop), cancelled trips and trips without a
 * vehicle excluded. A missing delay is "unknown", never "on time".
 */
export function punctualitySummary(trips: readonly CompactTrip[]): PunctualitySummary {
  const current = new Map<string, CompactTrip>();
  for (const trip of trips) {
    if (!trip.v || trip.c) continue;
    const previous = current.get(trip.v);
    const next = trip.a[0] ?? Infinity;
    if (!previous || next < (previous.a[0] ?? Infinity)) current.set(trip.v, trip);
  }
  const buckets: Record<DelayBucket, number> = { early: 0, ontime: 0, late: 0, verylate: 0, severe: 0, unknown: 0 };
  for (const trip of current.values()) buckets[delayBucket(trip.d)] += 1;
  return { total: current.size, buckets };
}
