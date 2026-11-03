import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStopIndex,
  searchStops,
  selectSegments,
  selectionCSV,
} from "./explorer.mjs";
const s = (id, kmh) => ({
  id,
  route: "8",
  direction: "0",
  fromId: "a",
  toId: "b",
  from: "Piazza Libertà",
  to: 'Stazione, "Centro"',
  metres: 120,
  bands: { morning: { kmh, seconds: 60, samples: 4 } },
});
const city = {
  id: "fixture",
  name: "Fixture",
  serviceDate: "2026-10-30",
  url: "https://example.invalid/gtfs.zip",
  receipt: { sha256: "fixture" },
  stops: [
    { id: "a", name: "Fermata 1 - Piazza Libertà", point: [7, 45] },
    { id: "b", name: "Stazione Centro", point: [7.001, 45.001] },
    { id: "c", name: "Stazione Centro", point: [7.01, 45.01] },
  ],
  segments: [s("one", 7), { ...s("two", 20), route: "10", fromId: "c" }],
};
test("stop lookup preserves distinct GTFS identities and official coordinates", () => {
  const index = buildStopIndex(city);
  assert.equal(index.length, 3);
  assert.deepEqual(index.find((s) => s.id === "c").point, [7.01, 45.01]);
  assert.equal(searchStops(index, "stazione", "", 8).length, 2);
  assert.deepEqual(
    searchStops(index, "stazione", "8", 8).map((s) => s.id),
    ["b"],
  );
});
test("search handles accents, multiple tokens, exact matches and bounded results", () => {
  const index = buildStopIndex(city);
  assert.equal(searchStops(index, "liberta piazza", "", 8)[0].id, "a");
  assert.equal(searchStops(index, "a", "", 8)[0].id, "a");
  assert.equal(searchStops(index, "stazione", "", 1).length, 1);
  assert.equal(searchStops(index, "no such stop", "", 8).length, 0);
});
test("invalid or duplicate stop coordinates fail instead of inventing map markers", () => {
  assert.throws(
    () =>
      buildStopIndex({
        ...city,
        stops: [{ id: "a", name: "Bad", point: [NaN, 45] }],
      }),
    /coordinate/i,
  );
  assert.throws(
    () => buildStopIndex({ ...city, stops: [city.stops[0], city.stops[0]] }),
    /duplicate/i,
  );
});
test("speed bands partition exact boundary values without changing data", () => {
  const values = [9.99, 10, 14.99, 15, 24.99, 25],
    segments = values.map((v, i) => s(String(i), v));
  assert.deepEqual(
    [0, 1, 2, 3].map(
      (speedClass) =>
        selectSegments(segments, { band: "morning", route: "8", speedClass })
          .length,
    ),
    [1, 2, 2, 1],
  );
  assert.equal(
    selectSegments(segments, { band: "evening", route: "8", speedClass: null })
      .length,
    0,
  );
  assert.equal(segments[0].bands.morning.kmh, 9.99);
});
test("CSV escapes source text, prevents formula injection, retains precise values and provenance", () => {
  const segment = {
    ...s("csv", 7.123),
    from: '=HYPERLINK("https://bad.invalid")',
    to: 'Stazione, "Centro"\nSeconda riga',
  };
  const csv = selectionCSV(city, [segment], "morning");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"Stazione, ""Centro""\nSeconda riga"'));
  assert.ok(csv.includes("7.123"));
  assert.ok(csv.includes("2026-10-30"));
  assert.ok(csv.includes("https://example.invalid/gtfs.zip"));
  assert.ok(csv.includes("fixture"));
});

test("sorting preserves filtering, stable ties, source order and precise CSV order", () => {
  const values = [
    s("z", 20),
    s("b", 10),
    s("a", 10),
    { ...s("other", 1), route: "9" },
  ];
  values[0].bands.morning.samples = 2;
  const before = structuredClone(values);
  const ids = (sort) =>
    selectSegments(values, { band: "morning", route: "8", sort }).map(
      (s) => s.id,
    );
  assert.deepEqual(ids("speed-asc"), ["a", "b", "z"]);
  assert.deepEqual(ids("speed-desc"), ["z", "a", "b"]);
  assert.deepEqual(ids("trips-desc"), ["a", "b", "z"]);
  assert.deepEqual(ids("trips-asc"), ["z", "a", "b"]);
  assert.deepEqual(ids("unexpected"), ids("speed-asc"));
  assert.deepEqual(values, before);
  const selected = selectSegments(values, {
    band: "morning",
    route: "8",
    speedClass: 1,
    sort: "speed-desc",
  });
  assert.deepEqual(
    selected.map((s) => s.id),
    ["a", "b"],
  );
  const csv = selectionCSV(
    city,
    selectSegments(values, { band: "morning", route: "8", sort: "speed-desc" }),
    "morning",
  );
  assert.ok(csv.indexOf("\r\nz,") < csv.indexOf("\r\na,"));
});

test("speed classes follow the network scale thresholds", () => {
  const segments = [s("a", 35), s("b", 80), s("c", 130)];
  const ids = (speedClass, classes) =>
    selectSegments(segments, { band: "morning", speedClass, classes }).map(
      (x) => x.id,
    );
  assert.deepEqual(ids(3), ["a", "b", "c"]);
  assert.deepEqual(ids(0, [40, 70, 100]), ["a"]);
  assert.deepEqual(ids(2, [40, 70, 100]), ["b"]);
  assert.deepEqual(ids(3, [40, 70, 100]), ["c"]);
});
