import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { fField, mField, sField, vField } from "./helpers/gtfs-rt-encoder.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = await import(pathToFileURL(join(root, "src/lib/mobilita/roma-vehicles-shared.ts")).href);
const { classifyRomaFeedFailure } = await import(
  pathToFileURL(join(root, "src/lib/mobilita/roma-gtfs-realtime.ts")).href
);

function vehicleEntity({ entityId, routeId, vehicleId, lat, lon, timestamp }) {
  const trip = [...sField(5, routeId), ...vField(6, 0)];
  const position = [...fField(1, lat), ...fField(2, lon)];
  const descriptor = [...sField(1, vehicleId)];
  const vehicle = [
    ...mField(1, trip),
    ...mField(8, descriptor),
    ...mField(2, position),
    ...vField(5, timestamp),
  ];
  return mField(2, [...sField(1, entityId), ...vField(2, 0), ...mField(4, vehicle)]);
}

function feed(entities, timestamp = 1_794_840_598) {
  const header = [...sField(1, "2.0"), ...vField(2, 0), ...vField(3, timestamp)];
  return Uint8Array.from([...mField(1, header), ...entities.flat()]);
}

function okFetch(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

test("classifyRomaFeedFailure distinguishes slow upstream from unreachable errors", () => {
  const timeout = classifyRomaFeedFailure(new DOMException("aborted", "TimeoutError"));
  assert.equal(timeout.code, "upstream_timeout");
  assert.equal(timeout.httpStatus, 504);
  assert.match(timeout.message, /lento a rispondere/i);

  const http = classifyRomaFeedFailure(new Error("upstream_503"));
  assert.equal(http.code, "upstream_503");
  assert.equal(http.httpStatus, 502);
  assert.match(http.message, /non è raggiungibile/i);
});

test("failure cache lasts about five seconds", () => {
  assert.equal(shared.VEHICLE_FEED_FAILURE_CACHE_MS, 5_000);
});

test("coalesced loader shares one in-flight failure across concurrent callers", async () => {
  shared.resetRomaMobilitaRealtimeForTests();
  let calls = 0;
  const fail = async () => {
    calls += 1;
    throw new DOMException("aborted", "TimeoutError");
  };
  const clock = { now: 1_000_000 };
  const error = await (() => {
    const inflight = shared.loadRomaRealtimeVehiclesCoalesced(fail, () => clock.now);
    const handled = inflight.catch((value) => value);
    assert.equal(inflight, shared.loadRomaRealtimeVehiclesCoalesced(fail, () => clock.now));
    return handled;
  })();
  assert.equal(error.name, "TimeoutError");
  assert.equal(calls, 1);
  await new Promise((resolve) => setImmediate(resolve));
  shared.resetRomaMobilitaRealtimeForTests();
});

test("coalesced loader caches recent failure without contacting upstream again", async () => {
  shared.resetRomaMobilitaRealtimeForTests();
  let calls = 0;
  const fail = async () => {
    calls += 1;
    throw new DOMException("aborted", "TimeoutError");
  };
  const clock = { now: 2_000_000 };
  const first = shared.loadRomaRealtimeVehiclesCoalesced(fail, () => clock.now).catch((error) => error);
  const firstError = await first;
  assert.equal(firstError.name, "TimeoutError");
  clock.now += 4_000;
  const cached = shared.loadRomaRealtimeVehiclesCoalesced(fail, () => clock.now).catch((error) => error);
  const cachedError = await cached;
  assert.equal(cachedError.name, "TimeoutError");
  assert.equal(calls, 1);
  clock.now += shared.VEHICLE_FEED_FAILURE_CACHE_MS;
  const fresh = shared.loadRomaRealtimeVehiclesCoalesced(fail, () => clock.now).catch((error) => error);
  const freshError = await fresh;
  assert.equal(freshError.name, "TimeoutError");
  assert.equal(calls, 2);
  await new Promise((resolve) => setImmediate(resolve));
  shared.resetRomaMobilitaRealtimeForTests();
});

test("coalesced loader reuses a successful read for 10 seconds", async () => {
  shared.resetRomaMobilitaRealtimeForTests();
  const bytes = feed([
    vehicleEntity({
      entityId: "1",
      routeId: "64",
      vehicleId: "v1",
      lat: 41.9012,
      lon: 12.5004,
      timestamp: 1_794_840_562,
    }),
  ]);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return okFetch(bytes)();
  };
  const clock = { now: 3_000_000 };
  await shared.loadRomaRealtimeVehiclesCoalesced(fetchImpl, () => clock.now);
  clock.now += 2_000;
  await shared.loadRomaRealtimeVehiclesCoalesced(fetchImpl, () => clock.now);
  clock.now += 2_000;
  await shared.loadRomaRealtimeVehiclesCoalesced(fetchImpl, () => clock.now);
  assert.equal(calls, 1);
  clock.now += 10_001;
  await shared.loadRomaRealtimeVehiclesCoalesced(fetchImpl, () => clock.now);
  assert.equal(calls, 2);
  shared.resetRomaMobilitaRealtimeForTests();
});
