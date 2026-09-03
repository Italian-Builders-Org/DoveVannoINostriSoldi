import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const corePath = new URL("../src/data/generated/government-scorecard.json", import.meta.url);
const registryPath = new URL("../scripts/ci/generated-artifacts.json", import.meta.url);
const pageSourceSpecPath = new URL("../scripts/etl/specs/government-scorecard-page.source.json", import.meta.url);
const core = JSON.parse(readFileSync(corePath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const pageSourceSpec = JSON.parse(readFileSync(pageSourceSpecPath, "utf8"));
const {
  GOVERNMENT_SCORECARD_V6_MANIFEST,
  parseGovernmentScorecardV6Input,
} = await import("../src/lib/data/government-scorecard-contract.ts");
const {
  GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS,
  getGovernmentScorecardV6SupplementalSnapshot,
  parseGovernmentScorecardV6SupplementalSnapshot,
} = await import("../src/lib/data/government-scorecard-page-contract.ts");
const {
  buildGovernmentScorecardV6Input,
  GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS,
} = await import("../src/lib/government-scorecard-governments.ts");

const EXPECTED_INDICATORS = [
  "inflation",
  "real_compensation",
  "unemployment",
  "employment_rate",
  "real_gdp_per_capita",
  "debt_ratio",
  "debt_per_capita",
  "primary_balance",
  "investment_share",
];

test("the feature owns exactly two registered generated artifacts", () => {
  const artifact = registry.artifacts.find((candidate) => candidate.id === "government-scorecard");
  assert.ok(artifact);
  assert.deepEqual(artifact.files, [
    "src/data/generated/government-scorecard.json",
    "src/data/generated/government-scorecard-page.json",
  ]);
  const generated = readdirSync(new URL("../src/data/generated/", import.meta.url))
    .filter((name) => name.startsWith("government-scorecard"))
    .sort();
  assert.deepEqual(generated, ["government-scorecard-page.json", "government-scorecard.json"]);
});

test("the display snapshot documents the typed-snapshot exception and semantic axes", () => {
  assert.deepEqual(pageSourceSpec.importDecision, {
    path: "typed-snapshot",
    duplicatesIntegratedDataset: false,
    reason: pageSourceSpec.importDecision.reason,
  });
  assert.ok(pageSourceSpec.importDecision.reason.length > 80);
  assert.deepEqual(Object.keys(pageSourceSpec.semanticAxes), ["money", "period", "provenance"]);
  assert.equal(pageSourceSpec.semanticAxes.money.status, "limited");
  assert.equal(pageSourceSpec.semanticAxes.period.status, "declared");
  assert.equal(pageSourceSpec.semanticAxes.provenance.status, "declared");
  assert.deepEqual(pageSourceSpec.sourceContract.formats, [
    "AMECO CSV ZIP via the registered core artifact",
    "Eurostat JSON-stat 2.0",
  ]);
  assert.deepEqual(pageSourceSpec.sourceContract.termsUrls, [
    "https://commission.europa.eu/legal-notice_en",
    "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
  ]);
  for (const source of pageSourceSpec.sources) {
    assert.match(source.landingUrl, /^https:\/\//);
  }
});

test("the artifact registry lists every official display dataset", () => {
  const artifact = registry.artifacts.find((candidate) => candidate.id === "government-scorecard");
  const upstreamUrls = artifact.publication.upstreamUrls;
  for (const source of pageSourceSpec.sources.filter((candidate) => candidate.datasetCode !== "AMECO")) {
    assert.ok(
      upstreamUrls.some((url) => url.includes(`/view/${source.datasetCode}/`)),
      `missing ${source.datasetCode} from artifact registry`,
    );
  }
});

test("the score artifact contains only the AMECO panel required by the current method", () => {
  assert.deepEqual(Object.keys(core).sort(), [
    "caveats",
    "generatedAt",
    "indicators",
    "methodologyVersion",
    "schemaVersion",
    "sources",
  ]);
  assert.equal(core.schemaVersion, 2);
  assert.equal(core.methodologyVersion, "peer-relative-v6");
  assert.deepEqual(Object.keys(core.sources), ["ameco"]);
  assert.deepEqual(core.indicators.map((indicator) => indicator.id), GOVERNMENT_SCORECARD_V6_MANIFEST.indicators.map((indicator) => indicator.id));
  assert.equal(core.sources.ameco.observedThrough, 2024);
  assert.equal(core.sources.ameco.forecastFrom, 2025);
  for (const indicator of core.indicators) {
    assert.deepEqual(Object.keys(indicator.countries), ["italy", "france", "germany", "spain"]);
    assert.ok(indicator.definition.length > 0);
    for (const points of Object.values(indicator.countries)) {
      assert.equal(points.length, 68);
      assert.equal(points[0].year, 1960);
      assert.equal(points.at(-1).year, 2027);
    }
  }
});

test("page data preserve publication status, sources and the score-artifact link", () => {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const coreHash = createHash("sha256").update(readFileSync(corePath)).digest("hex");
  const expectedLatestPeriods = new Map([
    ["inflation", "2026-08"],
    ["real_compensation", "2024"],
    ["unemployment", "2026-07"],
    ["employment_rate", "2026-Q1"],
    ["real_gdp_per_capita", "2026-Q2"],
    ["debt_ratio", "2026-Q1"],
    ["debt_per_capita", "2025"],
    ["primary_balance", "2026-Q1"],
    ["investment_share", "2026-Q2"],
  ]);
  assert.deepEqual(GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS, EXPECTED_INDICATORS);
  assert.equal(snapshot.score_contract.supplemental_score_impact, "none");
  assert.equal(snapshot.score_contract.core_artifact_sha256, coreHash);
  assert.deepEqual(snapshot.series.map((series) => series.indicator_id), EXPECTED_INDICATORS);
  for (const series of snapshot.series) {
    assert.equal(series.latest_published_period, expectedLatestPeriods.get(series.indicator_id));
    assert.deepEqual(series.geographies.map((item) => item.geography), ["IT", "FR", "DE", "ES"]);
    for (const geography of series.geographies) {
      assert.ok(geography.points.length > 0);
      assert.deepEqual(geography.points.map((point) => point.period_start), geography.points.map((point) => point.period_start).toSorted());
      for (const point of geography.points) {
        assert.ok(["observed", "provisional", "estimated"].includes(point.status));
        assert.equal(Number.isFinite(point.value), true);
        assert.match(point.source_url, /^https:\/\//);
        assert.match(point.raw_sha256, /^[0-9a-f]{64}$/);
      }
    }
  }
});

test("display-only 2026 series do not replace the AMECO score contract", () => {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const displayOnly = new Map(snapshot.series.map((series) => [series.indicator_id, series.usage]));
  assert.equal(displayOnly.get("real_compensation"), "score_and_context");
  for (const indicator of ["unemployment", "real_gdp_per_capita", "debt_ratio", "primary_balance", "investment_share"]) {
    assert.equal(displayOnly.get(indicator), "context_only");
  }
  assert.equal(core.sources.ameco.observedThrough, 2024);
});

test("debt per inhabitant is derived only from same-year Eurostat debt and population", () => {
  const debt = getGovernmentScorecardV6SupplementalSnapshot().series.find((series) => series.indicator_id === "debt_per_capita");
  assert.ok(debt);
  for (const geography of debt.geographies) {
    for (const point of geography.points) {
      assert.equal(point.derivation.debt_year, point.year);
      assert.equal(point.derivation.population_year, point.year);
      assert.equal(point.value, Math.round((point.derivation.debt_stock_mio_eur * 1000 / point.derivation.population_thousand) * 100) / 100);
      assert.deepEqual(point.component_sources.map((source) => source.dataset_code), ["gov_10dd_edpt1", "nama_10_pe"]);
    }
  }
});

test("primary balance is derived from Eurostat net lending plus interest payable", () => {
  const primary = getGovernmentScorecardV6SupplementalSnapshot().series.find((series) => series.indicator_id === "primary_balance");
  assert.ok(primary);
  for (const geography of primary.geographies) {
    for (const point of geography.points) {
      assert.equal(point.derivation.formula, "net_lending_percent_gdp + interest_payable_percent_gdp");
      assert.equal(point.value, Math.round((point.derivation.net_lending_percent_gdp + point.derivation.interest_payable_percent_gdp) * 10_000) / 10_000);
      assert.deepEqual(point.component_sources.map((source) => source.dataset_code), ["gov_10q_ggnfa"]);
    }
  }
});

test("both runtime contracts fail closed on score or evidence corruption", () => {
  const scoreInput = structuredClone(buildGovernmentScorecardV6Input("draghi-i"));
  scoreInput.observations[0].end.observed_or_forecast = "forecast";
  assert.throws(() => parseGovernmentScorecardV6Input(scoreInput));

  const invalidTracer = structuredClone(buildGovernmentScorecardV6Input("meloni-i"));
  invalidTracer.snapshot_version = "meloni-v6-tracer-1";
  assert.throws(() => parseGovernmentScorecardV6Input(invalidTracer));

  const pageSnapshot = structuredClone(getGovernmentScorecardV6SupplementalSnapshot());
  pageSnapshot.contexts[0].slides.find((slide) => slide.status === "ready").items[0].summary += " altered";
  assert.throws(() => parseGovernmentScorecardV6SupplementalSnapshot(pageSnapshot));

  assert.equal(getGovernmentScorecardV6SupplementalSnapshot().contexts.length, GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.length);
});
