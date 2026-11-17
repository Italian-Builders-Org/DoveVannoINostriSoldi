import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = await import(pathToFileURL(join(root, "src/lib/mobilita/roma-vehicles-shared.ts")).href);
const { classifyRomaFeedFailure } = await import(
  pathToFileURL(join(root, "src/lib/mobilita/roma-gtfs-realtime.ts")).href
);

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
  clock.now += 5_000;
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