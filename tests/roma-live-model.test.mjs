import "./helpers/register-ts-alias.mjs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const model = await import(pathToFileURL(join(root, "src/lib/mobilita/roma-live-model.ts")).href);

// Reference vector from the encoded polyline format specification.
test("decodePolyline returns [lon, lat] pairs at 1e-5 precision", () => {
  const points = model.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(points, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
  assert.deepEqual(model.decodePolyline(""), []);
});

function encode(points) {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  for (const [lon, lat] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLon = Math.round(lon * 1e5);
    for (let delta of [iLat - pLat, iLon - pLon]) {
      let value = delta < 0 ? ~(delta << 1) : delta << 1;
      while (value >= 0x20) {
        out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
        value >>= 5;
      }
      out += String.fromCharCode(value + 63);
    }
    pLat = iLat;
    pLon = iLon;
  }
  return out;
}

// Line 64 runs west along an east-west street; its return pattern runs east.
// A short variant (dir 0) shares the street but ends earlier at stop "C".
const RAW = {
  schema: 1,
  source: { holder: "test", sha256: "x" },
  agencies: { OP1: "Atac" },
  routes: [
    ["64", "64", 3, "", "OP1", ""],
    ["8", "8", 0, "", "OP1", ""],
    ["H", "H", 3, "", "OP1", ""],
    ["640", "640", 3, "", "OP1", ""],
    ["MEA", "MEA", 1, "E27439", "OP1", ""],
  ],
  stops: [
    ["A", "STAZ.NE TERMINI (MA-MB-FS)", 12.5, 41.9],
    ["B", "NAZIONALE/QUIRINALE", 12.49, 41.9],
    ["C", "LARGO ARGENTINA", 12.48, 41.9],
    ["D", "S. PIETRO", 12.46, 41.9],
  ],
  patterns: [
    [0, 0, "S. PIETRO", [0, 1, 2, 3], encode([[12.5, 41.9], [12.46, 41.9]]), 120],
    [0, 0, "LARGO ARGENTINA", [0, 1, 2], encode([[12.5, 41.9], [12.48, 41.9]]), 10],
    [0, 1, "STAZ.NE TERMINI (MA-MB-FS)", [3, 2, 1, 0], encode([[12.46, 41.9], [12.5, 41.9]]), 118],
    [3, 0, "X", [0, 3], encode([[12.5, 41.9], [12.46, 41.9]]), 5],
  ],
};

test("buildNetwork indexes routes, stops and patterns by id", () => {
  const network = model.buildNetwork(RAW);
  assert.equal(network.routes.get("64").patterns.length, 3);
  assert.equal(network.stopById.get("B").name, "NAZIONALE/QUIRINALE");
  assert.equal(network.routes.get("MEA").color, "#E27439");
  assert.equal(network.routes.get("64").color, null);
});

test("buildNetwork rejects an unknown schema instead of guessing", () => {
  assert.throws(() => model.buildNetwork({ ...RAW, schema: 2 }), /schema/);
});

test("matchPattern prefers the variant that serves the vehicle's current stop", () => {
  const network = model.buildNetwork(RAW);
  const base = { id: "1", routeId: "64", directionId: 0, lat: 41.9, lon: 12.485 };
  assert.equal(model.matchPattern(network, { ...base, stopId: "D" }).pattern.headsign, "S. PIETRO");
  // Without a stop, the most frequent pattern of that direction wins.
  assert.equal(model.matchPattern(network, base).pattern.headsign, "S. PIETRO");
  // Direction 1 never returns a direction-0 pattern.
  assert.equal(
    model.matchPattern(network, { ...base, directionId: 1, stopId: "B" }).pattern.headsign,
    "STAZ.NE TERMINI (MA-MB-FS)",
  );
  assert.equal(model.matchPattern(network, { ...base, routeId: "999" }), null);
});

test("vehicle heading comes from bearing, else from the matched path direction", () => {
  const network = model.buildNetwork(RAW);
  const westbound = { id: "1", routeId: "64", directionId: 0, lat: 41.9, lon: 12.485 };
  const match = model.matchPattern(network, westbound);
  assert.ok(Math.abs(model.vehicleHeading(westbound, match) - 270) < 1);
  const eastbound = { ...westbound, directionId: 1 };
  assert.ok(Math.abs(model.vehicleHeading(eastbound, model.matchPattern(network, eastbound)) - 90) < 1);
  assert.equal(model.vehicleHeading({ ...westbound, bearing: 12 }, match), 12);
  assert.equal(model.vehicleHeading({ ...westbound, routeId: "999" }, null), null);
});

test("upcomingStops starts at the stop the vehicle is heading to and ends at the terminus", () => {
  const network = model.buildNetwork(RAW);
  const vehicle = { id: "1", routeId: "64", directionId: 0, lat: 41.9, lon: 12.485, stopId: "C" };
  const { pattern } = model.matchPattern(network, vehicle);
  const upcoming = model.upcomingStops(network, pattern, vehicle);
  assert.deepEqual(
    upcoming.stops.map((s) => [s.stop.id, s.state]),
    [
      ["C", "next"],
      ["D", "later"],
    ],
  );
  assert.equal(upcoming.passed, 2);
  const stopped = model.upcomingStops(network, pattern, { ...vehicle, status: "stopped" });
  assert.equal(stopped.stops[0].state, "here");
  // Unknown stop: the whole pattern is listed, nothing is marked as next.
  const unknown = model.upcomingStops(network, pattern, { ...vehicle, stopId: "ZZ" });
  assert.equal(unknown.stops.length, 4);
  assert.equal(unknown.passed, 0);
  assert.ok(unknown.stops.every((s) => s.state === "later"));
});

test("searchRoutes ranks exact line numbers before prefixes and finds fleet numbers", () => {
  const network = model.buildNetwork(RAW);
  const vehicles = [
    { id: "52", label: "8628", routeId: "64", lat: 41.9, lon: 12.48 },
    { id: "53", label: "0101", routeId: "640", lat: 41.9, lon: 12.48 },
  ];
  const results = model.searchRoutes(network, vehicles, "64");
  assert.deepEqual(
    results.slice(0, 2).map((r) => [r.kind, r.route?.id]),
    [
      ["route", "64"],
      ["route", "640"],
    ],
  );
  assert.equal(model.searchRoutes(network, vehicles, " h ")[0].route.id, "H");
  const fleet = model.searchRoutes(network, vehicles, "8628");
  assert.equal(fleet[0].kind, "vehicle");
  assert.equal(fleet[0].vehicle.id, "52");
  assert.deepEqual(model.searchRoutes(network, vehicles, ""), []);
  assert.deepEqual(model.searchRoutes(network, vehicles, "<script>"), []);
});

test("freshness separates recent, ageing and stale positions; unknown is not fresh", () => {
  assert.equal(model.freshness(30), "fresh");
  assert.equal(model.freshness(150), "aging");
  assert.equal(model.freshness(301), "stale");
  assert.equal(model.freshness(null), "unknown");
  assert.equal(model.formatAge(4), "adesso");
  assert.equal(model.formatAge(42), "42 s fa");
  assert.equal(model.formatAge(125), "2 min fa");
  assert.equal(model.formatAge(null), "ora non indicata");
});

test("displayName keeps codes and abbreviations readable", () => {
  assert.equal(model.displayName("STAZ.NE TERMINI (MA-MB-FS)"), "Staz.ne Termini (MA-MB-FS)");
  assert.equal(model.displayName("NAZIONALE/QUIRINALE"), "Nazionale/Quirinale");
  assert.equal(model.displayName("S. PIETRO"), "S. Pietro");
  assert.equal(model.displayName("VIA DELL'AMBA ARADAM"), "Via dell'Amba Aradam");
  assert.equal(model.displayName("CINECITTA' (MA)"), "Cinecittà (MA)");
});

// Coverage: scheduled trips in progress per line, from the static timetable.
// Profile values are base-62 chars per 10-minute bin over 0..30h of the
// service day, so trips after midnight belong to the previous service date.
const COVERAGE = {
  schema: 1,
  binMinutes: 10,
  bins: 180,
  timezone: "Europe/Rome",
  dates: { "2026-11-15": 0, "2026-11-16": 1 },
  profiles: [
    // Sunday: line 64 still running at 24:30 (bin 147) of the 15th.
    { "64": "0".repeat(147) + "2" + "0".repeat(32) },
    // Monday: 9 trips of 64 at 08:00 (bin 48), 61 ("Z") of H at 08:00.
    { "64": "0".repeat(48) + "9" + "0".repeat(131), H: "0".repeat(48) + "Z" + "0".repeat(131) },
  ],
};

test("scheduledNow reads the bin of the Rome service day", () => {
  // 2026-11-16 08:05 Rome (UTC+1) = 07:05Z
  const at = Date.parse("2026-11-16T07:05:00Z") / 1000;
  const now = model.scheduledNow(COVERAGE, at);
  assert.equal(now.byRoute.get("64"), 9);
  assert.equal(now.byRoute.get("H"), 61);
  assert.equal(now.total, 70);
});

test("scheduledNow adds trips after midnight from the previous service date", () => {
  // 2026-11-16 00:35 Rome = 2026-11-15 23:35Z → bin 147 of the 15th (24:30)
  const at = Date.parse("2026-11-15T23:35:00Z") / 1000;
  const now = model.scheduledNow(COVERAGE, at);
  assert.equal(now.byRoute.get("64"), 2);
});

test("scheduledNow returns null outside the published calendar instead of zero", () => {
  const at = Date.parse("2027-02-01T10:00:00Z") / 1000;
  assert.equal(model.scheduledNow(COVERAGE, at), null);
  assert.throws(() => model.scheduledNow({ ...COVERAGE, schema: 9 }, at), /schema/);
});

test("searchStops matches names without accents and codes exactly, ranked by prefix", () => {
  const network = model.buildNetwork({
    ...RAW,
    stops: [
      ...RAW.stops,
      ["70001", "CINECITTA' (MA)", 12.57, 41.85],
      ["70002", "VIA CINECITTÀ/TUSCOLANA", 12.57, 41.85],
    ],
  });
  const byName = model.searchStops(network, "cinecitta");
  assert.deepEqual(
    byName.map((s) => s.id),
    ["70001", "70002"],
  );
  assert.equal(model.searchStops(network, "70002")[0].id, "70002");
  assert.deepEqual(model.searchStops(network, "termini").map((s) => s.id), ["A"]);
  assert.deepEqual(model.searchStops(network, "x"), [], "una lettera non basta");
});

test("delayBucket separates early, on time, late and unknown", () => {
  assert.equal(model.delayBucket(-180), "early");
  assert.equal(model.delayBucket(-30), "ontime");
  assert.equal(model.delayBucket(100), "ontime");
  assert.equal(model.delayBucket(200), "late");
  assert.equal(model.delayBucket(400), "verylate");
  assert.equal(model.delayBucket(null), "unknown");
  assert.equal(model.formatDelay(-180), "3 min in anticipo");
  assert.equal(model.formatDelay(30), "in orario");
  assert.equal(model.formatDelay(400), "+7 min");
  assert.equal(model.formatDelay(null), null);
});

test("formatEta says 'in arrivo' under a minute and never shows negative minutes", () => {
  assert.equal(model.formatEta(20), "in arrivo");
  assert.equal(model.formatEta(-25), "in arrivo");
  assert.equal(model.formatEta(61), "1 min");
  assert.equal(model.formatEta(14 * 60 + 40), "15 min");
});

test("searchStops prefers stops served by more lines within the same match quality", () => {
  const network = model.buildNetwork({
    ...RAW,
    stops: [...RAW.stops, ["MT1", "TERMINI", 12.501, 41.901], ["05000", "TERMINI (MA-MB-FS)", 12.5004, 41.9013]],
    patterns: [
      ...RAW.patterns,
      [4, 0, "BATTISTINI", [4, 0], encode([[12.501, 41.901], [12.5, 41.9]]), 50],
      [0, 0, "S. PIETRO", [5, 3], encode([[12.5, 41.9], [12.46, 41.9]]), 10],
      [2, 0, "X", [5, 3], encode([[12.5, 41.9], [12.46, 41.9]]), 10],
    ],
  });
  assert.equal(network.stopById.get("05000").routes, 2);
  assert.deepEqual(
    model.searchStops(network, "termini").map((s) => s.id),
    ["05000", "MT1", "A"],
  );
});
