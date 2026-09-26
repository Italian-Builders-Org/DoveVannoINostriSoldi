import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseMunicipalOfficesSnapshot } = await import("../src/lib/data/municipal-offices-contract.ts");
const snapshot = JSON.parse(readFileSync(new URL("../src/data/generated/mantova-offices.json", import.meta.url), "utf8"));
const clone = () => structuredClone(snapshot);

test("il rilascio pilota espone solo organi attestati con identità IPA e fonti ufficiali", () => {
  const parsed = parseMunicipalOfficesSnapshot(clone());
  assert.equal(parsed.municipality.ipaCode, "c_e897");
  assert.equal(parsed.municipality.taxCode, "00189800204");
  assert.deepEqual(parsed.coverage.organs, ["giunta", "consiglio"]);
  assert.equal(parsed.coverage.historical, false);
  assert.equal(parsed.members.filter((member) => member.organ === "giunta").length, 10);
  assert.equal(parsed.members.filter((member) => member.organ === "consiglio").length, 32);
  assert.ok(parsed.members.every((member) => member.evidenceSourceIds.length > 0));
});

test("il contratto rifiuta membri duplicati e consente omonimi con pagine ufficiali distinte", () => {
  const duplicate = clone();
  duplicate.members.push(structuredClone(duplicate.members[0]));
  assert.throws(() => parseMunicipalOfficesSnapshot(duplicate), /duplicat/i);

  const missing = clone();
  missing.members.pop();
  assert.throws(() => parseMunicipalOfficesSnapshot(missing), /copertura/i);

  const homonym = clone();
  homonym.members[1].name = homonym.members[0].name;
  assert.doesNotThrow(() => parseMunicipalOfficesSnapshot(homonym));
});

test("il contratto rifiuta periodi, fonti o condizioni di riuso incoerenti", () => {
  const reversed = clone();
  reversed.members[0].membershipEndDate = "2026-01-01";
  assert.throws(() => parseMunicipalOfficesSnapshot(reversed), /periodo/i);

  const missingEvidence = clone();
  missingEvidence.members[0].evidenceSourceIds = ["unknown"];
  assert.throws(() => parseMunicipalOfficesSnapshot(missingEvidence), /fonte/i);

  const noHash = clone();
  noHash.sources[0].sha256 = null;
  assert.throws(() => parseMunicipalOfficesSnapshot(noHash), /hash/i);

  const noLicense = clone();
  noLicense.sources[0].license = "unknown";
  assert.throws(() => parseMunicipalOfficesSnapshot(noLicense), /licenza/i);

  const impossibleDate = clone();
  impossibleDate.members[0].membershipStartDate = "2026-02-31";
  assert.throws(() => parseMunicipalOfficesSnapshot(impossibleDate), /data/i);

  const wrongOfficialPage = clone();
  wrongOfficialPage.sources[0].url = wrongOfficialPage.sources[1].url;
  assert.throws(() => parseMunicipalOfficesSnapshot(wrongOfficialPage), /URL fonte/i);

  const wrongStart = clone();
  wrongStart.members[0].membershipStartDate = "2026-05-26";
  assert.throws(() => parseMunicipalOfficesSnapshot(wrongStart), /periodo/i);

  const wrongRole = clone();
  wrongRole.members[0].role = "Presidente del Consiglio";
  assert.throws(() => parseMunicipalOfficesSnapshot(wrongRole), /ruolo/i);
});

test("il contratto rifiuta profili esterni, schema e copertura implicita", () => {
  const external = clone();
  external.members[0].personUrl = "https://example.org/persona";
  assert.throws(() => parseMunicipalOfficesSnapshot(external), /profilo/i);

  const ambiguousUrl = clone();
  ambiguousUrl.members[0].personUrl += "?duplicate=1";
  assert.throws(() => parseMunicipalOfficesSnapshot(ambiguousUrl), /profilo/i);

  const changedSchema = clone();
  changedSchema.schemaVersion = 2;
  assert.throws(() => parseMunicipalOfficesSnapshot(changedSchema), /schema/i);

  const changedScope = clone();
  changedScope.coverage.organs.push("commissioni");
  assert.throws(() => parseMunicipalOfficesSnapshot(changedScope), /copertura/i);
});
