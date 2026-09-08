import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { anacAwardYearOptions, filterAnacProcurementByAwardYear: filter, parseAnacAwardYearFilter, selectAnacEntityProcurementCigs, loadAnacEntityProcurementPage } = await import("../src/lib/data/anac-entity-procurement-page.ts");
const { filterAnacProcurementByCpv, loadAnacCpvRecord } = await import("../src/lib/data/anac-procurement-cpv.ts");
const { selectAnacConcentrationAwards } = await import("../src/lib/data/anac-concentration-drilldown.ts");

function fixture() {
  const procedures = [{ cig: "CIG0000001", publishedAt: "2025-01-01" }, { cig: "CIG0000002", publishedAt: null }];
  const operators = ["a", "b"].map((ref) => ({ ref, name: ref, nameVariants: 1 }));
  const awards = Array.from({ length: 60 }, (_, i) => ({ cig: procedures[0].cig, awardId: String(i), awardedAt: i < 30 ? "2024-02-29" : "2026-01-01", amount: i < 30 ? "1.000001" : "9999999999999999.000001", amountStatus: "positive-subcent", operatorRefs: [i < 30 ? "a" : "b"], attribution: "single-operator" }));
  for (const [amount, amountStatus, attribution, operatorRefs] of [
    ["100.001", "positive-subcent", "multipart", ["a", "b"]],
    ["4", "positive-exact-cent", "ambiguous", ["a"]],
    ["8", "positive-exact-cent", "no-awardee", []],
    [null, "missing", "single-operator", ["a"]],
    ["0", "zero", "single-operator", ["a"]],
    ["-4", "negative", "single-operator", ["a"]],
    [null, "conflicting", "single-operator", ["a"]],
  ]) awards.push({ cig: procedures[0].cig, awardId: String(awards.length), awardedAt: null, amount, amountStatus, attribution, operatorRefs });
  return selectAnacEntityProcurementCigs({ codiceIpa: "fixture", procedures, operators, awards, meta: {} }, new Set(procedures.map((p) => p.cig)));
}

test("year query is strict; date validation rejects calendar normalization and ambiguity", () => {
  for (const value of [null, [], ["2024"], "2024-01-01", "24", " 2024", "2024 ", "0000", 2024]) assert.throws(() => parseAnacAwardYearFilter(value));
  assert.equal(parseAnacAwardYearFilter(undefined), "");
  assert.equal(parseAnacAwardYearFilter("undated"), "undated");
  for (const awardedAt of ["2025-02-29", "2024-02-30", "2025-13-01", "01/02/2025", "2025", "", "2025-01-01T00:00:00Z"]) {
    const profile = { ...fixture(), awards: [{ ...fixture().awards[0], awardedAt }] };
    assert.throws(() => filter(profile, "2025"));
    assert.throws(() => anacAwardYearOptions(profile));
  }
});

test("award year splits the same CIG, preserves exact amounts and never uses publishedAt", () => {
  const profile = fixture();
  const before = JSON.stringify(profile);
  assert.strictEqual(filter(profile, ""), profile);
  assert.deepEqual(anacAwardYearOptions(profile), { years: [{ year: "2026", awards: 30 }, { year: "2024", awards: 30 }], undated: 7 });
  const selected = filter(profile, "2024");
  assert.equal(selected.summary.procedureCount, 1);
  assert.equal(selected.summary.awardCount, 30);
  assert.equal(selected.summary.awardValue, "30.00003");
  assert.equal(selected.summary.unattributedAwardValue, "0");
  assert.equal(selected.operators[0].ref, "a");
  assert.equal(selected.operators[0].rankByCount, 1);
  assert.equal(selected.operators[0].rankByValue, 1);
  assert.equal(selected.concentration.value.marketTotal, "30.00003");
  assert.equal(filter(profile, "2026").summary.attributedAwardValue, "299999999999999970.00003");
  for (const metric of ["count", "value"]) for (const selection of ["top1", "top10", "all"]) {
    const detail = selectAnacConcentrationAwards(selected, metric, selection);
    assert.equal(detail.awards.length, 30);
    assert.ok(detail.awards.every((a) => a.awardedAt === "2024-02-29"));
    assert.equal(detail.weight, metric === "count" ? "30" : "30.00003");
  }
  const empty = filter(profile, "2025");
  assert.equal(empty.summary.awardCount, 0);
  assert.equal(empty.summary.procedureCount, 0);
  assert.equal(empty.concentration.count.status, "withheld");
  assert.equal(JSON.stringify(profile), before);
});

test("undated awards retain RTI, ambiguous, missing, conflicting and zero partitions", () => {
  const selected = filter(fixture(), "undated");
  assert.equal(selected.summary.awardCount, 7);
  assert.equal(selected.summary.positiveAwardCount, 3);
  assert.equal(selected.summary.awardValue, "112.001");
  assert.equal(selected.summary.attributedAwardValue, "0");
  assert.equal(selected.summary.unattributedAwardValue, "112.001");
  assert.equal(selected.summary.awardsWithStableAwardees, 5);
  assert.equal(selected.summary.awardsWithoutStableAwardees, 2);
  assert.equal(selected.operators.find((o) => o.ref === "a").awardCount, 6);
  assert.ok(selected.operators.every((o) => o.rankByValue === null));
  assert.equal(selected.concentration.value.status, "withheld");
});

test("locked Roma profile partitions by awardedAt and composes with CPV before year", async () => {
  const state = await loadAnacEntityProcurementPage({ codiceIpa: "c_h501", currentEntityCf: null, verifyLiveFiscalCode: false });
  assert.equal(state.status, "available");
  const profile = state.profile;
  const index = await loadAnacCpvRecord(profile);
  const coverage = anacAwardYearOptions(profile);
  assert.equal(coverage.years.reduce((n, y) => n + y.awards, coverage.undated), profile.summary.awardCount);
  const subsets = [...coverage.years.map((y) => y.year), "undated"].map((year) => filter(profile, year));
  const keys = subsets.flatMap((s) => s.awards.map((a) => a.cig + ":" + a.awardId));
  assert.equal(new Set(keys).size, profile.awards.length);
  assert.equal(keys.length, profile.awards.length);
  const cpv = filterAnacProcurementByCpv(profile, index, "45233141");
  const selected = filter(cpv, "2025");
  assert.ok(selected.awards.length > 0);
  assert.equal(selected.cpvFilter, "45233141");
  assert.equal(selected.awardYearFilter, "2025");
  assert.deepEqual(selected.awards, cpv.awards.filter((a) => a.awardedAt?.startsWith("2025-")));
  assert.ok(selected.procedures.every((p) => selected.awards.some((a) => a.cig === p.cig)));
});
