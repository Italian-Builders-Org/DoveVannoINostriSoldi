import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2021SocialeAsiliSnapshot } = await import("../src/lib/data/opencivitas-2021-sociale-asili-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2021-sociale-asili.json", import.meta.url), "utf8"));

test("FC70SOCNID 2021 preserves official source dates, money, RSO coverage and social-nursery function", () => {
  const snapshot = assertOpenCivitas2021SocialeAsiliSnapshot(load());
  assert.equal(snapshot.referenceYear, 2021);
  assert.equal(snapshot.publishedAt, "2024-05-30");
  assert.equal(snapshot.modifiedAt, "2024-05-30");
  assert.equal(snapshot.source.family, "FC70SOCNID");
  assert.equal(snapshot.coverage.function, "SOCIALE E NIDO");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 3731430);
  assert.equal(snapshot.coverage.municipalities, 6555);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 64938659746);
  assert.equal(rome.standardSpendingCents, 63986562929);
  assert.equal(rome.differenceCents, 952096817);
  assert.equal(rome.differencePerCapitaCents, 346);
  assert.equal(rome.serviceDifferenceBasisPoints, 2270);
  assert.equal(rome.spendingLevel, 6);
  assert.equal(rome.serviceLevel, 7);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Sociale e asili nido/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC70TOT/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80SOCNID/);
  assert.match(snapshot.methodology.coverageWarning, /9 Comuni/);
  assert.match(snapshot.methodology.coverageWarning, /066017/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 401);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 301);
  assert.ok(!snapshot.municipalities.some((row) => ["066083", "016103", "069013", "069043", "078128", "078131", "063042", "063073", "102037", "066017"].includes(row.istatCode)));
  assert.ok(snapshot.municipalities.some((row) => row.istatCode === "068003"));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC70SOCNID pin rejects coherent tampering", () => {
  const snapshot = load();
  const tampered = structuredClone(snapshot);
  const historicalColumn = tampered.municipalityColumns.indexOf("historicalSpendingCents");
  assert.ok(historicalColumn >= 0);
  tampered.municipalityRows[0][historicalColumn] += 1;
  assert.throws(() => assertOpenCivitas2021SocialeAsiliSnapshot(tampered), /SHA-256 semantico/);
  assert.throws(() => assertOpenCivitas2021SocialeAsiliSnapshot({
    ...snapshot,
    generatedAt: "2024-01-01T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-01-01T00:00:00Z" },
  }));
});
