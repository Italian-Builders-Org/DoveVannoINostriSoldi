import test from "node:test";
import assert from "node:assert/strict";
import { groupAreas, sourceForArea, modeLabel } from "./catalog.mjs";
const sources = [
  { id: "milano", name: "Milano", mode: "tram", status: "ready" },
  {
    id: "milano-metro",
    name: "Milano",
    areaId: "milano",
    mode: "metro",
    status: "ready",
  },
  { id: "torino", name: "Torino", mode: "tram", status: "no-service" },
];
test("multimodal grouping preserves legacy source identities and reports only integrated modes", () => {
  const areas = groupAreas(sources);
  assert.equal(areas.length, 2);
  assert.deepEqual(
    areas[0].sources.map((s) => s.id),
    ["milano", "milano-metro"],
  );
  assert.equal(sourceForArea(areas, "milano", "metro").id, "milano-metro");
  assert.equal(sourceForArea(areas, "torino", "metro").id, "torino");
  assert.equal(sourceForArea(areas, "missing", "tram"), null);
  assert.equal(modeLabel("train"), "Treni");
});
test("duplicate area/mode and unknown transport fail rather than silently hiding data", () => {
  assert.throws(() =>
    groupAreas([
      ...sources,
      { id: "other", areaId: "milano", name: "Milano", mode: "tram" },
    ]),
  );
  assert.throws(() => groupAreas([{ id: "x", name: "X", mode: "flying" }]));
});

test("dataset identity cannot be reused by another mode or area", () => {
  assert.throws(() =>
    groupAreas([
      { id: "same", areaId: "a", name: "A", mode: "tram" },
      { id: "same", areaId: "b", name: "B", mode: "train" },
    ]),
  );
});

test("navigation remains a distinct usable network within the existing Venezia area", () => {
  const grouped = groupAreas([
    { id: "venezia", name: "Venezia", mode: "bus", status: "ready" },
    {
      id: "venezia-nav",
      name: "Venezia",
      areaId: "venezia",
      mode: "ferry",
      status: "ready",
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(sourceForArea(grouped, "venezia", "ferry").id, "venezia-nav");
  assert.equal(sourceForArea(grouped, "venezia", "bus").id, "venezia");
  assert.equal(modeLabel("ferry"), "Navigazione");
  assert.equal(modeLabel("funicular"), "Funicolari");
});
