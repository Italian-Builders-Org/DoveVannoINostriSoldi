import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { mField, sField, vField } from "./helpers/gtfs-rt-encoder.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = await import(pathToFileURL(join(root, "src/lib/mobilita/roma-trip-updates.ts")).href);

test("trip updates feed URL is the canonical wp-content path", () => {
  assert.equal(
    lib.ROMA_TRIP_UPDATES_URL,
    "https://romamobilita.it/wp-content/uploads/shared/rome_rtgtfs_trip_updates_feed.pb",
  );
});

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

test("punctualitySummary counts each live bus once by its current delay band", () => {
  const trip = (t, v, d, c) => ({ t, v, d, c, s: [], a: [], y: [] });
  const summary = lib.punctualitySummary([
    trip("a", "1", 0),
    trip("b", "2", 200),
    trip("c", "3", 400),
    trip("d", "4", 900),
    trip("e", "5", -400),
    trip("f", "6", null),
    // Same vehicle on a second trip (next run already predicted): counted once.
    trip("g", "1", 700),
    // No vehicle: a scheduled trip without a bus on the road is not a bus.
    trip("h", undefined, 0),
    // Cancelled trips are not service.
    trip("i", "9", 0, true),
  ]);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.buckets, { early: 1, ontime: 1, late: 1, verylate: 1, severe: 1, unknown: 1 });
});

test("loadRomaArrivals serves last-good snapshot on timeout when fresh enough", async () => {
  lib.resetRomaArrivalsLastGoodForTests();
  const bytes = feed([tripUpdate(TRIP_64)]);
  const tick = (FEED_TS + 20) * 1000;
  const ok = await lib.loadRomaArrivals(okFetch(bytes), () => tick);
  assert.equal(ok.stale, false);
  const err = new DOMException("The operation was aborted", "TimeoutError");
  const fallback = await lib.loadRomaArrivals(async () => {
    throw err;
  }, () => tick + 60_000);
  assert.equal(fallback.status, "ok");
  assert.equal(fallback.stale, true);
  assert.equal(fallback.tripCount, ok.tripCount);
  lib.resetRomaArrivalsLastGoodForTests();
});

test("loadRomaArrivals rejects timeout without snapshot or after last-good window", async () => {
  const { LAST_GOOD_SNAPSHOT_MS } = await import(
    pathToFileURL(join(root, "src/lib/mobilita/roma-gtfs-realtime.ts")).href
  );
  lib.resetRomaArrivalsLastGoodForTests();
  const err = new DOMException("The operation was aborted", "TimeoutError");
  await assert.rejects(
    () => lib.loadRomaArrivals(async () => { throw err; }),
    (e) => e.name === "TimeoutError",
  );
  const bytes = feed([tripUpdate(TRIP_64)]);
  const tick = (FEED_TS + 20) * 1000;
  await lib.loadRomaArrivals(okFetch(bytes), () => tick);
  await assert.rejects(
    () =>
      lib.loadRomaArrivals(async () => {
        throw err;
      }, () => tick + LAST_GOOD_SNAPSHOT_MS + 1),
    (e) => e.name === "TimeoutError",
  );
  lib.resetRomaArrivalsLastGoodForTests();
});

test("a transient network or 5xx failure is retried once, then fails closed", async () => {
  const bytes = feed([tripUpdate(TRIP_64)]);
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return okFetch(bytes)();
  };
  const view = await lib.loadRomaArrivals(flaky, () => (FEED_TS + 20) * 1000);
  assert.equal(view.status, "ok");
  assert.equal(calls, 2);

  let fiveHundreds = 0;
  await assert.rejects(
    () =>
      lib.loadRomaArrivals(async () => {
        fiveHundreds += 1;
        return { ok: false, status: 503, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
      }),
    /upstream_503/,
  );
  assert.equal(fiveHundreds, 2, "5xx ritentato una sola volta");

  let notFound = 0;
  await assert.rejects(
    () =>
      lib.loadRomaArrivals(async () => {
        notFound += 1;
        return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
      }),
    /upstream_404/,
  );
  assert.equal(notFound, 1, "4xx non va ritentato");
});
