import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2016Snapshot } = await import("../src/lib/data/opencivitas-2016-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2016.json", import.meta.url), "utf8"));

test("FC30 2016 preserves official source, RSO coverage and annual values", () => {
  const snapshot = assertOpenCivitas2016Snapshot(load());
  assert.equal(snapshot.referenceYear, 2016);
  assert.equal(snapshot.publishedAt, "2019-05-23");
  assert.equal(snapshot.modifiedAt, "2019-05-23");
  assert.equal(snapshot.source.family, "FC30TOT");
  assert.equal(snapshot.source.releaseVersion, 1);
  assert.equal(snapshot.source.owner, "Dipartimento delle Finanze");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 4588520);
  assert.equal(snapshot.source.csvEncoding, "cp1252");
  assert.equal(snapshot.source.csvDecimalSeparator, ".");
  assert.equal(snapshot.coverage.municipalities, 6647);
  assert.equal(snapshot.coverage.regions, 15);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 334);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "LAZIO").length, 378);
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.yearSeparationWarning, /FC20TOT 2015.*2020 non è ricostruito/s);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /nulla per costruzione/);
  assert.match(snapshot.methodology.sourceFormatNote, /cp1252/);
});

test("FC30 2016 keeps the standard requirement reproportioned on the historical total", () => {
  const snapshot = assertOpenCivitas2016Snapshot(load());
  const sum = (key) => snapshot.municipalities.reduce((total, row) => total + row[key], 0);
  const historical = sum("historicalSpendingCents");
  const standard = sum("standardSpendingCents");
  assert.equal(historical, 3320685957809);
  assert.equal(standard, 3320685957509);
  // Differenza nulla per costruzione: 3,00 € su 33,2 miliardi, solo arrotondamento al centesimo.
  assert.ok(Math.abs(historical - standard) <= 1000);
  assert.equal(sum("differenceCents"), historical - standard);
});

test("FC30 2016 fails closed on drifted artifacts", () => {
  for (const mutate of [
    (value) => { value.referenceYear = 2017; },
    (value) => { value.source.license = "Unverified"; },
    (value) => { value.source.csvDecimalSeparator = ","; },
    (value) => { value.municipalityRows[0][4] += 100; },
    (value) => { value.coverage.municipalities -= 1; },
    (value) => { delete value.source.observedAt; },
    (value) => { value.generatedAt = "2018-01-01T00:00:00Z"; value.source.observedAt = "2018-01-01T00:00:00Z"; },
  ]) {
    const altered = load();
    mutate(altered);
    assert.throws(() => assertOpenCivitas2016Snapshot(altered), /FC30TOT/);
  }
});

test("FC30 2016 non-evaluable municipalities keep the source code and no level", () => {
  const snapshot = assertOpenCivitas2016Snapshot(load());
  const spending = snapshot.municipalities.filter((row) => row.spendingAssessmentReason !== null);
  const services = snapshot.municipalities.filter((row) => row.servicesAssessmentReason !== null);
  assert.equal(spending.length, 109);
  assert.equal(services.length, 190);
  assert.ok(spending.every((row) => row.spendingAssessmentReason === "cod_sps_noval" && row.spendingLevel === null));
  assert.ok(services.every((row) => row.serviceLevel === null && row.serviceDifferenceBasisPoints === null));
  assert.deepEqual(
    [...new Set(services.map((row) => row.servicesAssessmentReason))].sort(),
    ["cod_no_quest", "cod_out_noval", "cod_out_noval_nospesa"],
  );
});
