import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { utm32n, toItalyMap } = await import("../src/lib/italy-map-projection.ts");
const { italyRegionGeometry } = await import("../src/data/generated/italy-regions.ts");

function polygons(path) {
  return path.split("Z").filter(Boolean).map((part) =>
    part.split(/(?=[ML])/).map((command) => command.slice(1).split(" ").map(Number)));
}

function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function regionAt(latitude, longitude) {
  const point = toItalyMap(latitude, longitude);
  return italyRegionGeometry.find((region) => polygons(region.path).some((ring) => inside(point, ring)))?.name ?? null;
}

test("UTM 32N matches the reference value on the central meridian", () => {
  const [easting, northing] = utm32n(45, 9);
  assert.ok(Math.abs(easting - 500_000) < 0.01);
  assert.ok(Math.abs(northing - 4_982_950.4) < 0.5);
});

test("known cities fall inside their region on the ISTAT map", () => {
  assert.equal(regionAt(41.8933, 12.4829), "Lazio");
  assert.equal(regionAt(45.4642, 9.19), "Lombardia");
  assert.equal(regionAt(40.8518, 14.2681), "Campania");
  assert.equal(regionAt(38.1157, 13.3615), "Sicilia");
  assert.equal(regionAt(39.2238, 9.1217), "Sardegna");
  assert.equal(regionAt(46.4983, 11.3548), "Trentino-Alto Adige/Südtirol");
});
