import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const snapshot = JSON.parse(await readFile(new URL("../src/data/generated/government-current-signals.json", import.meta.url), "utf8"));
const { parseGovernmentCurrentSignalsSnapshot } = await import("../src/lib/data/government-current-signals-contract.ts");
const { getGovernmentCurrentSignalsSnapshot, getGovernmentCurrentSignalsView } = await import("../src/lib/government-current-signals.ts");

function assertInvalid(mutator, pattern) {
  const candidate = structuredClone(snapshot);
  mutator(candidate);
  assert.throws(() => parseGovernmentCurrentSignalsSnapshot(candidate), pattern);
}

test("current signals snapshot exposes three complete Eurostat series without scoring them", () => {
  const parsed = parseGovernmentCurrentSignalsSnapshot(snapshot);
  const view = getGovernmentCurrentSignalsView();
  assert.equal(parsed.indicators.length, 3);
  assert.equal(parsed.indicators[0].indexUnit, "indice 2025=100");
  assert.equal(parsed.indicators[0].annualRateUnit, "variazione percentuale annua");
  assert.equal(parsed.source.datasetCode, "prc_hicp_minr");
  assert.equal(parsed.source.referencePeriodFrom, "2022-10");
  assert.equal(parsed.source.referencePeriodThrough, "2026-07");
  assert.equal(getGovernmentCurrentSignalsSnapshot().methodologyVersion, "current-signals-v1");
  assert.equal(view.scoringStatus, "not-scored");
  assert.equal(view.indicators[0].series[0].italy, 0);
  assert.equal(view.indicators[0].latestAnnualRate, 2.9);
  assert.ok(view.indicators.every((indicator) => Number.isFinite(indicator.cumulativeChange)));
});

test("current signals contract rejects source, period and observation drift", () => {
  assertInvalid((value) => { value.source.apiUrl = "https://example.test/data"; });
  assertInvalid((value) => { value.source.referencePeriodThrough = "2026-06"; }, /ultimo periodo/);
  assertInvalid((value) => { value.indicators[0].countries.italy[1].period = "2022-12"; }, /periodi mensili/);
  assertInvalid((value) => { value.indicators[1].countries.france.pop(); }, /copertura mensile/);
  assertInvalid((value) => { value.indicators[2].countries.germany[0].index = -1; });
  assertInvalid((value) => { value.indicators[0].indexUnit = "variazione percentuale"; });
  assertInvalid((value) => { value.source.sourceUpdatedAt = "2026-09-01T00:00:00Z"; }, /timestamp fonte/);
});
