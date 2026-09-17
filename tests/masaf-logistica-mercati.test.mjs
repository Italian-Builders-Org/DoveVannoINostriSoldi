import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  getMasafMercatiProject,
  getMasafMercatiSummaries,
  masafMercatiDenials,
  masafMercatiMeta,
  masafMercatiProjects,
  queryMasafMercati,
} = await import("../src/lib/masaf-logistica-mercati-snapshot.ts");

test("MASAF Mercati snapshot keeps coverage, money natures and missing payments distinct", () => {
  assert.equal(masafMercatiMeta.datasetId, "masaf-logistica-mercati");
  assert.equal(masafMercatiMeta.measure.line, "mercati");
  assert.equal(masafMercatiMeta.licenseStatus, "not-declared");
  assert.equal(masafMercatiProjects.length, 36);
  assert.equal(masafMercatiDenials.length, 3);
  assert.equal(masafMercatiMeta.counts.withCup, 24);
  assert.equal(masafMercatiMeta.counts.withGranted, 23);
  assert.equal(
    masafMercatiProjects.filter((project) => project.cup).length,
    masafMercatiMeta.counts.withCup,
  );
  assert.ok(masafMercatiProjects.every((project) => project.erogazioniEuro === null));
  assert.ok(masafMercatiProjects.every((project) => project.pagamentiEuro === null));

  const verona = getMasafMercatiProject("C35C23001030005");
  assert.equal(verona?.beneficiario, "Veronamercato Spa.");
  assert.equal(verona?.agevolazioneConcessaEuro, 10_000_000);
  assert.equal(verona?.agevolazioneConcessaCents, 1_000_000_000);
});

test("summary tables expose beneficiaries and do not collapse missing grants into zero", () => {
  const summaries = getMasafMercatiSummaries();
  assert.equal(summaries.topBeneficiari.length, 12);
  assert.equal(summaries.topBeneficiari[0].beneficiario, "Veronamercato Spa.");
  assert.equal(summaries.byArea.length, 3);
  assert.ok(summaries.byStato.some((row) => row.label === "Solo in graduatoria"));
  const missingGrant = masafMercatiProjects.find((project) => project.cup && project.agevolazioneConcessaEuro === null);
  assert.equal(missingGrant?.beneficiario, "La Valle della Pescara");
  assert.equal(missingGrant?.agevolazioneConcessaEuro, null);
});

test("query rejects unknown filters and finds an exact CUP", () => {
  const found = queryMasafMercati({ q: "C35C23001030005", limit: 10 });
  assert.equal(found.total, 1);
  assert.equal(found.projects[0].cup, "C35C23001030005");
  assert.throws(() => queryMasafMercati({ limit: 101 }), /limit non valido/);
});
