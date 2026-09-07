import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cpv = await import("../src/lib/data/anac-procurement-cpv.ts");
const domain = await import("../src/lib/data/anac-entity-procurement-page.ts");
const { selectAnacConcentrationAwards } = await import("../src/lib/data/anac-concentration-drilldown.ts");

function fixture() {
  const procedures = ["CIG0000001", "CIG0000002", "CIG0000003"].map((cig) => ({ cig, publishedAt: "2025-01-03" }));
  const operators = ["a", "b"].map((ref) => ({ ref, name: ref.toUpperCase(), nameVariants: 1 }));
  const awards = Array.from({ length: 60 }, (_, i) => ({
    cig: i < 30 ? procedures[0].cig : procedures[1].cig, awardId: String(i + 1), awardedAt: "2025-01-04",
    amount: i < 30 ? "1.000001" : "9999999999999999.000001", amountStatus: "positive-subcent",
    attribution: "single-operator", operatorRefs: [i < 30 ? "a" : "b"],
  }));
  for (const [amount, amountStatus, attribution, operatorRefs] of [
    ["100.001", "positive-subcent", "multipart", ["a", "b"]],
    ["4", "positive-exact-cent", "ambiguous", ["a"]],
    ["8", "positive-exact-cent", "no-awardee", []],
    [null, "missing", "single-operator", ["a"]],
    ["0", "zero", "single-operator", ["a"]],
    ["-4", "negative", "single-operator", ["a"]],
    [null, "conflicting", "single-operator", ["a"]],
  ]) awards.push({ cig: procedures[0].cig, awardId: String(awards.length + 1), awardedAt: null, amount, amountStatus, attribution, operatorRefs });
  const profile = domain.selectAnacEntityProcurementCigs({ codiceIpa: "test", procedures, operators, awards, meta: {} }, new Set(procedures.map((p) => p.cig)));
  const index = { codiceIpa: "test", procedures: [
    { cig: procedures[0].cig, rawCode: "45112000-5", description: "LAVORI DI SCAVO" },
    { cig: procedures[1].cig, rawCode: "85312320", description: "" },
    { cig: procedures[2].cig, rawCode: "", description: "Non inferire dal testo" },
  ] };
  return { profile, index };
}

test("CPV accepts the two source formats, preserving labels and unknown values", () => {
  assert.equal(cpv.normalizeAnacCpv(" 45112000-5 "), "45112000");
  assert.equal(cpv.normalizeAnacCpv("85312320"), "85312320");
  for (const raw of ["", "00000000-0", "45", "45.112.000", "not-known", "45112000-55"]) assert.equal(cpv.normalizeAnacCpv(raw), null);
  for (const value of [[], ["45112000", "85312320"], "45112000-5", "45", "00000000", null]) assert.throws(() => cpv.parseAnacCpvFilter(value));
  const { index } = fixture();
  const options = cpv.anacCpvOptions(index);
  assert.equal(options.unclassified, 1);
  assert.deepEqual(options.options, [
    { code: "45112000", procedures: 1, descriptions: ["LAVORI DI SCAVO"] },
    { code: "85312320", procedures: 1, descriptions: [] },
  ]);
});

test("CPV filter recomputes exact amounts, rankings and all attribution partitions", () => {
  const { profile, index } = fixture();
  const before = JSON.stringify(profile);
  const result = cpv.filterAnacProcurementByCpv(profile, index, "45112000");
  assert.equal(result.procedures.length, 1);
  assert.equal(result.summary.awardCount, 37);
  assert.equal(result.summary.positiveAwardCount, 33);
  assert.equal(result.summary.awardValue, "142.00103");
  assert.equal(result.summary.attributedAwardValue, "30.00003");
  assert.equal(result.summary.unattributedAwardValue, "112.001");
  assert.equal(result.summary.singleOperatorAwards, 34);
  assert.equal(result.summary.multipartOrAmbiguousAwards, 2);
  assert.equal(result.summary.awardsWithStableAwardees, 35);
  assert.equal(result.summary.awardsWithoutStableAwardees, 2);
  assert.equal(result.operators.find((o) => o.ref === "a").rankByValue, 1);
  assert.equal(result.operators.find((o) => o.ref === "b").rankByValue, null);
  assert.equal(result.concentration.value.marketTotal, "30.00003");
  assert.equal(result.concentration.value.top1Ref, "a");
  assert.deepEqual(result.concentration.value.hhi10000, { numerator: "10000", denominator: "1" });
  const detail = selectAnacConcentrationAwards(result, "value", "all");
  assert.equal(detail.awards.length, 30);
  assert.equal(detail.weight, "30.00003");
  assert.ok(detail.awards.every((a) => a.cig === index.procedures[0].cig));
  assert.equal(JSON.stringify(profile), before, "Filtering must not mutate shared profiles");
  assert.strictEqual(cpv.filterAnacProcurementByCpv(profile, index, ""), profile);
  const other = cpv.filterAnacProcurementByCpv(profile, index, "85312320");
  assert.equal(other.summary.attributedAwardValue, "299999999999999970.00003");
  assert.equal(other.operators[0].ref, "b", "Operator references are stable across filters");
});

test("unknown CPVs and unclassified procedures are distinct from unavailable indexes", () => {
  const { profile, index } = fixture();
  const empty = cpv.filterAnacProcurementByCpv(profile, index, "12345678");
  assert.equal(empty.summary.procedureCount, 0);
  assert.equal(empty.summary.awardValue, "0");
  assert.equal(empty.concentration.count.status, "withheld");
  const unknown = cpv.filterAnacProcurementByCpv(profile, index, "unclassified");
  assert.equal(unknown.summary.procedureCount, 1);
  assert.equal(unknown.summary.awardCount, 0);
  for (const broken of [null, { ...index, codiceIpa: "another" }, { ...index, procedures: index.procedures.slice(1) }, { ...index, procedures: [...index.procedures].reverse() }]) {
    assert.throws(() => cpv.filterAnacProcurementByCpv(profile, broken, "45112000"));
  }
  assert.throws(() => domain.selectAnacEntityProcurementCigs(profile, new Set(["OTHER00001"])));
});

test("Top 1 and Top 10 select exact deterministic cohorts across tied ranks", () => {
  const operators = Array.from({ length: 30 }, (_, i) => ({ ref: `op-${String(i).padStart(6, "0")}`, name: `Operator ${String(i).padStart(2, "0")}`, rankByCount: 1, rankByValue: 1, awardCount: 1, attributedAwardCount: 1, attributedValue: "1" })).reverse();
  const awards = operators.map((o) => ({ cig: o.ref, awardId: o.ref, operatorRefs: [o.ref], attribution: "single-operator", amount: "1", amountStatus: "positive-exact-cent" }));
  const profile = { operators, awards, concentration: domain.deriveAnacEntityProcurementConcentration({ operators, summary: { awardCount: 30, attributedAwardValue: "30" } }) };
  for (const dimension of ["count", "value"]) {
    const top1 = selectAnacConcentrationAwards(profile, dimension, "top1");
    assert.deepEqual(top1.operators.map((o) => o.ref), ["op-000000"]);
    assert.equal(top1.awards.length, 1);
    const top10 = selectAnacConcentrationAwards(profile, dimension, "top10");
    assert.equal(top10.operators.length, 10);
    assert.equal(top10.awards.length, 10);
    assert.equal(top10.weight, "10");
    assert.equal(selectAnacConcentrationAwards(profile, dimension, "all").awards.length, 30);
  }
});

test("Roma CPV categories partition the locked profile and reconcile filtered indicators", async () => {
  const state = await domain.loadAnacEntityProcurementPage({ codiceIpa: "c_h501", currentEntityCf: null, verifyLiveFiscalCode: false });
  assert.equal(state.status, "available");
  const profile = state.profile;
  const index = await cpv.loadAnacCpvRecord(profile);
  const { options, unclassified } = cpv.anacCpvOptions(index);
  assert.equal(options.reduce((sum, option) => sum + option.procedures, unclassified), profile.summary.procedureCount);
  const all = domain.selectAnacEntityProcurementCigs(profile, new Set(profile.procedures.map((p) => p.cig)));
  assert.deepEqual(all.summary, profile.summary);
  assert.deepEqual(all.operators, profile.operators);
  assert.deepEqual(all.concentration, profile.concentration);
  for (const option of [...options].sort((a, b) => b.procedures - a.procedures).slice(0, 5)) {
    const filtered = cpv.filterAnacProcurementByCpv(profile, index, option.code);
    assert.equal(filtered.procedures.length, option.procedures);
    assert.ok(filtered.awards.every((award) => filtered.procedures.some((p) => p.cig === award.cig)));
    for (const dimension of ["count", "value"]) for (const selection of ["top1", "top10", "all"]) {
      const detail = selectAnacConcentrationAwards(filtered, dimension, selection);
      if (!detail) continue;
      if (dimension === "count") assert.equal(String(detail.relationCount), detail.weight);
      else {
        const scale = Math.max(...detail.awards.map((a) => a.amount.split(".")[1]?.length ?? 0), detail.weight.split(".")[1]?.length ?? 0);
        const scaled = (v) => { const [w, f = ""] = v.split("."); return BigInt(w + f.padEnd(scale, "0")); };
        assert.equal(detail.awards.reduce((s, a) => s + scaled(a.amount), 0n), scaled(detail.weight));
      }
    }
  }
  const root = mkdtempSync(join(tmpdir(), "dvns-cpv-corrupt-"));
  try {
    const prefix = createHash("sha256").update(profile.codiceIpa).digest("hex").slice(0, 2);
    const files = ["scripts/etl/specs/anac-procurement-cpv.source.json", cpv.anacCpvSource.profiles.path, cpv.anacCpvSource.sourceLock.path, "src/data/generated/anac-procurement-cpv/meta.json", `src/data/generated/anac-procurement-cpv/${prefix}.jsonl.gz`];
    for (const path of files) { mkdirSync(join(root, path, ".."), { recursive: true }); copyFileSync(path, join(root, path)); }
    const shard = join(root, files.at(-1));
    const bytes = readFileSync(shard); bytes[bytes.length - 1] ^= 1; writeFileSync(shard, bytes);
    await assert.rejects(cpv.loadAnacCpvRecord(profile, root), /Hash indice CPV/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
