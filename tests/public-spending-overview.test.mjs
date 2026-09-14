import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildPublicSpendingOverview, SPENDING_FUNCTIONS } from "../src/lib/public-spending-overview.ts";

const options = { year: 2024, baselineYear: 2019, toleranceCents: 0 };
function fixture() {
  const rows = SPENDING_FUNCTIONS.flatMap(([code]) => [
    { geo: "IT", function: code, year: 2024, amountCents: 200, shareOfGdpHundredths: 200 },
    { geo: "IT", function: code, year: 2019, amountCents: 100, shareOfGdpHundredths: 150 },
    { geo: "EU27_2020", function: code, year: 2024, amountCents: 900, shareOfGdpHundredths: 160, flag: "p" },
  ]);
  rows.push({ geo: "IT", function: "TOTAL", year: 2024, amountCents: 2000, shareOfGdpHundredths: 2000 });
  return rows;
}

test("all ten functions, exact money and Italy-only denominator", () => {
  const result = buildPublicSpendingOverview(fixture(), options);
  assert.equal(result.coveredFunctions, 10);
  assert.equal(result.totalAmountCents, 2000);
  assert.equal(result.rows[0].shareOfTotalPercent, 10);
  assert.equal(result.rows[0].changePercent, 100);
  assert.equal(result.rows[0].gapWithEuPercentagePoints, 0.4);
  assert.equal(result.rows[0].euFlag, "p");
});
test("missing current cell fails closed instead of inventing zero", () => {
  assert.throws(() => buildPublicSpendingOverview(fixture().slice(1), options), /mancante/);
});
test("duplicated cell fails closed", () => {
  const data = fixture(); data.push(data[0]);
  assert.throws(() => buildPublicSpendingOverview(data, options), /duplicata/);
});
test("money is safe integer cents, never NaN, fraction or unsafe integer", () => {
  for (const invalid of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const data = fixture(); data[0].amountCents = invalid;
    assert.throws(() => buildPublicSpendingOverview(data, options), /centesimi/);
  }
});
test("a break in an intermediate year blocks the whole nominal comparison", () => {
  const data = fixture(); data.push({ ...data[0], year: 2021, flag: "b" });
  const row = buildPublicSpendingOverview(data, options).rows[0];
  assert.equal(row.changeCents, null); assert.equal(row.changePercent, null);
  assert.match(row.comparisonLimit, /Interruzione/);
});
test("missing baseline does not remove a current spending area", () => {
  const data = fixture().filter((r) => !(r.geo === "IT" && r.function === "GF01" && r.year === 2019));
  const result = buildPublicSpendingOverview(data, options);
  assert.equal(result.rows.length, 10); assert.equal(result.rows[0].changePercent, null);
});
test("zero baseline keeps absolute difference, not an infinite percentage", () => {
  const data = fixture(); data[1].amountCents = 0;
  const row = buildPublicSpendingOverview(data, options).rows[0];
  assert.equal(row.changeCents, 200); assert.equal(row.changePercent, null);
});
test("published total is not replaced with sum of components", () => {
  const data = fixture(); data.at(-1).amountCents = 2001;
  const result = buildPublicSpendingOverview(data, { ...options, toleranceCents: 1 });
  assert.equal(result.totalAmountCents, 2001); assert.equal(result.reconciliationGapCents, -1);
  assert.throws(() => buildPublicSpendingOverview(data, options), /riconciliano/);
});
test("invalid years and null denominator fail closed", () => {
  assert.throws(() => buildPublicSpendingOverview(fixture(), { ...options, baselineYear: 2024 }), /Periodo/);
  const data = fixture(); data.at(-1).amountCents = 0;
  assert.throws(() => buildPublicSpendingOverview(data, options), /nullo/);
});

const path = "src/data/generated/eurostat-cofog-2014-2024.data.json";
test("canonical repository corpus reconciles and produces a reproducible report basis", { skip: !fs.existsSync(path) }, (t) => {
  const bytes = fs.readFileSync(path);
  const corpus = JSON.parse(bytes);
  const overview = buildPublicSpendingOverview(corpus.observations, {
    ...options, toleranceCents: corpus.reconciliation.toleranceCents,
  });
  assert.equal(overview.rows.length, 10);
  assert.ok(overview.totalAmountCents > 0);
  t.diagnostic(JSON.stringify({ sourcePath: path, sha256: createHash("sha256").update(bytes).digest("hex"), overview }));
});
