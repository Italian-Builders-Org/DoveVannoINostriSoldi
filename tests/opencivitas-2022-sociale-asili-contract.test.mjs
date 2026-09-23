import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2022SocialeAsiliSnapshot } = await import("../src/lib/data/opencivitas-2022-sociale-asili-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022-sociale-asili.json", import.meta.url), "utf8"));

test("FC80SOCNID 2022 preserves official source dates, money, RSO coverage and social-nursery function", () => {
  const snapshot = assertOpenCivitas2022SocialeAsiliSnapshot(load());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.publishedAt, "2025-06-16");
  assert.equal(snapshot.modifiedAt, "2025-06-16");
  assert.equal(snapshot.source.family, "FC80SOCNID");
  assert.equal(snapshot.coverage.function, "SOCIALE E NIDO");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 4162108);
  assert.equal(snapshot.coverage.municipalities, 6554);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 69183852475);
  assert.equal(rome.standardSpendingCents, 63505594035);
  assert.equal(rome.differenceCents, 5678258440);
  assert.equal(rome.differencePerCapitaCents, 2061);
  assert.equal(rome.serviceDifferenceBasisPoints, 1183);
  assert.equal(rome.spendingLevel, 6);
  assert.equal(rome.serviceLevel, 6);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Sociale e asili nido/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80TERRVIAB/);
  assert.match(snapshot.methodology.coverageWarning, /3 Comuni/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 401);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 305);
  assert.ok(!snapshot.municipalities.some((row) => ["078052", "079138", "080040"].includes(row.istatCode)));
  assert.ok(snapshot.municipalities.some((row) => row.istatCode === "068003"));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC80SOCNID pin rejects coherent tampering", () => {
  const snapshot = load();
  // La manomissione deve colpire municipalityRows, la struttura che il digest copre:
  // municipalities non esiste nel payload, quindi mutarla sollevava un TypeError
  // che assert.throws catturava senza che il contratto venisse mai interrogato.
  const manomesso = structuredClone(snapshot);
  const colonnaStorica = manomesso.municipalityColumns.indexOf("historicalSpendingCents");
  assert.ok(colonnaStorica >= 0);
  manomesso.municipalityRows[0][colonnaStorica] += 1;
  assert.throws(() => assertOpenCivitas2022SocialeAsiliSnapshot(manomesso), /SHA-256 semantico/);
  assert.throws(() => assertOpenCivitas2022SocialeAsiliSnapshot({
    ...snapshot,
    generatedAt: "2024-01-01T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-01-01T00:00:00Z" },
  }), /timestamp di acquisizione/);
});
