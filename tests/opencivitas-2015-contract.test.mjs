import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2015Snapshot } = await import("../src/lib/data/opencivitas-2015-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2015.json", import.meta.url), "utf8"));

test("FC20 2015 preserves official source, RSO coverage and annual values", () => {
  const snapshot = assertOpenCivitas2015Snapshot(load());
  assert.equal(snapshot.referenceYear, 2015);
  assert.equal(snapshot.publishedAt, "2019-05-23");
  assert.equal(snapshot.modifiedAt, "2019-05-23");
  assert.equal(snapshot.source.family, "FC20TOT");
  assert.equal(snapshot.source.releaseVersion, 2);
  assert.equal(snapshot.source.owner, "Dipartimento delle Finanze");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 4609719);
  assert.equal(snapshot.source.csvEncoding, "cp1252");
  assert.equal(snapshot.source.csvDecimalSeparator, ".");
  assert.equal(snapshot.coverage.municipalities, 6664);
  assert.equal(snapshot.coverage.regions, 15);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 340);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "LAZIO").length, 378);
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.yearSeparationWarning, /2020 non è ricostruito/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /nulla per costruzione/);
  assert.match(snapshot.methodology.sourceFormatNote, /cp1252/);
});

test("FC20 2015 keeps the standard requirement reproportioned on the historical total", () => {
  const snapshot = assertOpenCivitas2015Snapshot(load());
  const sum = (key) => snapshot.municipalities.reduce((total, row) => total + row[key], 0);
  const historical = sum("historicalSpendingCents");
  const standard = sum("standardSpendingCents");
  assert.equal(historical, 3354416621018);
  assert.equal(standard, 3354416620759);
  // Differenza nulla per costruzione: 2,59 € su 33,5 miliardi, solo arrotondamento al centesimo.
  assert.ok(Math.abs(historical - standard) <= 1000);
  assert.equal(sum("differenceCents"), historical - standard);
});

test("FC20 2015 fails closed on drifted artifacts", () => {
  for (const mutate of [
    (value) => { value.referenceYear = 2016; },
    (value) => { value.source.license = "Unverified"; },
    (value) => { value.source.csvDecimalSeparator = ","; },
    (value) => { value.municipalityRows[0][4] += 100; },
    (value) => { value.coverage.municipalities -= 1; },
    (value) => { delete value.source.observedAt; },
    (value) => { value.generatedAt = "2018-01-01T00:00:00Z"; value.source.observedAt = "2018-01-01T00:00:00Z"; },
  ]) {
    const altered = load();
    mutate(altered);
    assert.throws(() => assertOpenCivitas2015Snapshot(altered), /FC20TOT/);
  }
});

test("FC20 2015 non-evaluable municipalities keep the source code and no level", () => {
  const snapshot = assertOpenCivitas2015Snapshot(load());
  const spending = snapshot.municipalities.filter((row) => row.spendingAssessmentReason !== null);
  const services = snapshot.municipalities.filter((row) => row.servicesAssessmentReason !== null);
  assert.equal(spending.length, 31);
  assert.equal(services.length, 49);
  assert.ok(spending.every((row) => row.spendingAssessmentReason === "cod_sps_noval" && row.spendingLevel === null));
  assert.ok(services.every((row) => row.serviceLevel === null && row.serviceDifferenceBasisPoints === null));
  assert.deepEqual(
    [...new Set(services.map((row) => row.servicesAssessmentReason))].sort(),
    ["cod_no_quest", "cod_out_noval", "cod_out_noval_nospesa"],
  );
});
