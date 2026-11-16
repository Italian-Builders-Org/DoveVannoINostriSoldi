import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libPath = join(root, "src/lib/mobilita/roma-gtfs-realtime.ts");

async function loadParser() {
  return import(pathToFileURL(libPath).href);
}

import { dField, fField, mField, sField, vField } from "./helpers/gtfs-rt-encoder.mjs";

function vehicleEntity({
  entityId,
  tripId,
  routeId,
  directionId,
  startTime,
  vehicleId,
  label,
  lat,
  lon,
  bearing,
  status,
  stopId,
  stopSequence,
  timestamp,
  occupancy,
}) {
  const trip = [];
  if (tripId) trip.push(...sField(1, tripId));
  if (startTime) trip.push(...sField(2, startTime));
  trip.push(...sField(3, "20261116"));
  if (routeId) trip.push(...sField(5, routeId));
  if (directionId !== undefined) trip.push(...vField(6, directionId));
  const position = [...fField(1, lat), ...fField(2, lon)];
  if (bearing !== undefined) position.push(...fField(3, bearing));
  position.push(...dField(4, 12345.5)); // odometer, ignored
  const descriptor = [...sField(1, vehicleId)];
  if (label) descriptor.push(...sField(2, label));
  const vehicle = [
    ...mField(1, trip),
    ...mField(8, descriptor),
    ...mField(2, position),
  ];
  if (stopSequence !== undefined) vehicle.push(...vField(3, stopSequence));
  if (stopId) vehicle.push(...sField(7, stopId));
  if (status !== undefined) vehicle.push(...vField(4, status));
  if (timestamp !== undefined) vehicle.push(...vField(5, timestamp));
  if (occupancy !== undefined) vehicle.push(...vField(9, occupancy));
  return mField(2, [...sField(1, entityId), ...vField(2, 0), ...mField(4, vehicle)]);
}

function feed(entities, timestamp = 1_794_840_598) {
  const header = [...sField(1, "2.0"), ...vField(2, 0), ...vField(3, timestamp)];
  return Uint8Array.from([...mField(1, header), ...entities.flat()]);
}

const BUS_64 = {
  entityId: "1",
  tripId: "0#1898-20",
  routeId: "64",
  directionId: 1,
  startTime: "15:32:00",
  vehicleId: "52",
  label: "8628",
  lat: 41.9012,
  lon: 12.5004,
  bearing: 270,
  status: 2,
  stopId: "70001",
  stopSequence: 14,
  timestamp: 1_794_840_562,
  occupancy: 1,
};

test("parser reads timestamp from field 5, not current_status (field 4)", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const parsed = parseRomaVehiclePositionsFeed(feed([vehicleEntity(BUS_64)]));
  assert.equal(parsed.feedTimestamp, 1_794_840_598);
  assert.equal(parsed.vehicles.length, 1);
  const [vehicle] = parsed.vehicles;
  assert.equal(vehicle.ts, 1_794_840_562);
  assert.equal(vehicle.status, "in_transit");
});

test("parser keeps the fields a rider needs to follow a vehicle", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const [vehicle] = parseRomaVehiclePositionsFeed(feed([vehicleEntity(BUS_64)])).vehicles;
  assert.equal(vehicle.id, "52");
  assert.equal(vehicle.label, "8628");
  assert.equal(vehicle.routeId, "64");
  assert.equal(vehicle.tripId, "0#1898-20");
  assert.equal(vehicle.directionId, 1);
  assert.equal(vehicle.startTime, "15:32:00");
  assert.equal(vehicle.stopId, "70001");
  assert.equal(vehicle.bearing, 270);
  assert.equal(vehicle.occupancy, 1);
  assert.ok(Math.abs(vehicle.lat - 41.9012) < 1e-4);
  assert.ok(Math.abs(vehicle.lon - 12.5004) < 1e-4);
});

test("missing bearing, status and timestamp stay missing instead of becoming zero", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const [vehicle] = parseRomaVehiclePositionsFeed(
    feed([
      vehicleEntity({
        ...BUS_64,
        bearing: undefined,
        status: undefined,
        timestamp: undefined,
        occupancy: undefined,
        label: undefined,
      }),
    ]),
  ).vehicles;
  assert.equal("bearing" in vehicle, false);
  assert.equal("status" in vehicle, false);
  assert.equal("ts" in vehicle, false);
  assert.equal("occupancy" in vehicle, false);
  assert.equal("label" in vehicle, false);
});

test("parser drops vehicles outside a plausible Roma area and invalid coordinates", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const parsed = parseRomaVehiclePositionsFeed(
    feed([
      vehicleEntity(BUS_64),
      vehicleEntity({ ...BUS_64, entityId: "2", vehicleId: "53", lat: 0, lon: 0 }),
      vehicleEntity({ ...BUS_64, entityId: "3", vehicleId: "54", lat: Number.NaN }),
    ]),
  );
  assert.deepEqual(
    parsed.vehicles.map((v) => v.id),
    ["52"],
  );
  assert.equal(parsed.dropped, 2);
});

test("parser fails closed on truncated protobuf", async () => {
  const { parseRomaVehiclePositionsFeed } = await loadParser();
  const bytes = feed([vehicleEntity(BUS_64)]);
  assert.throws(() => parseRomaVehiclePositionsFeed(bytes.subarray(0, bytes.length - 7)));
  const empty = parseRomaVehiclePositionsFeed(new Uint8Array([0x0a, 0x00]));
  assert.equal(empty.vehicles.length, 0);
  assert.equal(empty.feedTimestamp, null);
});

function okFetch(bytes, headers = {}) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

test("loadRomaRealtimeVehicles reports feed age and flags a stale feed", async () => {
  const { loadRomaRealtimeVehicles } = await loadParser();
  const bytes = feed([vehicleEntity(BUS_64)], 1_794_840_598);
  const fresh = await loadRomaRealtimeVehicles(okFetch(bytes), () => 1_794_840_620_000);
  assert.equal(fresh.status, "ok");
  assert.equal(fresh.vehicleCount, 1);
  assert.equal(fresh.feedAgeSeconds, 22);
  assert.equal(fresh.stale, false);
  const stale = await loadRomaRealtimeVehicles(okFetch(bytes), () => 1_794_841_598_000);
  assert.equal(stale.stale, true);
});

test("loadRomaRealtimeVehicles fails closed on upstream errors and oversize bodies", async () => {
  const { loadRomaRealtimeVehicles } = await loadParser();
  await assert.rejects(
    () =>
      loadRomaRealtimeVehicles(async () => ({
        ok: false,
        status: 503,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    /upstream_503/,
  );
  await assert.rejects(
    () =>
      loadRomaRealtimeVehicles(
        okFetch(new Uint8Array(10), { "content-length": String(50_000_000) }),
      ),
    /upstream_size/,
  );
});

test("vehicle feed retries one transient network failure", async () => {
  const { loadRomaRealtimeVehicles } = await loadParser();
  const bytes = feed([vehicleEntity(BUS_64)], 1_794_840_598);
  let calls = 0;
  const view = await loadRomaRealtimeVehicles(async (...args) => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return okFetch(bytes)(...args);
  }, () => 1_794_840_620_000);
  assert.equal(view.vehicleCount, 1);
  assert.equal(calls, 2);
});
