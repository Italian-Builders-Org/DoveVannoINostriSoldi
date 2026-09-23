import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2022PoliziaSnapshot } = await import("../src/lib/data/opencivitas-2022-polizia-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022-polizia.json", import.meta.url), "utf8"));

test("FC80POLIZIA 2022 preserves official source dates, money, RSO coverage and local-police function", () => {
  const snapshot = assertOpenCivitas2022PoliziaSnapshot(load());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.publishedAt, "2025-06-16");
  assert.equal(snapshot.modifiedAt, "2025-06-16");
  assert.equal(snapshot.source.family, "FC80POLIZIA");
  assert.equal(snapshot.coverage.function, "POLIZIA");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 2839376);
  assert.equal(snapshot.coverage.municipalities, 6554);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 34631496967);
  assert.equal(rome.standardSpendingCents, 32326958071);
  assert.equal(rome.differenceCents, 2304538896);
  assert.equal(rome.differencePerCapitaCents, 836);
  assert.equal(rome.serviceDifferenceBasisPoints, 2260);
  assert.equal(rome.spendingLevel, 6);
  assert.equal(rome.serviceLevel, 7);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Polizia locale/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80SOCNID/);
  assert.match(snapshot.methodology.coverageWarning, /3 Comuni/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 401);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 305);
  assert.ok(!snapshot.municipalities.some((row) => ["078052", "079138", "080040"].includes(row.istatCode)));
  assert.ok(snapshot.municipalities.some((row) => row.istatCode === "068003"));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC80POLIZIA pin rejects coherent tampering", () => {
  const snapshot = load();
  const tampered = structuredClone(snapshot);
  const historicalColumn = tampered.municipalityColumns.indexOf("historicalSpendingCents");
  assert.ok(historicalColumn >= 0);
  tampered.municipalityRows[0][historicalColumn] += 1;
  assert.throws(() => assertOpenCivitas2022PoliziaSnapshot(tampered), /SHA-256 semantico/);
  assert.throws(() => assertOpenCivitas2022PoliziaSnapshot({
    ...snapshot,
    generatedAt: "2024-01-01T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-01-01T00:00:00Z" },
  }));
});
