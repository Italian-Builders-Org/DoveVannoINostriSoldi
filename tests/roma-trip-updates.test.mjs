import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { mField, sField, vField } from "./helpers/gtfs-rt-encoder.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = await import(pathToFileURL(join(root, "src/lib/mobilita/roma-trip-updates.ts")).href);

const FEED_TS = 1_794_844_012;

// Field layout observed in the official Roma Mobilità TripUpdates feed.
function stopTimeUpdate({ seq, stopId, time, delay, departureOnly = false, relationship }) {
  const event = [];
  if (delay !== undefined) event.push(...vField(1, delay));
  if (time !== undefined) event.push(...vField(2, time));
  event.push(...vField(3, 18));
  const out = [...vField(1, seq), ...sField(4, stopId)];
  out.push(...mField(departureOnly ? 3 : 2, event));
  if (relationship !== undefined) out.push(...vField(5, relationship));
  return mField(2, out);
}

function tripUpdate({ entityId = "1", tripId, routeId, direction = 0, vehicleId, cancelled = false, stops }) {
  const trip = [...sField(1, tripId), ...sField(2, "16:47:00"), ...sField(3, "20261116"), ...sField(5, routeId), ...vField(6, direction)];
  if (cancelled) trip.push(...vField(4, 3));
  const body = [...mField(1, trip)];
  if (vehicleId) body.push(...mField(3, [...sField(1, vehicleId), ...sField(2, "8628")]));
  for (const stop of stops) body.push(...stopTimeUpdate(stop));
  return mField(2, [...sField(1, entityId), ...vField(2, 0), ...mField(3, body)]);
}

function feed(entities, timestamp = FEED_TS) {
  const header = [...sField(1, "2.0"), ...vField(2, 0), ...vField(3, timestamp)];
  return Uint8Array.from([...mField(1, header), ...entities.flat()]);
}

const TRIP_64 = {
  tripId: "0#1898-22",
  routeId: "64",
  direction: 1,
  vehicleId: "52",
  stops: [
    { seq: 1, stopId: "A", time: FEED_TS - 120, delay: 30 },
    { seq: 2, stopId: "B", time: FEED_TS + 60, delay: -45 },
    { seq: 3, stopId: "C", time: FEED_TS + 300, delay: 120, departureOnly: true },
    { seq: 4, stopId: "D", relationship: 1 },
    { seq: 5, stopId: "E", time: FEED_TS + 600 },
  ],
};

test("negative delays (early buses) decode as negative seconds, not 2^64", () => {
  const { trips } = lib.parseRomaTripUpdatesFeed(feed([tripUpdate(TRIP_64)]));
  const b = trips[0].stops.find((s) => s.stopId === "B");
  assert.equal(b.delay, -45);
  assert.equal(b.time, FEED_TS + 60);
});

test("trip keeps identity, departure-only events and drops skipped stops", () => {
  const { feedTimestamp, trips } = lib.parseRomaTripUpdatesFeed(feed([tripUpdate(TRIP_64)]));
  assert.equal(feedTimestamp, FEED_TS);
  const [trip] = trips;
  assert.equal(trip.tripId, "0#1898-22");
  assert.equal(trip.routeId, "64");
  assert.equal(trip.directionId, 1);
  assert.equal(trip.vehicleId, "52");
  assert.equal(trip.cancelled, false);
  assert.deepEqual(
    trip.stops.map((s) => s.stopId),
    ["A", "B", "C", "E"],
  );
  assert.equal(trip.stops.find((s) => s.stopId === "C").delay, 120);
  // Missing delay stays missing, not zero ("in orario").
  assert.equal("delay" in trip.stops.find((s) => s.stopId === "E"), false);
});

test("cancelled trips are flagged instead of looking like running service", () => {
  const { trips } = lib.parseRomaTripUpdatesFeed(feed([tripUpdate({ ...TRIP_64, cancelled: true })]));
  assert.equal(trips[0].cancelled, true);
});

test("truncated protobuf fails closed", () => {
  const bytes = feed([tripUpdate(TRIP_64)]);
  assert.throws(() => lib.parseRomaTripUpdatesFeed(bytes.subarray(0, bytes.length - 5)));
});

test("compact view keeps only upcoming stops within the horizon and the current delay", () => {
  const parsed = lib.parseRomaTripUpdatesFeed(
    feed([
      tripUpdate(TRIP_64),
      tripUpdate({
        entityId: "2",
        tripId: "far",
        routeId: "H",
        stops: [{ seq: 1, stopId: "Z", time: FEED_TS + 4 * 3600, delay: 0 }],
      }),
    ]),
  );
  const view = lib.compactArrivals(parsed, FEED_TS);
  // Passed stop A is gone; E (no delay) is kept with null delay.
  const trip = view.trips.find((t) => t.t === "0#1898-22");
  assert.deepEqual(trip.s, ["B", "C", "E"]);
  assert.deepEqual(trip.a, [60, 300, 600]);
  assert.deepEqual(trip.y, [-45, 120, null]);
  assert.equal(trip.d, -45, "current delay is the one at the next stop");
  // A trip whose only stop is beyond the horizon carries no stops.
  assert.equal(view.trips.some((t) => t.t === "far"), false);
  assert.equal(view.base, FEED_TS);
});

function okFetch(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

test("loadRomaArrivals reports staleness and fails closed upstream", async () => {
  const bytes = feed([tripUpdate(TRIP_64)]);
  const fresh = await lib.loadRomaArrivals(okFetch(bytes), () => (FEED_TS + 20) * 1000);
  assert.equal(fresh.status, "ok");
  assert.equal(fresh.stale, false);
  assert.equal(fresh.tripCount, 1);
  const stale = await lib.loadRomaArrivals(okFetch(bytes), () => (FEED_TS + 900) * 1000);
  assert.equal(stale.stale, true);
  await assert.rejects(
    () =>
      lib.loadRomaArrivals(async () => ({
        ok: false,
        status: 500,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    /upstream_500/,
  );
});
