import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseParlamentoMandatiSnapshot } = await import("../src/lib/data/parlamento-mandati-contract.ts");
const { getRepubblicaMap, getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");

const raw = JSON.parse(readFileSync(new URL("../src/data/generated/parlamento-mandati-xix.json", import.meta.url), "utf8"));
const clone = () => structuredClone(raw);

test("committed mandates snapshot passes the contract and covers both chambers", () => {
  const snapshot = parseParlamentoMandatiSnapshot(raw);
  assert.equal(snapshot.coverage.deputies, 398);
  assert.equal(snapshot.coverage.senators, 205);
  assert.ok(snapshot.coverage.firstTermInParliamentDeputies <= snapshot.coverage.firstTermInChamberDeputies);
  assert.ok(snapshot.coverage.firstTermInParliamentSenators <= snapshot.coverage.firstTermInChamberSenators);
  assert.match(snapshot.caveats.join(" "), /per nome/u);
});

test("contract rejects flags, legislatures and coverage that the mandates do not support", () => {
  const flag = clone();
  flag.members.find((member) => !member.firstTermInParliament).firstTermInParliament = true;
  assert.throws(() => parseParlamentoMandatiSnapshot(flag));

  const legislatures = clone();
  legislatures.members[0].legislatures.camera = [...legislatures.members[0].legislatures.camera, 1].sort((a, b) => a - b);
  assert.throws(() => parseParlamentoMandatiSnapshot(legislatures));

  const closed = clone();
  const member = closed.members[0];
  for (const mandate of member.mandates) if (mandate.chamber === member.chamber && mandate.legislature === 19) mandate.endDate = "2024-01-01";
  assert.throws(() => parseParlamentoMandatiSnapshot(closed));

  const coverage = clone();
  coverage.coverage.firstTermInChamberSenators += 1;
  assert.throws(() => parseParlamentoMandatiSnapshot(coverage));

  const duplicate = clone();
  duplicate.members.push(structuredClone(duplicate.members[0]));
  assert.throws(() => parseParlamentoMandatiSnapshot(duplicate));

  const wrongChamber = clone();
  wrongChamber.members[0].chamber = "senato";
  assert.throws(() => parseParlamentoMandatiSnapshot(wrongChamber));
});

test("map and profiles expose terms only for sitting parliamentarians", () => {
  const map = getRepubblicaMap();
  const profiles = getRepubblicaProfiles();
  for (const person of map.people) {
    const terms = profiles[person.id].parliamentaryTerms;
    if (person.chamberId === null) {
      assert.equal(person.firstTerm, null, person.id);
      assert.equal(terms, null, person.id);
      continue;
    }
    assert.ok(person.firstTerm, person.id);
    assert.equal(terms.chamber, person.chamberId);
    assert.equal(terms.firstTermInChamber, person.firstTerm.chamber);
    assert.equal(terms.firstTermInParliament, person.firstTerm.parliament);
    assert.ok(terms[person.chamberId].includes("XIX"), person.id);
  }
  const snapshot = parseParlamentoMandatiSnapshot(raw);
  assert.equal(
    map.people.filter((person) => person.chamberId === "senato" && person.firstTerm?.parliament).length,
    snapshot.coverage.firstTermInParliamentSenators,
  );
});

test("official cross-chamber mandates reach the profile without any name join", () => {
  const profiles = getRepubblicaProfiles();
  // Pier Ferdinando Casini: deputy IX–XVI, senator XVII–XIX, per dati.senato.it.
  const casini = profiles["sen-s520"].parliamentaryTerms;
  assert.deepEqual(casini.camera, ["IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"]);
  assert.deepEqual(casini.senato, ["XVII", "XVIII", "XIX"]);
  assert.equal(casini.firstTermInParliament, false);
  // Giuseppe Conte: XIX is the only legislature in either chamber, per dati.camera.it.
  const conte = profiles["dep-307926"].parliamentaryTerms;
  assert.deepEqual([conte.camera, conte.senato], [["XIX"], []]);
  assert.equal(conte.firstTermInParliament, true);
});
