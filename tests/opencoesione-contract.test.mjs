import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertOpenCoesioneSnapshot,
  paymentCostRatio,
} from "../src/lib/data/opencoesione-contract.ts";

const snapshotUrl = new URL(
  "../src/data/generated/opencoesione-overview.json",
  import.meta.url,
);

async function loadSnapshot() {
  return JSON.parse(await readFile(snapshotUrl, "utf8"));
}

test("OpenCoesione snapshot validates and every dimension reconciles", async () => {
  const data = assertOpenCoesioneSnapshot(await loadSnapshot());

  assert.equal(data.schemaVersion, 1);
  assert.equal(data.scope, "national-overview");
  assert.equal(data.statuses.length, 5);
  assert.equal(data.themes.length, 11);
  assert.equal(data.natures.length, 6);
  assert.ok(data.totals.projects > 1_000_000);
  assert.ok(data.totals.publicCostCents > data.totals.paymentsCents);
  assert.ok(paymentCostRatio(data) > 0 && paymentCostRatio(data) < 1);

  for (const result of Object.values(data.reconciliation)) {
    assert.ok(Math.abs(result.publicCostDeltaCents) <= 200);
    assert.ok(Math.abs(result.cohesionPublicCostDeltaCents) <= 200);
    assert.ok(Math.abs(result.paymentsDeltaCents) <= 200);
    assert.ok(Math.abs(result.cohesionPaymentsDeltaCents) <= 200);
    assert.equal(result.projectsDelta, 0);
  }
});

test("OpenCoesione contract rejects unsafe money and unofficial URLs", async () => {
  const original = await loadSnapshot();
  const unsafeMoney = structuredClone(original);
  unsafeMoney.totals.publicCostCents = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => assertOpenCoesioneSnapshot(unsafeMoney), /intero sicuro/);

  const unofficial = structuredClone(original);
  unofficial.themes[0].sourceUrl = "https://example.com/not-the-source";
  assert.throws(() => assertOpenCoesioneSnapshot(unofficial), /ufficiale/);

  const tamperedDimension = structuredClone(original);
  tamperedDimension.themes[0].publicCostCents += 10_000;
  assert.throws(
    () => assertOpenCoesioneSnapshot(tamperedDimension),
    /scarto memorizzato non corrisponde/,
  );
});

test("OpenCoesione annual series is ordered and cumulative", async () => {
  const data = assertOpenCoesioneSnapshot(await loadSnapshot());
  const recent = data.annualSeries.filter((point) => point.year >= 2000);

  for (let index = 1; index < recent.length; index += 1) {
    assert.ok(recent[index].year > recent[index - 1].year);
    assert.ok(recent[index].commitmentsCents >= recent[index - 1].commitmentsCents);
    assert.ok(recent[index].paymentsCents >= recent[index - 1].paymentsCents);
  }
});
