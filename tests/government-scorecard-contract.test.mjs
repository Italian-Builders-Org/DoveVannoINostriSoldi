import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const snapshot = JSON.parse(await readFile(new URL("../src/data/generated/government-scorecard.json", import.meta.url), "utf8"));
const {
  getGovernmentScorecardForecastCoverage,
  parseGovernmentScorecardSnapshot,
} = await import("../src/lib/data/government-scorecard-contract.ts");
const { getGovernmentScorecardSnapshot, getGovernmentScorecardView } = await import("../src/lib/government-scorecard.ts");

function assertInvalid(mutator, pattern) {
  const candidate = structuredClone(snapshot);
  mutator(candidate);
  assert.throws(() => parseGovernmentScorecardSnapshot(candidate), pattern);
}

test("government scorecard snapshot validates its fixed basket and provenance", () => {
  const parsed = parseGovernmentScorecardSnapshot(snapshot);
  assert.equal(parsed.indicators.length, 6);
  assert.ok(parsed.indicators.every((indicator) => indicator.sourceId === "ameco"));
  assert.ok(parsed.indicators.every((indicator) => indicator.referencePeriod.includes("1960-2027")));
  assert.ok(parsed.indicators.every((indicator) => indicator.sourceSeries.length >= 1));
  assert.deepEqual(parsed.indicators.find((indicator) => indicator.id === "investment_share").sourceSeries.map((series) => series.file), ["AMECO3.CSV", "AMECO6.CSV"]);
  assert.equal(parsed.indicators.find((indicator) => indicator.id === "investment_share").derived, "gross-fixed-capital-formation / gross-domestic-product * 100");
  assert.equal(parsed.indicators.reduce((sum, item) => sum + item.weightBasisPoints, 0), 10_000);
  assert.equal(parsed.governments.length, 17);
  assert.equal(parsed.governments.at(-1).id, "meloni-i");
  assert.equal(parsed.sources.ameco.observedThrough, 2024);
  assert.equal(parsed.sources.ameco.forecastFrom, 2025);
  assert.equal(parsed.sources.ameco.forecastThrough, 2027);
  assert.deepEqual(parsed.sources.governmentChronology.historicalReceipts.map((receipt) => receipt.governmentId), [
    "dini-i", "prodi-i", "dalema-i", "dalema-ii", "amato-ii",
  ]);
  assert.equal(parsed.sources.governmentChronology.historicalOwner, "Camera dei deputati · Portale storico");
  assert.match(parsed.sources.governmentChronology.dateMeaning, /confini istituzionali/);
  assert.equal(getGovernmentScorecardSnapshot().methodologyVersion, "core-annual-v4");
  assert.equal(getGovernmentScorecardView().ok, true);
});

test("runtime contract rejects weight, identity and coverage drift", () => {
  assertInvalid((value) => { value.indicators[0].weightBasisPoints += 1; }, /pesi indicatori/);
  assertInvalid((value) => {
    value.indicators[0].weightBasisPoints += 500;
    value.indicators[1].weightBasisPoints -= 500;
  }, /manifest versionato/);
  assertInvalid((value) => { value.indicators[1].id = value.indicators[0].id; }, /paniere indicatori/);
  assertInvalid((value) => { value.indicators[0].area = "growth"; }, /manifest versionato/);
  assertInvalid((value) => { value.indicators[0].direction = "lower"; }, /manifest versionato/);
  assertInvalid((value) => { value.indicators[0].transformation = "point-change"; }, /manifest versionato/);
  assertInvalid((value) => { value.indicators[0].unit = "percent"; }, /manifest versionato/);
  assertInvalid((value) => { value.indicators[0].countries.italy[64].value = null; }, /dato obbligatorio/);
  assertInvalid((value) => { value.indicators[0].countries.italy[64].year = 2023; }, /anni non consecutivi/);
  assertInvalid((value) => { value.indicators[0].countries.italy[64].value = 1_000_000; }, /intervallo plausibile/);
  assertInvalid((value) => { value.indicators[1].countries.italy[64].value = -1; }, /intervallo plausibile/);
  assertInvalid((value) => { value.indicators[0].countries.italy.pop(); });
  assertInvalid((value) => { value.indicators[5].sourceCodes.italy.pop(); }, /codici serie/);
  assertInvalid((value) => { value.indicators[0].sourceCodes.italy[0] = "ITA.wrong"; }, /codici serie/);
  assertInvalid((value) => { value.indicators[0].sourceSeries[0].file = "AMECO18.CSV"; }, /provenienza delle serie/);
  assertInvalid((value) => { value.indicators[5].derived = "not-the-manifest-formula"; }, /formula derivata/);
  assertInvalid((value) => { delete value.indicators[5].derived; });
  assertInvalid((value) => { value.indicators[0].derived = "unexpected"; }, /formula derivata/);
  assertInvalid((value) => { value.indicators[0].sourceId = "eurostat"; });
  assertInvalid((value) => { value.indicators[0].referencePeriod = "annual"; });
  assertInvalid((value) => { value.method.robustScale = 1; }, /1\.4826|metodo divergente/);
});

test("runtime contract rejects malformed chronology, measures and official URLs", () => {
  assertInvalid((value) => { value.governments[0].startDate = "1995-01-18"; }, /cronologia governi/);
  assertInvalid((value) => { value.governments[16].status = "ended"; }, /stato governo|governo corrente/);
  assertInvalid((value) => { value.governments[15].status = "current"; value.governments[15].endDate = null; }, /governo corrente/);
  assertInvalid((value) => { [value.governments[0], value.governments[1]] = [value.governments[1], value.governments[0]]; }, /governi non ordinati/);
  assertInvalid((value) => { value.measures[0].government = "Missing-I"; }, /misura senza governo/);
  assertInvalid((value) => { value.sources.ameco.downloadUrl = "https://example.test/ameco.zip"; });
  assertInvalid((value) => { value.sources.governmentChronology.pageUrl = "https://www.governo.it/other"; });
  assertInvalid((value) => { value.sources.governmentChronology.historicalReceipts[0].pageUrl = "https://example.test/dini"; }, /ricevuta Camera/);
  assertInvalid((value) => { value.sources.governmentChronology.historicalReceipts[0].startDate = "1995-01-18"; }, /ricevuta Camera/);
  assertInvalid((value) => { value.sources.governmentChronology.historicalReceipts.pop(); }, /historicalReceipts|ricevute Camera/);
  assertInvalid((value) => { value.sources.governmentChronology.historicalOwner = "Fonte sconosciuta"; });
  assertInvalid((value) => { value.sources.governmentChronology.dateMeaning = "date qualsiasi"; });
  assertInvalid((value) => { value.sources.ameco.sha256 = "x"; });
});

test("runtime contract keeps observed and forecast cutoffs distinct", () => {
  assertInvalid((value) => { value.sources.ameco.observedThrough = 2025; });
  assertInvalid((value) => { value.sources.ameco.forecastFrom = 2024; });
  assertInvalid((value) => { value.sources.ameco.forecastThrough = 2026; });
  assertInvalid((value) => { value.generatedAt = "2026-08-29"; });
});

test("forecast gaps do not invalidate complete observed data", () => {
  const candidate = structuredClone(snapshot);
  for (const indicator of candidate.indicators) {
    for (const points of Object.values(indicator.countries)) {
      for (const point of points) {
        if (point.year >= candidate.sources.ameco.forecastFrom) point.value = null;
      }
    }
  }
  assert.doesNotThrow(() => parseGovernmentScorecardSnapshot(candidate));
  assert.deepEqual(getGovernmentScorecardForecastCoverage(candidate), {
    status: "missing",
    fromYear: 2025,
    throughYear: 2027,
    availableCells: 0,
    requiredCells: 72,
  });
});

test("forecast coverage fails closed when even one advertised cell is missing", () => {
  assert.equal(getGovernmentScorecardForecastCoverage(snapshot).status, "complete");
  const candidate = structuredClone(snapshot);
  candidate.indicators[0].countries.italy.find((point) => point.year === 2027).value = null;
  assert.deepEqual(getGovernmentScorecardForecastCoverage(candidate), {
    status: "partial",
    fromYear: 2025,
    throughYear: 2027,
    availableCells: 71,
    requiredCells: 72,
  });
});
