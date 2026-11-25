import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/generated/${name}.json`, import.meta.url), "utf8"));
const raw = {
  camera: read("camera-trattamento-economico"),
  foi: read("istat-foi-annuale"),
  hicp: read("eurostat-hicp-annuale"),
  contractual: read("istat-retribuzioni-contrattuali"),
  bes: read("istat-bes-economico-2004-2024.data"),
};
const effective = raw.bes.observations
  .filter((row) => row.indicator === "04BEC002P" && row.territory === "IT" && row.sex === "T")
  .map((row) => ({ year: row.year, euro: row.valueTenths / 10 }))
  .sort((left, right) => left.year - right.year);

const {
  parseEurostatHicpAnnualSnapshot,
  parseIstatFoiAnnualSnapshot,
  parseIstatContractualWagesSnapshot,
} = await import("../src/lib/data/annual-price-wage-indices-contract.ts");
const { parseCameraTrattamentoEconomicoSnapshot } = await import("../src/lib/data/camera-trattamento-economico-contract.ts");
const {
  buildIndemnityAnnualSeries,
  buildDeputiesVsWagesComparison,
  getDeputiesVsWagesComparison,
} = await import("../src/lib/deputati-indennita-salari.ts");

const parsed = () => ({
  effective: structuredClone(effective),
  camera: parseCameraTrattamentoEconomicoSnapshot(structuredClone(raw.camera)),
  foi: parseIstatFoiAnnualSnapshot(structuredClone(raw.foi)),
  hicp: parseEurostatHicpAnnualSnapshot(structuredClone(raw.hicp)),
  contractual: parseIstatContractualWagesSnapshot(structuredClone(raw.contractual)),
});

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.005, `${label}: ${actual} != ${expected}`);

test("index contracts accept the committed snapshots and fail closed on gaps or bad values", () => {
  const ok = parsed();
  assert.equal(ok.foi.observations.length, 30);
  assert.equal(ok.contractual.observations[0].year, 2005);

  const gap = structuredClone(raw.contractual);
  gap.observations.splice(3, 1);
  assert.throws(() => parseIstatContractualWagesSnapshot(gap), /anni/);

  const negative = structuredClone(raw.hicp);
  negative.observations[2].indexTenths = 0;
  assert.throws(() => parseEurostatHicpAnnualSnapshot(negative));

  const unsorted = structuredClone(raw.foi);
  [unsorted.observations[0], unsorted.observations[1]] = [unsorted.observations[1], unsorted.observations[0]];
  assert.throws(() => parseIstatFoiAnnualSnapshot(unsorted), /anni/);

  const wrongId = structuredClone(raw.contractual);
  wrongId.datasetId = "altro";
  assert.throws(() => parseIstatContractualWagesSnapshot(wrongId));
});

test("the indemnity series follows the Camera steps year by year and ends on the amount in force", () => {
  const { camera } = parsed();
  const series = buildIndemnityAnnualSeries(camera, 2005, 2025);
  const byYear = new Map(series.map((row) => [row.year, row.amountCents]));
  assert.equal(series.length, 21);
  assert.equal(byYear.get(2005), 1243432);
  assert.equal(byYear.get(2006), 1170364);
  assert.equal(byYear.get(2010), 1170364);
  assert.equal(byYear.get(2011), 1128328);
  assert.equal(byYear.get(2012), 1043500);
  assert.equal(byYear.get(2025), camera.summary.indemnityGrossMonthlyCents);

  assert.throws(() => buildIndemnityAnnualSeries(camera, 2004, 2025), /2004/);
  const drifted = structuredClone(camera);
  drifted.summary.indemnityGrossMonthlyCents += 1;
  assert.throws(() => buildIndemnityAnnualSeries(drifted, 2005, 2025), /in vigore/);
});

test("indices use 2005 as base and deflate with FOI and HICP", () => {
  const comparison = buildDeputiesVsWagesComparison(parsed());
  assert.equal(comparison.baseYear, 2005);
  assert.equal(comparison.lastYear, 2025);
  assert.deepEqual(comparison.rows.map((row) => row.year), Array.from({ length: 21 }, (_, index) => 2005 + index));
  const first = comparison.rows[0];
  for (const key of ["indemnityNominal", "contractualNominal", "prices", "indemnityReal", "contractualReal"]) {
    assert.equal(first[key], 100, key);
  }
  const last = comparison.rows.at(-1);
  close(last.indemnityNominal, 83.92, "indennità nominale 2025");
  close(last.contractualNominal, 142.8, "contrattuali nominali 2025");
  close(last.prices, 143.33, "prezzi FOI 2025");
  close(last.indemnityReal, 58.55, "indennità reale 2025");
  close(last.contractualReal, 99.63, "contrattuali reali 2025");
  close(last.indemnityRealHicp, 56.56, "indennità reale HICP 2025");
  const row2012 = comparison.rows.find((row) => row.year === 2012);
  close(row2012.indemnityReal, 72.02, "indennità reale 2012");
});

test("headline changes match the rows and the comparison fails closed on a missing year", () => {
  const comparison = buildDeputiesVsWagesComparison(parsed());
  close(comparison.headline.indemnityNominalPct, -16.08, "variazione nominale indennità");
  close(comparison.headline.indemnityRealPct, -41.45, "variazione reale indennità");
  close(comparison.headline.contractualNominalPct, 42.8, "variazione nominale contratti");
  close(comparison.headline.contractualRealPct, -0.37, "variazione reale contratti");
  close(comparison.headline.pricesPct, 43.33, "variazione prezzi");
  assert.equal(comparison.headline.indemnityFirstCents, 1243432);
  assert.equal(comparison.headline.indemnityLastCents, 1043500);

  const input = parsed();
  input.foi.observations = input.foi.observations.filter((row) => row.year !== 2015);
  assert.throws(() => buildDeputiesVsWagesComparison(input), /2015/);

  const gap = parsed();
  gap.effective = gap.effective.filter((row) => row.year !== 2016);
  assert.throws(() => buildDeputiesVsWagesComparison(gap), /BES/);
});

test("effective average pay (BES) is a second lens: nominal up, real down since 2008", () => {
  const { effectiveWages } = buildDeputiesVsWagesComparison(parsed());
  assert.equal(effectiveWages.fromYear, 2008);
  assert.equal(effectiveWages.toYear, 2023);
  assert.equal(effectiveWages.firstEuro, 20006);
  close(effectiveWages.lastEuro, 23630.3, "retribuzione media 2023");
  close(Math.round(effectiveWages.nominalPct * 10) / 10, 18.1, "BES nominale");
  close(Math.round(effectiveWages.realPct * 10) / 10, -9.4, "BES reale");
});

test("the committed snapshots load through the public entry point with sources and caveats", () => {
  const comparison = getDeputiesVsWagesComparison();
  assert.equal(comparison.rows.length, 21);
  assert.deepEqual(comparison.sources.map((source) => source.id), ["camera", "contractual", "effective", "foi", "hicp"]);
  for (const source of comparison.sources) {
    assert.match(source.url, /^https:\/\//, source.id);
    assert.ok(source.license.length > 0, source.id);
    assert.match(source.acquiredOn, /^\d{4}-\d{2}-\d{2}$/, source.id);
  }
  assert.ok(comparison.steps.length >= 10);
  assert.ok(comparison.steps.every((step) => step.evidence.length > 20));
  assert.ok(comparison.components.some((component) => component.grossNet === "withholding"));
});

test("the page states limits and does not present the rate as a payslip", () => {
  const page = readFileSync(new URL("../src/app/parlamento/indennita/page.tsx", import.meta.url), "utf8");
  assert.match(page, /non è la busta paga/i);
  assert.match(page, /Senato/);
  assert.match(page, /href="\/parlamento"/);
  assert.doesNotMatch(page, /—|–/);
});
