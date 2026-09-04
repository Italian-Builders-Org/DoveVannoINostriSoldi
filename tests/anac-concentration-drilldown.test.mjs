import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { deriveAnacEntityProcurementConcentration, loadAnacEntityProcurementPage } = await import("../src/lib/data/anac-entity-procurement-page.ts");
const { selectAnacConcentrationAwards } = await import("../src/lib/data/anac-concentration-drilldown.ts");

function fixture() {
  const awards = Array.from({ length: 30 }, (_, i) => ({
    cig: `C${String(i).padStart(9, "0")}`, awardId: String(i + 1),
    amount: i < 20 ? "1.000001" : "3.000002", amountStatus: "positive-subcent",
    attribution: "single-operator", operatorRefs: [i < 20 ? "a" : "b"],
  }));
  for (const [attribution, amountStatus, amount, operatorRefs] of [
    ["multipart", "positive-exact-cent", "100", ["a", "b"]],
    ["multipart", "positive-exact-cent", "50", ["a", "b"]],
    ["ambiguous", "positive-exact-cent", "8", ["a"]],
    ["no-awardee", "positive-exact-cent", "10", []],
    ["single-operator", "missing", null, ["a"]],
    ["single-operator", "zero", "0", ["a"]],
    ["single-operator", "negative", "-2", ["a"]],
    ["single-operator", "conflicting", null, ["a"]],
  ]) awards.push({ cig: `C${String(awards.length).padStart(9, "0")}`, awardId: String(awards.length + 1), attribution, amountStatus, amount, operatorRefs });
  const operators = [
    { ref: "a", name: "A", rankByCount: 1, rankByValue: 2, awardCount: 27, attributedAwardCount: 20, attributedValue: "20.00002" },
    { ref: "b", name: "B", rankByCount: 2, rankByValue: 1, awardCount: 12, attributedAwardCount: 10, attributedValue: "30.00002" },
  ];
  const summary = { awardCount: 38, attributedAwardValue: "50.00004" };
  return { operators, awards, concentration: deriveAnacEntityProcurementConcentration({ operators, summary }) };
}

function sumMicros(awards) {
  return awards.reduce((sum, { amount }) => {
    const [whole, fraction = ""] = amount.split(".");
    return sum + BigInt(whole + fraction.padEnd(6, "0"));
  }, 0n);
}

test("value Top 1 uses its own ranking and excludes multipart, unresolved and non-positive awards", () => {
  const profile = fixture();
  const detail = selectAnacConcentrationAwards(profile, "value", "top1");
  assert.deepEqual(detail.operators.map((o) => o.ref), ["b"]);
  assert.equal(detail.awards.length, 10);
  assert.equal(detail.relationCount, 10);
  assert.equal(detail.weight, "30.00002");
  assert.equal(sumMicros(detail.awards), 30_000_020n);
  assert.equal(detail.metric.marketTotal, "50.00004");
  for (const selection of ["top10", "all"]) {
    const all = selectAnacConcentrationAwards(profile, "value", selection);
    assert.equal(all.awards.length, 30);
    assert.equal(sumMicros(all.awards), 50_000_040n);
    assert.equal(all.weight, all.metric.marketTotal);
  }
});

test("count drill-down counts selected relations without duplicating multipart award rows", () => {
  const profile = fixture();
  const top = selectAnacConcentrationAwards(profile, "count", "top1");
  assert.deepEqual(top.operators.map((o) => o.ref), ["a"]);
  assert.equal(top.awards.length, 27);
  assert.equal(top.relationCount, 27);
  assert.equal(top.weight, "27");
  const all = selectAnacConcentrationAwards(profile, "count", "all");
  assert.equal(all.awards.length, 37);
  assert.equal(all.relationCount, 39);
  assert.equal(all.weight, "39");
  assert.equal(new Set(all.awards.map((a) => `${a.cig}:${a.awardId}`)).size, 37);
  assert.ok(all.awards.some((a) => a.attribution === "ambiguous"));
  assert.ok(all.awards.some((a) => a.amountStatus === "missing"));
  assert.ok(!all.awards.some((a) => a.attribution === "no-awardee"));
});

test("Top 10 selection follows the published ranks even when the input array is unordered", () => {
  const operators = Array.from({ length: 30 }, (_, i) => ({ ref: String(i), name: String(i), rankByCount: i + 1, rankByValue: i + 1, awardCount: 1, attributedAwardCount: 1, attributedValue: "1" })).reverse();
  const awards = operators.map((o) => ({ cig: o.ref, awardId: o.ref, operatorRefs: [o.ref], attribution: "single-operator", amount: "1", amountStatus: "positive-exact-cent" }));
  const profile = { operators, awards, concentration: deriveAnacEntityProcurementConcentration({ operators, summary: { awardCount: 30, attributedAwardValue: "30" } }) };
  for (const dimension of ["count", "value"]) {
    const detail = selectAnacConcentrationAwards(profile, dimension, "top10");
    assert.deepEqual(detail.operators.map((o) => o.ref).sort(), ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    assert.equal(detail.awards.length, 10);
    assert.equal(detail.weight, "10");
    assert.equal(selectAnacConcentrationAwards(profile, dimension, "all").awards.length, 30);
  }
});

test("withheld metrics do not expose a substitute zero or a broader award selection", () => {
  const profile = fixture();
  profile.concentration = deriveAnacEntityProcurementConcentration({ operators: [], summary: { awardCount: 0, attributedAwardValue: "0" } });
  for (const dimension of ["count", "value"]) for (const selection of ["top1", "top10", "all"]) {
    assert.equal(selectAnacConcentrationAwards(profile, dimension, selection), null);
  }
});

test("all six drill-down selections reconcile to the locked Roma profile", async () => {
  const state = await loadAnacEntityProcurementPage({ codiceIpa: "c_h501", currentEntityCf: null, verifyLiveFiscalCode: false });
  assert.equal(state.status, "available");
  for (const dimension of ["count", "value"]) for (const selection of ["top1", "top10", "all"]) {
    const detail = selectAnacConcentrationAwards(state.profile, dimension, selection);
    assert.ok(detail);
    if (dimension === "count") assert.equal(String(detail.relationCount), detail.weight);
    else {
      const scale = Math.max(...detail.awards.map((a) => a.amount.split(".")[1]?.length ?? 0), detail.weight.split(".")[1]?.length ?? 0);
      const scaled = (amount) => { const [whole, fraction = ""] = amount.split("."); return BigInt(whole + fraction.padEnd(scale, "0")); };
      assert.equal(detail.awards.reduce((sum, a) => sum + scaled(a.amount), 0n), scaled(detail.weight));
    }
  }
});
