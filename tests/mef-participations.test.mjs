import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import snapshot from "../src/data/generated/mef-participations-overview.json" with { type: "json" };

const script = fileURLToPath(new URL("../scripts/etl/mef_participations_snapshot.py", import.meta.url));
const requiredHeaders = [
  "Amministrazione Denominazione",
  "Amministrazione Codice Fiscale",
  "Partecipata Denominazione",
  "Partecipata Codice Fiscale",
  "Partecipazione indiretta",
  "Tipo controllo",
  ...Array.from({ length: 5 }, (_, index) => `Modalità affidamento servizio ${index + 1}`),
];

function runFixture(values, headers = requiredHeaders) {
  const directory = mkdtempSync(join(tmpdir(), "dovevanno-mef-"));
  const input = join(directory, "input.csv");
  const output = join(directory, "output.json");
  writeFileSync(input, `${headers.join(";")}\n${headers.map((header) => values[header] ?? "").join(";")}\n`);
  const result = spawnSync("python3", [
    script,
    "--input", input,
    "--reference-year", "2030",
    "--published-at", "2032-04-05",
    "--output", output,
  ], { encoding: "utf8" });
  const generated = result.status === 0 ? JSON.parse(readFileSync(output, "utf8")) : null;
  rmSync(directory, { recursive: true, force: true });
  return { ...result, generated };
}

const validRecord = {
  "Amministrazione Denominazione": "Comune prova",
  "Amministrazione Codice Fiscale": "[00123456789]",
  "Partecipata Denominazione": "Società prova",
  "Partecipata Codice Fiscale": "[00987654321]",
  "Partecipazione indiretta": "NO",
  "Tipo controllo": "Controllo analogo congiunto",
  "Modalità affidamento servizio 1": "Diretto",
};

test("MEF participation overview reconciles and preserves provenance", () => {
  const totals = snapshot.totals;
  assert.equal(
    totals.directParticipationRecords + totals.indirectParticipationRecords,
    totals.participationRecords,
  );
  assert.ok(totals.declaringAdministrations > 0);
  assert.ok(totals.participatedOrganizations > 0);
  assert.match(snapshot.source.rawSha256, /^[a-f0-9]{64}$/);
  assert.match(snapshot.source.assetUrl, /^https:\/\/www\.de\.mef\.gov\.it\//);
  assert.equal(snapshot.source.detectedEncoding, "cp1252");
});

test("MEF evidence counts remain declarations rather than current legal status", () => {
  assert.ok(snapshot.declaredEvidence.bothSignalsRecords <= snapshot.declaredEvidence.analogControlRecords);
  assert.ok(snapshot.declaredEvidence.bothSignalsRecords <= snapshot.declaredEvidence.directAwardRecords);
  assert.match(snapshot.declaredEvidence.legalMeaning, /non certificano uno status in-house corrente/i);
  assert.match(snapshot.declaredEvidence.legalMeaning, new RegExp(String(snapshot.referenceYear)));
  assert.equal(snapshot.topCompaniesByDeclaringAdministrations.length, 20);
});

test("MEF transformer binds evidence semantics to the discovered reference year", () => {
  const result = runFixture(validRecord);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.generated.referenceYear, 2030);
  assert.equal(result.generated.referenceDate, "2030-12-31");
  assert.equal(result.generated.publishedAt, "2032-04-05");
  assert.equal(result.generated.declaredEvidence.directAwardRecords, 1);
  assert.match(result.generated.declaredEvidence.legalMeaning, /rilevazione 2030/);
});

test("MEF transformer fails closed on schema drift and unknown participation kinds", () => {
  const missingColumn = runFixture(validRecord, requiredHeaders.slice(0, -1));
  assert.notEqual(missingColumn.status, 0);
  assert.match(missingColumn.stderr, /colonne mancanti/i);

  const unknownKind = runFixture({ ...validRecord, "Partecipazione indiretta": "FORSE" });
  assert.notEqual(unknownKind.status, 0);
  assert.match(unknownKind.stderr, /Valore inatteso per Partecipazione indiretta/);
});
