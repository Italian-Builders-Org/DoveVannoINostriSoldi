import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getPoliticiParlamentoSnapshot } = await import("../src/lib/politici-parlamento.ts");
const { parsePoliticiParlamentoSnapshot } = await import("../src/lib/data/politici-parlamento-contract.ts");

test("Parliament view reconciles Camera, Senate and cross-chamber groups", () => {
  const snapshot = getPoliticiParlamentoSnapshot();
  assert.equal(snapshot.coverage.cameraMembers, 398);
  assert.equal(snapshot.coverage.senateMembers, 205);
  assert.equal(snapshot.coverage.people, 603);
  assert.equal(snapshot.chambers.length, 2);
  assert.ok(snapshot.coverage.crossChamberGroupLinks >= 8);
  assert.ok(snapshot.groups.some((group) => group.chamber === "camera" && group.relatedGroupIds.length));
  assert.ok(snapshot.groups.some((group) => group.chamber === "senato" && group.relatedGroupIds.length));
  assert.ok(snapshot.people.every((person) => person.photoUrl.startsWith("https://")));
  assert.ok(snapshot.people.every((person) => person.biography.length > 20));
});

test("Parliament contract fails closed on broken group relations", () => {
  const snapshot = structuredClone(getPoliticiParlamentoSnapshot());
  snapshot.groups[0].relatedGroupIds = [snapshot.groups[0].id];
  assert.throws(() => parsePoliticiParlamentoSnapshot(snapshot), /inter-camera|collegamento/i);
});
