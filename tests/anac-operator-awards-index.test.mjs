import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  assertAnacOperatorIndexMeta,
  getAnacOperatorByRef,
  listAnacOperatorsPage,
  listTopAnacOperators,
  loadAnacOperatorsByRefs,
  loadAnacOperatorIndexMeta,
  loadAnacOperatorNationalSummaries,
  searchAnacOperators,
} = await import("../src/lib/data/anac-operator-awards-index.ts");

test("ANAC operator awards index meta is source-locked and CF-free", () => {
  const meta = loadAnacOperatorIndexMeta();
  const verified = assertAnacOperatorIndexMeta(meta);
  assert.equal(verified.dataset, "anac-operator-awards-index");
  assert.equal(verified.privacy.containsOperatorTaxIds, false);
  assert.equal(verified.privacy.containsOperatorTaxIdHashes, false);
  assert.equal(verified.privacy.containsOperatorNames, true);
  assert.ok(verified.totals.operators > 100_000);
  assert.equal(verified.shards.length, 256);
  assert.equal(verified.contract.maxAwardsPublishedPerOperator, 15);
  const enrich = meta.cigEnrichment;
  assert.ok(enrich && typeof enrich === "object");
  assert.ok(Number(enrich.coverage?.uniqueMatchedCigs) > 1_000_000);
  assert.equal(enrich.years?.length, 19);
});

test("ANAC operator search returns denomination hits without tax ids", () => {
  const result = searchAnacOperators({ q: "autostrade", limit: 10 });
  assert.ok(result.normalizedQuery.length >= 3);
  assert.ok(result.matched >= 1);
  assert.ok(result.hits.length >= 1);
  for (const hit of result.hits) {
    assert.match(hit.ref, /^op-[0-9]{8}$/);
    assert.ok(hit.name.length > 0);
    assert.ok(!JSON.stringify(hit).toLowerCase().includes("codice_fiscale"));
  }
  const detail = getAnacOperatorByRef(result.hits[0].ref);
  assert.ok(detail);
  assert.equal(detail.ref, result.hits[0].ref);
  assert.ok(detail.awards.length <= 15);
  assert.ok(detail.awardCount >= detail.awardsPublished);
});

test("ANAC operator top list ranks by award count by default", () => {
  const top = listTopAnacOperators({ limit: 10 });
  assert.equal(top.rankBy, "awardCount");
  assert.equal(top.hits.length, 10);
  for (let index = 1; index < top.hits.length; index += 1) {
    assert.ok(top.hits[index - 1].awardCount >= top.hits[index].awardCount);
  }
  const byValue = listTopAnacOperators({ by: "valore", limit: 5 });
  assert.equal(byValue.rankBy, "attributedValue");
  assert.equal(byValue.hits.length, 5);
});

test("ANAC operator page lists all operators with stable pagination", () => {
  const pageOne = listAnacOperatorsPage({ page: 1, pageSize: 50 });
  assert.equal(pageOne.page, 1);
  assert.equal(pageOne.hits.length, 50);
  assert.equal(pageOne.total, pageOne.meta.totals.operators);
  assert.ok(pageOne.pageCount > 1000);
  const pageTwo = listAnacOperatorsPage({ page: 2, pageSize: 50 });
  assert.equal(pageTwo.page, 2);
  assert.notEqual(pageTwo.hits[0].ref, pageOne.hits[0].ref);
  const details = loadAnacOperatorsByRefs(pageOne.hits.slice(0, 5).map((hit) => hit.ref));
  assert.equal(details.size, 5);
  for (const hit of pageOne.hits.slice(0, 5)) {
    assert.equal(details.get(hit.ref)?.ref, hit.ref);
    assert.ok((details.get(hit.ref)?.awards.length ?? 0) >= 1);
  }
});

test("ANAC operator lookup rejects malformed refs", () => {
  assert.equal(getAnacOperatorByRef("op-1"), null);
  assert.equal(getAnacOperatorByRef("not-a-ref"), null);
});

test("ANAC operator national summaries are source-locked and ranked", () => {
  const meta = loadAnacOperatorIndexMeta();
  assert.ok(meta.summaries);
  const summaries = loadAnacOperatorNationalSummaries();
  assert.equal(summaries.coverage.operators, meta.totals.operators);
  assert.equal(summaries.topOperatorsByAwardCount.length, summaries.basis.limit);
  assert.equal(summaries.topOperatorsByAttributedValue.length, summaries.basis.limit);
  assert.equal(summaries.topCpv.length, summaries.basis.limit);
  assert.equal(summaries.topContractingAuthorities.length, summaries.basis.limit);
  assert.equal(summaries.topProcedureObjects.length, summaries.basis.limit);
  for (let index = 1; index < summaries.topOperatorsByAwardCount.length; index += 1) {
    assert.ok(
      summaries.topOperatorsByAwardCount[index - 1].awardCount >=
        summaries.topOperatorsByAwardCount[index].awardCount,
    );
  }
  for (const row of summaries.topCpv) {
    assert.notEqual(row.code, "99999999");
    assert.ok(!/non disponibile/i.test(row.label));
  }
  for (const row of summaries.topProcedureObjects) {
    assert.ok(!/non pubblicabile/i.test(row.label));
    assert.ok(row.label.length >= 16);
  }
});
