import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { getRepubblicaMap, getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");
import { buildChamberScene } from "../src/app/politici/graph-geometry.ts";
import { atlasUrl, filteredPeople, readAtlasState, searchAtlas } from "../src/app/politici/atlas-model.ts";
const { parseProfiles } = await import("../src/app/politici/atlas-data.ts");

// No synthetic fixtures: these contracts run against the repository's validated snapshot.
const map = getRepubblicaMap();

test("published roster reconciles with chairs and group legends for both chambers", () => {
  for (const chamberId of ["camera", "senato"]) {
    const scene = buildChamberScene(map, chamberId);
    const roster = map.people.filter((person) => person.chamberId === chamberId);
    assert.deepEqual(scene.seats.flatMap((seat) => seat.personId ? [seat.personId] : []).sort(), roster.map((person) => person.id).sort());
    const institution = map.institutions.find((item) => item.id === chamberId);
    assert.equal(scene.vacancies, institution.vacantSeats);
    assert.equal(scene.capacity, institution.seatCapacity);
    for (const wedge of scene.wedges) {
      assert.equal(wedge.count, map.groups.find((group) => group.id === wedge.groupId).memberCount);
    }
  }
});

test("all published profiles satisfy the rendering boundary without losing fields", () => {
  const profiles = getRepubblicaProfiles();
  assert.deepEqual(parseProfiles({ profiles }), profiles);
  for (const person of map.people) assert.ok(profiles[person.id], person.id);
});

test("every published person has a round-trippable link and searchable name", () => {
  for (const person of map.people) {
    const parsed = readAtlasState(new URLSearchParams({ person: person.id }), map);
    assert.equal(parsed.invalidSelection, false);
    const url = new URL(atlasUrl("https://www.dovevannoinostrisoldi.com/politici", parsed.state), "https://www.dovevannoinostrisoldi.com");
    assert.deepEqual(readAtlasState(url.searchParams, map).state, parsed.state);
    assert.ok(searchAtlas(map, person.name, map.people.length + map.groups.length).some((hit) => hit.selection.kind === "person" && hit.selection.id === person.id));
  }
});

test("government membership and Camera attendance remain different scopes", () => {
  const state = readAtlasState(new URLSearchParams("vista=governo"), map).state;
  assert.equal(filteredPeople(map, state).length, map.coverage.governmentMembers);
  const cameraPeople = new Set(map.people.filter((person) => person.chamberId === "camera").map((person) => person.id));
  for (const row of map.cameraAttendanceRanking.rows) assert.ok(cameraPeople.has(row.personId));
  const crossRole = filteredPeople(map, { ...state, scope: "camera", role: "governo" });
  assert.ok(crossRole.every((person) => person.chamberId === "camera" && person.government));
});
