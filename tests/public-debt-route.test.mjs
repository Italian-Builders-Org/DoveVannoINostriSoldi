import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET, createPublicDebtResponse } = await import("../src/app/api/debito/route.ts");
const { PublicDebtContractError } = await import("../src/lib/public-debt.ts");

test("GET /api/debito returns the shared view with public cache policy", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600, stale-while-revalidate=86400");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.stock.totalCents, 320_724_730_000_000);
  assert.equal(body.stock.instrumentShares.currencyAndDepositsBasisPoints, 582);
  assert.equal(body.citizenImpact.annualInterest.euroPerHundredEuro, 7.54);
  assert.equal(body.measurement.storedUnit, "centesimi di euro interi");
  assert.match(body.measurement.transformation, /non aggiunge precisione/);
  assert.equal(body.sources.eurostat.licenseUrl, body.sources.eurostat.termsUrl);
});

test("GET /api/debito fails closed with no-store when the snapshot contract is invalid", async () => {
  const response = createPublicDebtResponse(() => {
    throw new PublicDebtContractError(new Error("invalid fixture"));
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "snapshot_contract_invalid" });
});
