import assert from "node:assert/strict";
import test from "node:test";
import { makeMap } from "./fixtures/politici-atlas.mjs";
import { atlasUrl, belongsToScope, defaultSelection, filteredPeople, initialsOf, isSafeExternalUrl, longDate, matchesRole, normalizeSearch, readAtlasState, searchAtlas, selectionPeople, validSelection } from "../src/app/politici/atlas-model.ts";
import { adjacentSeat, allocateRows, buildChamberScene, buildSeatGrid, CHAMBER } from "../src/app/politici/graph-geometry.ts";
import { buildOverviewGeometry, overviewAnchor } from "../src/app/politici/overview-geometry.ts";

const map = makeMap();
const state = readAtlasState(new URLSearchParams(), map).state;

test("default is Camera, all controls derive from the same state", () => {
  assert.equal(state.scope, "camera"); assert.deepEqual(state.selection, defaultSelection("camera"));
  assert.equal(filteredPeople(map, state).length, 398);
  assert.equal(filteredPeople(map, { ...state, scope: "senato" }).length, 205);
  assert.equal(filteredPeople(map, { ...state, scope: "repubblica" }).length, map.people.length);
  assert.equal(filteredPeople(map, { ...state, scope: "grafo" }).length, map.people.length);
  assert.equal(filteredPeople(map, { ...state, scope: "condanne" }).length, map.people.length);
  assert.deepEqual(defaultSelection("grafo"), { kind: "overview" });
  assert.deepEqual(defaultSelection("condanne"), { kind: "overview" });
});

test("Camera filtering never leaks ministers from the other chamber", () => {
  const rows = filteredPeople(map, { ...state, role: "governo" });
  assert.ok(rows.length > 0); assert.ok(rows.every((person) => person.chamberId === "camera" && person.government));
  assert.equal(belongsToScope(map.people.find((person) => person.id === "gov-1"), "camera"), false);
});

test("search is accent and apostrophe insensitive, supports tokens and groups", () => {
  assert.equal(normalizeSearch("  D’Àngelo  "), "d angelo");
  assert.equal(filteredPeople(map, { ...state, query: "d'angelo" })[0].id, "dep-2");
  assert.ok(filteredPeople(map, { ...state, query: "valle anna" }).some((person) => person.id === "dep-3"));
  const hits = searchAtlas(map, "Forza Italia");
  assert.ok(hits.some((hit) => hit.selection.kind === "group"));
  assert.ok(searchAtlas(map, "ricci").some((hit) => hit.selection.id === "dep-0"));
  assert.deepEqual(searchAtlas(map, ""), []);
  assert.equal(searchAtlas(map, "persona", 3).length, 3);
});

test("invalid and legacy deep links degrade explicitly without unknown entities", () => {
  const legacy = readAtlasState(new URLSearchParams("deputy=2"), map);
  assert.equal(legacy.state.selection.id, "dep-2"); assert.equal(legacy.invalidSelection, false);
  const invalid = readAtlasState(new URLSearchParams("person=missing&vista=senato&famiglia=bogus&incarico=bogus"), map);
  assert.equal(invalid.invalidSelection, true); assert.deepEqual(invalid.state.selection, { kind: "institution", id: "senato" });
  assert.equal(invalid.state.family, null); assert.equal(invalid.state.role, "tutti");
  assert.equal(validSelection({ kind: "group", id: "missing" }, map), false);
});

test("URL round trips all controls, both hosts and unrelated query/hash", () => {
  for (const href of ["https://politici.dovevannoinostrisoldi.com/?utm_source=test#fonti", "https://www.dovevannoinostrisoldi.com/politici?utm_source=test#fonti"]) {
    const changed = { ...state, selection: { kind: "person", id: "dep-2" }, mode: "elenco", query: "Luca", family: map.people[2].family, role: "capigruppo" };
    const result = new URL(atlasUrl(href, changed), href);
    assert.equal(result.host, new URL(href).host); assert.equal(result.pathname, new URL(href).pathname);
    assert.equal(result.hash, "#fonti"); assert.equal(result.searchParams.get("utm_source"), "test");
    assert.deepEqual(readAtlasState(result.searchParams, map).state, changed);
    assert.equal(result.searchParams.has("deputy"), false);
  }
});

test("government deep links retain scope; cross-chamber groups resolve their own chamber", () => {
  assert.equal(readAtlasState(new URLSearchParams("vista=governo&person=dep-3"), map).state.scope, "governo");
  assert.equal(readAtlasState(new URLSearchParams(`group=${map.groups.find((group) => group.chamberId === "senato").id}`), map).state.scope, "senato");
  assert.equal(readAtlasState(new URLSearchParams("istituzione=presidenza-repubblica"), map).state.scope, "repubblica");
  assert.equal(readAtlasState(new URLSearchParams("vista=grafo"), map).state.scope, "grafo");
  assert.equal(readAtlasState(new URLSearchParams("vista=grafo&person=gov-1"), map).state.scope, "grafo");
  assert.equal(readAtlasState(new URLSearchParams("vista=grafo&istituzione=camera"), map).state.scope, "camera");
  assert.equal(readAtlasState(new URLSearchParams("vista=condanne"), map).state.scope, "condanne");
  assert.equal(readAtlasState(new URLSearchParams("vista=condanne&person=dep-2"), map).state.scope, "condanne");
});

test("selection membership, presidency role, and filters remain typed", () => {
  assert.equal(selectionPeople(map, { kind: "overview" }), null);
  assert.deepEqual([...selectionPeople(map, { kind: "institution", id: "presidenza-repubblica" })], ["pres-1"]);
  assert.equal(selectionPeople(map, { kind: "group", id: map.groups[0].id }).size, map.groups[0].memberCount);
  assert.ok(matchesRole(map.people[0], "presidenza"));
  assert.equal(matchesRole(map.people[3], "presidenza"), false);
  assert.equal(filteredPeople(map, { ...state, family: "missing" }).length, 0);
});

test("missing dates and initials never manufacture facts", () => {
  assert.equal(initialsOf("Anna Della Valle"), "AV"); assert.equal(initialsOf(""), "");
  assert.match(longDate("2024-02-29"), /29 febbraio 2024/);
  assert.equal(longDate("2025-02-29"), "Data non disponibile");
  assert.equal(longDate(null), "Data non disponibile");
  assert.equal(longDate("2026-13-05"), "Data non disponibile");
});

test("only ordinary HTTP(S) external URLs are rendered as links", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "https://user:password@example.org/", "not a url", null]) assert.equal(isSafeExternalUrl(url), false);
  for (const url of ["https://www.camera.it/", "http://www.senato.it/"]) assert.equal(isSafeExternalUrl(url), true);
});

test("row allocation exactly preserves every total from zero through 650", () => {
  for (let total = 0; total <= 650; total++) {
    const counts = allocateRows(total, [1, 2, 3, 5, 8]);
    assert.equal(counts.reduce((a, b) => a + b, 0), total);
    assert.ok(counts.every((count) => Number.isInteger(count) && count >= 0));
    const grid = buildSeatGrid(total, 10);
    assert.equal(grid.length, total);
    assert.ok(grid.every((seat) => Number.isFinite(seat.x) && Number.isFinite(seat.y) && seat.x >= 0 && seat.x <= CHAMBER.width && seat.y >= 0 && seat.y <= CHAMBER.height));
  }
});

test("geometry rejects unsafe input, handles empty and singleton diagrams", () => {
  for (const total of [-1, NaN, Infinity, 1.5, 10001]) assert.throws(() => allocateRows(total, [1]));
  assert.throws(() => allocateRows(1, [])); assert.throws(() => allocateRows(1, [0]));
  assert.throws(() => allocateRows(1, [Infinity]));
  assert.throws(() => buildSeatGrid(2, 0));
  assert.deepEqual(buildSeatGrid(0, 8), []); assert.equal(buildSeatGrid(1, 8).length, 1);
});

test("each parliamentary identity has exactly one seat; no duplicated ministers", () => {
  for (const id of ["camera", "senato"]) {
    const scene = buildChamberScene(map, id);
    const ids = scene.seats.flatMap((seat) => seat.personId ? [seat.personId] : []);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(ids.length, map.people.filter((person) => person.chamberId === id).length);
    assert.equal(scene.wedges.reduce((sum, wedge) => sum + wedge.count, 0), ids.length);
    assert.deepEqual(buildChamberScene(map, id), scene);
  }
  assert.equal(buildChamberScene(map, "camera").seats.filter((seat) => !seat.personId).length, 2);
  assert.equal(buildChamberScene(map, "senato").vacancies, null);
  assert.equal(buildChamberScene(map, "senato").capacity, null);
});

test("chairs never overlap in the normal Camera and Senate distributions", () => {
  for (const chamber of ["camera", "senato"]) {
    const seats = buildChamberScene(map, chamber).seats;
    for (let a = 0; a < seats.length; a++) for (let b = a + 1; b < seats.length; b++) {
      assert.ok(Math.hypot(seats[a].x - seats[b].x, seats[a].y - seats[b].y) > 12, `${chamber}: overlapping ${a}/${b}`);
    }
  }
});

test("duplicate identities and negative vacancies stop the diagram", () => {
  const duplicate = structuredClone(map); duplicate.people.push(duplicate.people[0]);
  assert.throws(() => buildChamberScene(duplicate, "camera"), /duplicata/);
  const invalid = structuredClone(map); invalid.institutions.find((item) => item.id === "camera").vacantSeats = -1;
  assert.throws(() => buildChamberScene(invalid, "camera"), /vacanti/);
});

test("keyboard navigation excludes vacant seats and keeps focus in the chamber", () => {
  const seats = buildChamberScene(map, "camera").seats;
  const available = seats.filter((seat) => seat.personId);
  assert.equal(adjacentSeat(seats, "missing", "Home"), available[0].id);
  assert.equal(adjacentSeat(seats, available[0].id, "End"), available.at(-1).id);
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) assert.ok(available.some((seat) => seat.id === adjacentSeat(seats, available[10].id, key)));
  assert.equal(adjacentSeat(seats, available[0].id, "Tab"), null);
  assert.equal(adjacentSeat([], "missing", "Home"), null);
});

test("institutional overview geometry stays deterministic and anchors hierarchy edges", () => {
  const wide = buildOverviewGeometry(map, "wide");
  const again = buildOverviewGeometry(map, "wide");
  assert.equal(wide.width, 1200);
  assert.equal(wide.headOfState?.personId, "pres-1");
  assert.equal(wide.primeMinister?.personId, "gov-1");
  assert.equal(wide.cards.length, 2);
  assert.ok(wide.cards.every((card) => card.wedges.every((wedge) => wedge.seatCount > 0 && wedge.bandPath.includes("M "))));
  assert.deepEqual(wide, again);
  assert.ok(overviewAnchor("presidenza-repubblica", wide));
  assert.ok(overviewAnchor("governo", wide));
  assert.ok(overviewAnchor("camera", wide));
  assert.equal(overviewAnchor("missing", wide), null);
  const stacked = buildOverviewGeometry(map, "stacked");
  assert.equal(stacked.width, 900);
  assert.ok(stacked.height > wide.height);
});
