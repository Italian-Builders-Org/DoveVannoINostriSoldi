import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getRepubblicaGraph, getRepubblicaMap, findRepublicPerson } = await import(
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
});

test("declared portrait gaps stay without invented photos", () => {
  const missing = getRepubblicaGraph().people.filter((person) => person.photoUrl === null);
  assert.deepEqual(
    missing.map((person) => person.displayName).sort(),
    ["Fausta Bergamotto", "Massimo Dell'Utri"],
  );
});
