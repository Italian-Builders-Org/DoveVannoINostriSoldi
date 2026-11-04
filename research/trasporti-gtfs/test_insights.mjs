import test from "node:test";
import assert from "node:assert/strict";
import {
  rampColor,
  networkProfile,
  speedHistogram,
  slowestSegments,
  bandComparison,
} from "./insights.mjs";

const seg = (id, route, metres, seconds, samples = 6, extra = {}) => ({
  id,
  route,
  metres,
  from: "A" + id,
  to: "B" + id,
  bands: {
    morning: { seconds, samples, kmh: (metres / seconds) * 3.6 },
    ...extra,
  },
});

test("ramp is continuous, clamped and keeps slow segments dark", () => {
  assert.equal(rampColor(-3), rampColor(0));
  assert.equal(rampColor(40), rampColor(12));
  assert.notEqual(rampColor(2), rampColor(8));
  const lum = (hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .reduce((a, b) => a + b);
  assert.ok(lum(rampColor(12)) < lum(rampColor(1)));
  assert.match(rampColor(Number.NaN), /^#[0-9a-f]{6}$/);
});

test("network speed weights by time, not by averaging segment speeds", () => {
  // 1 km in 60 s (60 km/h) and 1 km in 600 s (6 km/h): 2 km in 660 s.
  const p = networkProfile(
    [seg("a", "1", 1000, 60), seg("b", "1", 1000, 600)],
    "morning",
  );
  assert.equal(p.segments, 2);
  assert.equal(p.routes, 1);
  assert.equal(p.km, 2);
  assert.ok(Math.abs(p.kmh - (2000 / 660) * 3.6) < 1e-9);
  assert.equal(p.medianKmh, (60 + 6) / 2);
});

test("empty or missing band yields no invented values", () => {
  const p = networkProfile([seg("a", "1", 1000, 60)], "evening");
  assert.equal(p.segments, 0);
  assert.equal(p.kmh, null);
  assert.equal(p.medianKmh, null);
  assert.deepEqual(
    speedHistogram([], "morning").map((b) => b.km),
    speedHistogram([], "morning").map(() => 0),
  );
});

test("histogram buckets by length and covers every speed once", () => {
  const bins = speedHistogram(
    [
      seg("a", "1", 1000, 900), // 4 km/h
      seg("b", "1", 2000, 240), // 30 km/h
      seg("c", "1", 500, 9), // 200 km/h, open-ended last bin
    ],
    "morning",
  );
  assert.equal(
    bins.reduce((sum, b) => sum + b.km, 0),
    3.5,
  );
  assert.equal(bins[0].km, 1);
  assert.equal(bins.at(-1).km, 0.5);
  assert.equal(bins.at(-1).to, Infinity);
  for (let i = 1; i < bins.length; i++)
    assert.equal(bins[i].from, bins[i - 1].to);
});

test("slowest list skips short or rare segments and repeats of one route", () => {
  const list = slowestSegments(
    [
      seg("short", "1", 60, 120), // too short to read as a stretch
      seg("rare", "2", 600, 600, 1), // a single scheduled trip
      seg("a", "3", 600, 400),
      seg("a2", "3", 600, 420),
      seg("b", "4", 600, 300),
      seg("c", "5", 600, 100),
    ],
    "morning",
    { limit: 3 },
  );
  assert.deepEqual(
    list.map((s) => s.id),
    ["a2", "b", "c"],
  );
});

test("band comparison uses only segments present in every compared band", () => {
  const both = seg("a", "1", 1000, 120, 6, {
    day: { seconds: 60, samples: 6, kmh: 60 },
  });
  const morningOnly = seg("b", "1", 1000, 1000);
  const rows = bandComparison([both, morningOnly], ["morning", "day"]);
  assert.deepEqual(
    rows.map((r) => [r.band, Math.round(r.kmh)]),
    [
      ["morning", 30],
      ["day", 60],
    ],
  );
  assert.equal(rows[0].segments, 1);
});

test("rail networks use their own scale so slow trains stand out", async () => {
  const { scaleFor, rampColor: ramp, kmhColor: color, speedHistogram: hist } =
    await import("./insights.mjs");
  const urban = scaleFor("bus"),
    rail = scaleFor("train");
  assert.deepEqual(urban.classes, [10, 15, 25]);
  assert.equal(urban.maxMinPerKm, 12);
  assert.ok(rail.classes.every((c, i) => c > urban.classes[i]));
  // 30 km/h is fast in a city but slow for a train.
  assert.notEqual(color(30, urban), color(30, rail));
  assert.equal(color(30, rail), ramp(2, rail));
  assert.equal(ramp(rail.maxMinPerKm, rail), ramp(12));
  assert.equal(scaleFor("tram"), urban);
  assert.equal(scaleFor("unknown-mode"), urban);
  const bins = hist([], "morning", rail);
  assert.equal(bins.at(-1).to, Infinity);
  assert.ok(bins.at(-2).to > 100);
});
