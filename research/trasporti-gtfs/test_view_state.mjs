import test from "node:test";
import assert from "node:assert/strict";
import { readView, viewURL } from "./view-state.mjs";
const cities = [{ id: "torino" }, { id: "palermo" }];
test("shared view round-trips filters, stop identity and camera without losing preview version", () => {
  const state = {
    city: "palermo",
    band: "evening",
    route: "SIR 1 / A",
    speed: 0,
    sort: "trips-desc",
    mode: "2d",
    stop: "id/42",
    segment: null,
    camera: [120, -300, 220, -150, 45, 1.2],
  };
  const url = viewURL(
    "http://localhost:3274/?v=example&unrelated=value#old",
    state,
  );
  assert.equal(new URL(url).searchParams.get("v"), "example");
  assert.equal(new URL(url).hash, "");
  assert.deepEqual(readView(new URL(url).search, cities), state);
});
test("untrusted URL cannot choose unknown city, invalid filters or nonfinite/unbounded camera", () => {
  const state = readView(
    "?city=unknown&band=no&speed=9&mode=webgl&route=" +
      "x".repeat(101) +
      "&camera=0,0,Infinity,0,40,1",
    cities,
  );
  assert.equal(state.city, "torino");
  assert.equal(state.band, "morning");
  assert.equal(state.route, "");
  assert.equal(state.speed, null);
  assert.equal(state.mode, "3d");
  assert.equal(state.camera, null);
  for (const camera of [
    "1,2,99999,0,40,1",
    "1,2,100,900,40,1",
    "1,2,100,0,90,1",
    "1,2,100,0,40,9",
    "1,2,,0,40,1",
    "0,0,100,0,45",
  ])
    assert.equal(readView("?camera=" + camera, cities).camera, null, camera);
});
test("a shared link removes stale selection and filters instead of reusing its previous query", () => {
  const state = {
    city: "torino",
    band: "morning",
    route: "",
    speed: null,
    sort: "speed-asc",
    mode: "3d",
    stop: null,
    segment: null,
    camera: null,
  };
  const url = viewURL(
    "https://example.test/?city=palermo&route=old&speed=2&stop=stale&segment=0123456789abcdef&camera=1,2,100,0,45,1",
    state,
  );
  assert.deepEqual(readView(new URL(url).search, cities), state);
});
test("stop and segment identities are bounded; malformed camera never partially changes the view", () => {
  assert.equal(
    readView(
      "?stop=" +
        encodeURIComponent("x\ny") +
        "&segment=not-an-id&camera=1,2,100,0,45,1,2",
      cities,
    ).stop,
    null,
  );
  assert.equal(
    readView("?segment=0123456789abcdef", cities).segment,
    "0123456789abcdef",
  );
  assert.equal(readView("?stop=" + "x".repeat(121), cities).stop, null);
});

test("sorting links accept only bounded known orders and keep old URLs compatible", () => {
  assert.equal(readView("?sort=trips-asc", cities).sort, "trips-asc");
  assert.equal(readView("?sort=bad", cities).sort, "speed-asc");
  assert.equal(readView("", cities).sort, "speed-asc");
  assert.equal(
    readView(
      new URL(
        viewURL("https://example.test/?sort=trips-desc", { sort: "speed-asc" }),
      ).search,
      cities,
    ).sort,
    "speed-asc",
  );
});
