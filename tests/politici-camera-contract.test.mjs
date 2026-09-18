import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const snapshot = JSON.parse(
  await readFile(new URL("../src/data/generated/politici-camera-xix.json", import.meta.url), "utf8"),
);
const { parsePoliticiCameraSnapshot } = await import("../src/lib/data/politici-camera-contract.ts");

function assertInvalid(mutator, pattern) {
  const candidate = structuredClone(snapshot);
  mutator(candidate);
  assert.throws(() => parsePoliticiCameraSnapshot(candidate), pattern);
}

test("politici Camera XIX snapshot validates and reconciles coverage", () => {
  const parsed = parsePoliticiCameraSnapshot(snapshot);
  assert.equal(parsed.chamber, "camera");
  assert.equal(parsed.legislature.id, "repubblica_19");
  assert.equal(parsed.coverage.deputies, 398);
  assert.equal(parsed.coverage.groups, 10);
  assert.equal(parsed.coverage.deputiesWithGroup, 398);
  assert.equal(parsed.coverage.seatCapacity, 400);
  assert.equal(parsed.coverage.vacantSeats, 2);
  assert.equal(parsed.coverage.deputiesWithPhoto, 398);
  assert.equal(parsed.deputies.length, 398);
  assert.ok(parsed.deputies.every((deputy) => deputy.photoUrl && deputy.officialPage && deputy.biography));
  assert.match(parsed.caveats.join(" "), /adesione|seggi vacanti/i);
});

test("contract fails closed on coverage and membership drift", () => {
  assertInvalid((value) => { value.coverage.deputies += 1; }, /coverage\.deputies|coincide/);
  assertInvalid((value) => { value.coverage.groups += 1; }, /coverage\.groups|coincide/);
  assertInvalid((value) => { value.groups[0].memberCount += 1; }, /memberCount/);
  assertInvalid((value) => { value.deputies[0].groupId = "gr-missing"; }, /sconosciuto|groupId/);
  assertInvalid((value) => { value.chamber = "senato"; });
  assertInvalid((value) => { value.deputies[0].photoUrl = null; });
});
