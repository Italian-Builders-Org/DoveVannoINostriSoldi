import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  PnrrChildcareQueryError,
  awardeesForTender,
  pnrrChildcareData,
  pnrrChildcareMeta,
  queryPnrrChildcare,
} = await import("../src/lib/pnrr-childcare-snapshot.ts");
const {
  assertPnrrChildcareData,
  assertPnrrChildcareMeta,
  assertPnrrChildcareReconciliation,
} = await import("../src/lib/data/pnrr-childcare-contract.ts");

test("PNRR childcare snapshot reconciles the four official ItaliaDomani tables", () => {
  assert.equal(pnrrChildcareData.projects.length, 3_841);
  assert.equal(pnrrChildcareMeta.coverage.locationRows, 3_842);
  assert.equal(pnrrChildcareMeta.coverage.tenderRows, 18_851);
  assert.equal(pnrrChildcareMeta.coverage.awardeeRows, 18_250);
  assert.equal(pnrrChildcareMeta.coverage.unmatchedAwardeeRows, 2);
  assert.equal(pnrrChildcareMeta.integrity.dataArtifact.bytes, 18_591_740);
  assert.match(pnrrChildcareMeta.integrity.dataArtifact.sha256, /^[a-f0-9]{64}$/);
  assert.ok(pnrrChildcareMeta.totals.pnrrFundingCents > 400_000_000_000);
  assert.doesNotThrow(() => assertPnrrChildcareReconciliation(pnrrChildcareData, pnrrChildcareMeta));
});

test("exact CUP lookup returns one trace and missing CUP fails distinctly", () => {
  const project = pnrrChildcareData.projects[0];
  const result = queryPnrrChildcare({ cup: project.cup });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].cup, project.cup);
  assert.throws(
    () => queryPnrrChildcare({ cup: "A00000000000000" }),
    (error) => error instanceof PnrrChildcareQueryError && error.code === "not_found",
  );
  assert.throws(() => queryPnrrChildcare({ cup: "bad" }), /15 caratteri/);
});

test("territorial and text filters stay bounded and inspect every project location", () => {
  const result = queryPnrrChildcare({ region: "Lazio", limit: 7 });
  assert.equal(result.pagination.returned, 7);
  assert.ok(result.pagination.total > 7);
  assert.ok(result.data.every((project) => project.locations.some((location) => location.region.toLocaleLowerCase("it-IT") === "lazio")));
  const project = pnrrChildcareData.projects.find((item) => item.implementer.name);
  const searched = queryPnrrChildcare({ query: project.implementer.name, limit: 100 });
  assert.ok(searched.data.some((item) => item.cup === project.cup));
  assert.throws(() => queryPnrrChildcare({ limit: 101 }), /limit/);
  assert.throws(() => queryPnrrChildcare({ query: "x".repeat(201) }), /200 caratteri/);
  assert.throws(() => queryPnrrChildcare({ cup: project.cup, region: "Lazio" }), /Con cup/);
});

test("territorial filters accept official region and province codes", () => {
  const project = pnrrChildcareData.projects.find((item) => item.locations.some((location) => location.provinceCode));
  assert.ok(project);
  const location = project.locations.find((item) => item.provinceCode);
  assert.ok(location?.provinceCode);
  const result = queryPnrrChildcare({ province: location.provinceCode, limit: 100 });
  assert.ok(result.data.some((item) => item.cup === project.cup));
});

test("snapshot metadata cannot diverge from its data artifact", () => {
  const changed = {
    ...pnrrChildcareMeta,
    totals: { ...pnrrChildcareMeta.totals, tenderAmountCents: pnrrChildcareMeta.totals.tenderAmountCents + 1 },
  };
  assert.throws(
    () => assertPnrrChildcareReconciliation(pnrrChildcareData, changed),
    /totals.tenderAmountCents non riconciliato/,
  );
  const changedSubmeasure = {
    ...pnrrChildcareMeta,
    submeasure: { ...pnrrChildcareMeta.submeasure, label: "Etichetta diversa" },
  };
  assert.throws(
    () => assertPnrrChildcareReconciliation(pnrrChildcareData, changedSubmeasure),
    /periodo o submisura non riconciliati/,
  );
});

test("runtime contracts reject metadata submeasure drift and malformed framework CIGs", () => {
  const changedMeta = {
    ...pnrrChildcareMeta,
    submeasure: { ...pnrrChildcareMeta.submeasure, code: "M4C1I1.99.99" },
  };
  assert.throws(() => assertPnrrChildcareMeta(changedMeta), /meta\.submeasure\.code inatteso/);

  const changedData = structuredClone(pnrrChildcareData);
  const tender = changedData.projects.flatMap((project) => project.tenders).find((item) => item.frameworkCig === null);
  assert.ok(tender);
  tender.frameworkCig = "INVALID";
  assert.throws(() => assertPnrrChildcareData(changedData), /frameworkCig non valido/);
});

test("runtime contracts reject unknown artifact fields", () => {
  assert.throws(
    () => assertPnrrChildcareData({ ...pnrrChildcareData, unexpected: true }),
    /snapshot: chiavi non conformi/,
  );
  assert.throws(
    () => assertPnrrChildcareMeta({ ...pnrrChildcareMeta, unexpected: true }),
    /meta: chiavi non conformi/,
  );
});

test("awardees are attributed only through the full exact tender key", () => {
  let linked = 0;
  for (const project of pnrrChildcareData.projects) {
    for (const tender of project.tenders) linked += awardeesForTender(project, tender).length;
  }
  assert.equal(linked, pnrrChildcareMeta.coverage.awardeeRows - pnrrChildcareMeta.coverage.unmatchedAwardeeRows);
});
