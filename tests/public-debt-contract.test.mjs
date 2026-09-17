import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const snapshot = JSON.parse(await readFile(new URL("../src/data/generated/public-debt.json", import.meta.url), "utf8"));
const { parsePublicDebtSnapshot } = await import("../src/lib/data/public-debt-contract.ts");
const { getPublicDebtView } = await import("../src/lib/public-debt.ts");

function assertInvalid(mutator, pattern) {
  const candidate = structuredClone(snapshot);
  mutator(candidate);
  assert.throws(() => parsePublicDebtSnapshot(candidate), pattern);
}

test("public debt snapshot validates and derived values reconcile", () => {
  assert.equal(parsePublicDebtSnapshot(snapshot).stock.totalCents, 320_724_730_000_000);
  const view = getPublicDebtView(new Date("2026-08-24T09:00:00Z"));
  assert.equal(view.citizenImpact.annualInterest.euroPerHundredEuro, 7.54);
  assert.equal(view.citizenImpact.refinancingExposure.upToOneYearShareBasisPoints, 1821);
  assert.equal(view.stock.instrumentShares.currencyAndDepositsBasisPoints, 582);
  assert.equal(view.residualMaturity.shares.upToOneYearBasisPoints, 1821);
  assert.equal(view.measurement.bancaditaliaSourceUnit, "milioni di euro");
  assert.match(view.measurement.precisionNote, /non misure osservate con precisione al centesimo/);
  assert.equal(view.sources.bancaditalia.accessedAt, view.sources.bancaditalia.retrievedAt);
});

test("runtime contract fails closed on every monetary reconciliation", () => {
  assertInvalid((value) => { value.stock.instruments.currencyAndDepositsCents += 1; }, /strumenti/);
  assertInvalid((value) => { value.stock.changeCents += 1; }, /variazione stock/);
  assertInvalid((value) => { value.change.borrowingRequirementCents += 1; }, /fabbisogno/);
  assertInvalid((value) => { value.change.liquidityContributionCents += 1; }, /liquidità/);
  assertInvalid((value) => { value.change.otherEffectsCents += 1; }, /altri effetti/);
  assertInvalid((value) => { value.holders.sectors[0].amountCents += 10_000_001; }, /detentori/);
  assertInvalid((value) => { value.holders.sectors[0].shareBasisPoints += 21; }, /quote detentori/);
  assertInvalid((value) => {
    value.holders.sectors[0].shareBasisPoints += 100;
    value.holders.sectors[1].shareBasisPoints -= 100;
  }, /quota detentore/);
  assertInvalid((value) => { value.residualMaturity.upToOneYearCents += 10_000_001; }, /vita residua/);
  assertInvalid((value) => { value.annualInterest.interestShareBasisPoints += 1; }, /interessi/);
  assertInvalid((value) => { value.annualInterest.totalGovernmentExpenditureCents = 0; });
});

test("runtime contract rejects divergent periods and histories", () => {
  assertInvalid((value) => { value.change.referenceDate = "2026-05-31"; }, /periodi BDS/);
  assertInvalid((value) => { value.holders.referenceDate = "2026-07-31"; }, /periodo detentori/);
  assertInvalid((value) => { value.holders.referenceDate = "2026-03-31"; }, /periodo detentori/);
  assertInvalid((value) => { value.stock.history.pop(); });
  assertInvalid((value) => { [value.stock.history[0], value.stock.history[1]] = [value.stock.history[1], value.stock.history[0]]; }, /storia stock/);
  assertInvalid((value) => { value.annualInterest.history.pop(); });
  assertInvalid((value) => { [value.annualInterest.history[0], value.annualInterest.history[1]] = [value.annualInterest.history[1], value.annualInterest.history[0]]; }, /storia interessi/);
  assertInvalid((value) => { value.annualInterest.referenceYear -= 1; }, /valori interessi principali/);
});

test("runtime contract rejects malformed provenance and unsafe integers", () => {
  assertInvalid((value) => { value.sources.bancaditalia.cubes[0].sha256 = "x"; });
  assertInvalid((value) => { value.sources.bancaditalia.cubes[0].exportUrl = "http://a2a.bancaditalia.it/file.zip"; });
  assertInvalid((value) => { value.sources.bancaditalia.cubes[0].exportUrl = value.sources.bancaditalia.cubes[1].exportUrl; }, /URL cubo BDS/);
  assertInvalid((value) => { value.sources.bancaditalia.landingUrl = "https://example.test/pubblicazione"; });
  assertInvalid((value) => { value.sources.eurostat.apiUrl = "https://example.test/eurostat"; });
  assertInvalid((value) => { value.sources.bancaditalia.retrievedAt = "not-a-timestamp"; });
  assertInvalid((value) => { value.sources.bancaditalia.retrievedAt = "2026"; });
  assertInvalid((value) => { value.stock.totalCents = Number.MAX_SAFE_INTEGER + 1; });
  assertInvalid((value) => { value.sources.bancaditalia.cubes[1].id = value.sources.bancaditalia.cubes[0].id; }, /cubi BDS duplicati/);
});

test("derived freshness exposes stale monthly and annual data independently", () => {
  const current = getPublicDebtView(new Date("2026-08-24T09:00:00Z"));
  assert.equal(current.stock.freshness.state, "fresh");
  assert.equal(current.citizenImpact.annualInterest.freshness.state, "fresh");

  const stale = getPublicDebtView(new Date("2027-12-31T00:00:00Z"));
  assert.equal(stale.stock.freshness.state, "stale");
  assert.equal(stale.citizenImpact.annualInterest.freshness.state, "stale");
});
