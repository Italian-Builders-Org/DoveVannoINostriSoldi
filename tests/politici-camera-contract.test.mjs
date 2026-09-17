import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const snapshot = JSON.parse(
  await readFile(new URL("../src/data/generated/politici-camera-xix.json", import.meta.url), "utf8"),
);
const { parsePoliticiCameraSnapshot } = await import("../src/lib/data/politici-camera-contract.ts");
const { getPoliticiCameraSnapshot, buildPoliticiGraph, deputiesForGroup } = await import(
  "../src/lib/politici-camera.ts"
);

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
  assert.equal(parsed.source.responseSha256, "328c32bc6648551a351af1718bd212c8641c2bb94da8e96a6e25a4d2adcd3f46");
  assert.equal(parsed.source.responseBytes, 281334);
  assert.match(parsed.caveats.join(" "), /adesione|seggi vacanti/i);
  assert.match(parsed.caveats.join(" "), /notizia|stampa/i);
});

test("runtime loader and graph keep official edges only", () => {
  const data = getPoliticiCameraSnapshot();
  assert.equal(data.coverage.deputies, snapshot.coverage.deputies);
  const { nodes, edges } = buildPoliticiGraph(data);
  assert.ok(nodes.some((node) => node.kind === "electorate"));
  assert.ok(nodes.some((node) => node.kind === "chamber"));
  assert.equal(nodes.filter((node) => node.kind === "group").length, data.groups.length);
  assert.equal(nodes.filter((node) => node.kind === "deputy").length, data.deputies.length);
  assert.ok(edges.some((edge) => edge.kind === "elects"));
  assert.equal(edges.filter((edge) => edge.kind === "belongs").length, data.groups.length + data.coverage.deputiesWithGroup);

  const fdi = data.groups.find((group) => group.label.includes("FRATELLI"));
  assert.ok(fdi);
  assert.equal(deputiesForGroup(fdi.id, data).length, fdi.memberCount);
});

test("contract fails closed on coverage and membership drift", () => {
  assertInvalid((value) => { value.coverage.deputies += 1; }, /coverage\.deputies|coincide/);
  assertInvalid((value) => { value.coverage.groups += 1; }, /coverage\.groups|coincide/);
  assertInvalid((value) => { value.groups[0].memberCount += 1; }, /memberCount/);
  assertInvalid((value) => { value.deputies[0].groupId = "gr-missing"; }, /sconosciuto|groupId/);
  assertInvalid((value) => { value.source.responseSha256 = "abc"; });
  assertInvalid((value) => { value.chamber = "senato"; });
});
