import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(root, "tests/fixtures/mobilita/rome-vehicle-positions-sample.pb");
const libPath = join(root, "src/lib/mobilita/roma-gtfs-realtime.ts");

async function loadParser() {
  return import(pathToFileURL(libPath).href);
}

test("parseRomaVehiclePositionsFeed extracts vehicles from fixture protobuf", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const bytes = readFileSync(fixturePath);
  const parsed = parseRomaVehiclePositionsFeed(bytes);

  assert.equal(parsed.feedTimestamp, 1_700_000_000);
  assert.equal(parsed.vehicles.length, 1);
  const vehicle = parsed.vehicles[0];
  assert.equal(vehicle.id, "ATAC-100");
  assert.equal(vehicle.tripId, "trip-1");
  assert.equal(vehicle.routeId, "route-71");
  assert.ok(Math.abs(vehicle.lat - 41.9028) < 0.001);
  assert.ok(Math.abs(vehicle.lon - 12.4964) < 0.001);
  assert.equal(vehicle.bearing, 180);
  assert.equal(vehicle.ts, 1_700_000_001);
});

test("parseRomaVehiclePositionsFeed skips entities without valid coordinates", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const empty = parseRomaVehiclePositionsFeed(new Uint8Array([0x0a, 0x00]));
  assert.equal(empty.vehicles.length, 0);
  assert.equal(empty.feedTimestamp, null);
});

test("loadRomaRealtimeVehicles maps a fixture feed through the fetch boundary", async () => {
  const { loadRomaRealtimeVehicles } = await loadParser();
  const bytes = readFileSync(fixturePath);
  const view = await loadRomaRealtimeVehicles(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }));
  assert.equal(view.status, "ok");
  assert.equal(view.vehicleCount, 1);
  assert.equal(view.vehicles[0].id, "ATAC-100");
});

test("loadRomaRealtimeVehicles fails closed on upstream errors", async () => {
  const { loadRomaRealtimeVehicles } = await loadParser();
  await assert.rejects(
    () =>
      loadRomaRealtimeVehicles(async () => ({
        ok: false,
        status: 503,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    /upstream_503/,
  );
});
