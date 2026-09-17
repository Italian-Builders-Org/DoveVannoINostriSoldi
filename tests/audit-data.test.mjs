import assert from "node:assert/strict";
import test from "node:test";
import {
  auditClassifications,
  auditMethodology,
  auditScenarioBasis,
  auditScenarioAssumptions,
  auditScenarios,
  auditSignals,
  availableAuditYears,
  centralScenarioBreakdown,
  getAuditSignalsForYear,
  getProcurementAvailability,
  parseAuditYearQuery,
  procurementComparison,
  procurementComparisons,
  procurementReducedCompetition2025,
  procurementServicesAndSupplies2025,
} from "../src/lib/audit-data.ts";

test("audit signals preserve source, date and interpretation limits", () => {
  const officialHosts = new Set([
    "www.agenziaentrateriscossione.gov.it",
    "www.anticorruzione.it",
    "www.corteconti.it",
    "www.efficienzaenergetica.enea.it",
    "www.gdf.gov.it",
    "www.mef.gov.it",
    "www.senato.it",
  ]);
  assert.ok(auditSignals.length >= 6);
  for (const signal of auditSignals) {
    assert.match(signal.source.url, /^https:\/\//);
    assert.ok(officialHosts.has(new URL(signal.source.url).hostname), signal.source.url);
    assert.ok(signal.referenceDate.length >= 4);
    assert.ok(signal.caveat.length > 20);
    assert.equal(signal.additive, false);
    assert.equal(signal.verificationUse, "screening-only");
    assert.equal(signal.source.documentType, "official-report");
    assert.ok(auditClassifications[signal.classification]);
    assert.ok(signal.coverage.length > 20);
    assert.ok(signal.evidenceStatus.length > 15);
  }
  assert.ok(auditMethodology.aiUse.prohibited.some((item) => /sommare/.test(item)));
  assert.ok(auditMethodology.aiUse.prohibited.some((item) => /responsabilit/.test(item)));
  assert.ok(auditSignals.every((signal) => !signal.source.url.includes("mirapa.it")));
  assert.ok(auditSignals.every((signal) => !signal.source.url.includes("consregsardegna.it")));
  const taxExpenditures = auditSignals.find((signal) => signal.id === "tax-expenditures");
  assert.ok(taxExpenditures?.plainMeaning.includes("297"));
  const gdf = auditSignals.find((signal) => signal.id === "gdf-public-spending-fraud");
  assert.equal(gdf?.valueQualifier, "over");
  assert.ok(!auditSignals.some((signal) => signal.id === "pnrr-spending"));
  assert.deepEqual(Object.keys(auditClassifications), [
    "official-control-result",
    "reduced-competition",
    "operational-delay",
    "administrative-liability",
    "hard-to-collect-credit",
    "policy-review",
    "policy-scenario",
  ]);
  assert.ok(auditSignals.some((signal) => signal.classification === "official-control-result"));
  assert.ok(auditSignals.some((signal) => signal.classification === "reduced-competition"));
  assert.ok(auditSignals.some((signal) => signal.classification === "operational-delay"));
  assert.ok(auditSignals.some((signal) => signal.classification === "administrative-liability"));
  assert.ok(auditSignals.some((signal) => signal.classification === "hard-to-collect-credit"));
  assert.ok(auditSignals.some((signal) => signal.classification === "policy-review"));
});

test("procurement series keeps the same scope across annual reports", () => {
  assert.deepEqual(Object.keys(procurementComparisons), ["2023", "2024", "2025"]);
  assert.equal(procurementComparison, procurementComparisons[2025]);
  for (const comparison of Object.values(procurementComparisons)) {
    assert.equal(comparison.subject, "Affidamenti diretti");
    assert.ok(comparison.byNumber > comparison.byValue);
    assert.ok(Number.isInteger(comparison.procedureCount));
    assert.ok(comparison.procedureCount > 250_000);
    assert.ok(comparison.totalValueBillion > 250);
    assert.match(comparison.sourceUrl, /^https:\/\/www\.anticorruzione\.it\//);
    assert.match(comparison.sourcePublishedAt, /^20\d{2}-\d{2}-\d{2}$/);
  }
  assert.equal(procurementComparisons[2023].byNumber, 49.6);
  assert.equal(procurementComparisons[2023].byValue, 6.5);
  assert.equal(procurementComparisons[2024].byNumber, 54.3);
  assert.equal(procurementComparisons[2024].byValue, 6.1);
  assert.equal(procurementComparisons[2025].byNumber, 55.3);
  assert.equal(procurementComparisons[2025].byValue, 5.1);
  for (const comparison of Object.values(procurementComparisons)) {
    const signal = auditSignals.find(
      (candidate) => candidate.id === `procurement-direct-awards-${comparison.year}`,
    );
    assert.equal(signal?.source.url, comparison.sourceUrl);
    assert.equal(signal?.value, comparison.byNumber);
    assert.ok(signal?.caveat.includes(comparison.byValue.toFixed(1).replace(".", ",")));
  }

  const reducedCompetition = auditSignals.find((signal) => signal.id === "procurement-low-competition-value");
  assert.equal(reducedCompetition?.source.url, procurementComparisons[2025].sourceUrl);
  assert.ok(reducedCompetition?.plainMeaning.includes("19,3%"));
  const reducedCompetitionShare =
    ((reducedCompetition?.value ?? 0) / procurementComparisons[2025].totalValueBillion) * 100;
  assert.equal(Number(reducedCompetitionShare.toFixed(1)), 19.3);
  assert.equal(
    procurementReducedCompetition2025.directAwardsBillion
      + procurementReducedCompetition2025.negotiatedWithoutTenderBillion,
    procurementReducedCompetition2025.totalBillion,
  );
  assert.equal(procurementReducedCompetition2025.directAwardsBillion, 15.702);
  assert.equal(procurementReducedCompetition2025.negotiatedWithoutTenderBillion, 44.084);
  assert.equal(procurementServicesAndSupplies2025.directAwardShare, 95);
  assert.equal(procurementServicesAndSupplies2025.replicatedDirectAwardShare, 93.00067);
  assert.match(procurementServicesAndSupplies2025.replicationObservedAt, /^20\d{2}-\d{2}-\d{2}$/);
  assert.equal(procurementServicesAndSupplies2025.thresholdBandCount2025, 13_879);
  assert.match(procurementServicesAndSupplies2025.sourceUrl, /^https:\/\/www\.anticorruzione\.it\//);
  assert.match(procurementServicesAndSupplies2025.replicationUrl, /^https:\/\/github\.com\//);
  assert.equal(reducedCompetition?.value, procurementReducedCompetition2025.totalBillion);
  assert.ok(reducedCompetition?.evidenceStatus.includes("44,084"));
  assert.ok(reducedCompetition?.evidenceStatus.includes("15,702"));
  assert.equal(getProcurementAvailability(2025).status, "available");
  assert.equal(getProcurementAvailability(2026).status, "not-yet-published");
});

test("every supported audit year has at least one dated signal", () => {
  assert.deepEqual(availableAuditYears, [2026, 2025, 2024, 2023]);
  for (const year of availableAuditYears) {
    const signals = getAuditSignalsForYear(year);
    assert.ok(signals.length > 0, `missing signals for ${year}`);
    assert.ok(signals.every((signal) => signal.referenceDate.startsWith(String(year))));
  }
});

test("audit year parsing rejects impossible values without falling back to 2025", () => {
  assert.equal(parseAuditYearQuery(null, 2026), null);
  assert.equal(parseAuditYearQuery("2026", 2026), 2026);
  assert.equal(parseAuditYearQuery("2022", 2026), 2022);
  for (const value of ["0000", "1999", "9999", "abcd"]) {
    assert.throws(() => parseAuditYearQuery(value, 2026), /non è valido/);
  }
});

test("central scenario equals its visible components and scenarios stay ordered", () => {
  const central = auditScenarios.find((scenario) => scenario.id === "central");
  assert.ok(central);
  const components = centralScenarioBreakdown.reduce((sum, item) => sum + item.value, 0);
  assert.ok(Math.abs(components - central.annualBillion) < 0.000001);
  assert.equal(auditScenarioBasis.taxExpendituresBillion, 108.6);
  assert.equal(auditScenarioBasis.externalHealthcareStaffBillion, 0.568);
  assert.equal(auditScenarioBasis.modelVersion, "2026-06-24.1");
  for (const scenario of auditScenarios) {
    const assumptions = auditScenarioAssumptions[scenario.id];
    const expected =
      auditScenarioBasis.reducedCompetitionBillion
        * assumptions.procurementAuditedShare
        * assumptions.procurementEfficiencyRate
      + auditScenarioBasis.taxExpendituresBillion * assumptions.taxReviewRate
      + auditScenarioBasis.externalHealthcareStaffBillion * assumptions.healthcareReductionRate
      + auditScenarioBasis.purchasesWithoutPriorCommitmentBillion * assumptions.debtPreventionRate;
    assert.ok(Math.abs(scenario.annualBillion - expected) < 0.000000001);
  }
  assert.ok(Math.abs(auditScenarios[0].annualBillion - 1.4383151) < 0.000000001);
  assert.ok(Math.abs(auditScenarios[1].annualBillion - 4.11206045) < 0.000000001);
  assert.ok(Math.abs(auditScenarios[2].annualBillion - 7.0846663) < 0.000000001);
  assert.deepEqual(
    auditScenarios.map((scenario) => scenario.annualBillion),
    [...auditScenarios].map((scenario) => scenario.annualBillion).sort((a, b) => a - b),
  );
});
