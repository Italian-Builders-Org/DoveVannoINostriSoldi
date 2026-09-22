import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2022IstruzioneSnapshot } = await import("../src/lib/data/opencivitas-2022-istruzione-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022-istruzione.json", import.meta.url), "utf8"));

test("FC80ISTRUZ 2022 preserves official source dates, money, RSO coverage and education function", () => {
  const snapshot = assertOpenCivitas2022IstruzioneSnapshot(load());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.publishedAt, "2025-06-16");
  assert.equal(snapshot.modifiedAt, "2025-06-16");
  assert.equal(snapshot.source.family, "FC80ISTRUZ");
  assert.equal(snapshot.coverage.function, "ISTRUZIONE");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 2557585);
  assert.equal(snapshot.coverage.municipalities, 6550);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 59182248131);
  assert.equal(rome.standardSpendingCents, 41034445849);
  assert.equal(rome.differenceCents, 18147802282);
  assert.equal(rome.differencePerCapitaCents, 6586);
  assert.equal(rome.serviceDifferenceBasisPoints, 3180);
  assert.equal(rome.spendingLevel, 9);
  assert.equal(rome.serviceLevel, 8);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Istruzione/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80SOCNID/);
  assert.match(snapshot.methodology.coverageWarning, /6 Comuni/);
  assert.match(snapshot.methodology.coverageWarning, /Fascia/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 400);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 303);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "LIGURIA").length, 233);
  assert.ok(!snapshot.municipalities.some((row) => ["069013", "078052", "079138", "068003", "080033", "080040", "010022"].includes(row.istatCode)));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC80ISTRUZ pin rejects coherent tampering", () => {
  const snapshot = load();
  const tampered = structuredClone(snapshot);
  const historicalColumn = tampered.municipalityColumns.indexOf("historicalSpendingCents");
  assert.ok(historicalColumn >= 0);
  tampered.municipalityRows[0][historicalColumn] += 1;
  assert.throws(() => assertOpenCivitas2022IstruzioneSnapshot(tampered), /SHA-256 semantico/);
  assert.throws(() => assertOpenCivitas2022IstruzioneSnapshot({
    ...snapshot,
    generatedAt: "2024-01-01T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-01-01T00:00:00Z" },
  }));
});
