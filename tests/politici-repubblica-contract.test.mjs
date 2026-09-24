import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getRepubblicaGraph, getRepubblicaMap, getRepubblicaProfiles, findRepublicPerson } = await import(
  "../src/lib/politici-repubblica.ts"
);

test("unified republic graph covers both chambers, government and the head of state", () => {
  const graph = getRepubblicaGraph();
  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.legislature.id, "19");
  assert.equal(graph.coverage.deputies, 398);
  assert.equal(graph.coverage.senators, 205);
  assert.equal(graph.coverage.governmentMembers, 66);
  assert.equal(graph.coverage.people, graph.people.length);
  assert.equal(graph.institutions.length, 4);
  assert.ok(graph.institutions.every((institution) => institution.leaderPersonId));
  assert.ok(findRepublicPerson("dep-302103")?.displayName.includes("Meloni"));
  assert.ok(findRepublicPerson("dep-307591")?.displayName.includes("Fontana"));
  assert.ok(graph.people.some((person) => person.primaryRoleKind === "capo-stato"));
  assert.ok(graph.people.some((person) => person.primaryRoleKind === "presidente-assemblea" && person.chamberId === "senato"));
  assert.equal(graph.coverage.peopleWithPhoto, graph.people.filter((person) => person.photoUrl).length);
  assert.ok(graph.coverage.peopleWithPhoto >= graph.coverage.people - 2);
  assert.ok(graph.edges.some((edge) => edge.kind === "gerarchia"));
  assert.ok(graph.edges.some((edge) => edge.kind === "famiglia-politica"));
  assert.match(graph.caveats.join(" "), /gruppi parlamentari|partiti come organizzazioni/i);
});

test("compact map keeps only navigation fields and matches person ids", () => {
  const graph = getRepubblicaGraph();
  const map = getRepubblicaMap();
  assert.equal(map.people.length, graph.people.length);
  assert.equal(map.groups.length, graph.groups.length);
  assert.ok(map.people.every((person) => typeof person.photo === "boolean"));
  assert.ok(map.people.every((person) => findRepublicPerson(person.id)));
  assert.equal("cameraAttendanceRanking" in map, false);
  assert.equal(map.education.all.total, map.people.length);
  assert.ok(map.education.camera.stemCount + map.education.senato.stemCount <= map.education.all.stemCount + map.education.governo.stemCount);
  assert.ok(map.education.all.areas.some((area) => area.area === "stem"));
});

test("Camera vote participation stays a sourced profile fact without ranks", () => {
  const profiles = Object.values(getRepubblicaProfiles());
  const attendance = profiles.find((profile) => profile.voteAttendance !== null)?.voteAttendance;

  assert.ok(attendance);
  assert.equal(attendance.chamber, "camera");
  assert.match(attendance.periodLabel, /legislatura|dal|al/i);
  assert.match(attendance.sourceUrl, /^https:\/\/www\.camera\.it\//);
  assert.equal("rank" in attendance, false);
  assert.equal("rankedAmong" in attendance, false);
});

test("declared portrait gaps stay without invented photos", () => {
  const missing = getRepubblicaGraph().people.filter((person) => person.photoUrl === null);
  assert.deepEqual(
    missing.map((person) => person.displayName).sort(),
    ["Fausta Bergamotto", "Massimo Dell'Utri"],
  );
});
