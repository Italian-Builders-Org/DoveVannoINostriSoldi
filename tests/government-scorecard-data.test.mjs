import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const corePath = new URL("../src/data/generated/government-scorecard.json", import.meta.url);
const registryPath = new URL("../scripts/ci/generated-artifacts.json", import.meta.url);
const core = JSON.parse(readFileSync(corePath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
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

test("page data are observed, sourced and cryptographically tied to the score artifact", () => {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const coreHash = createHash("sha256").update(readFileSync(corePath)).digest("hex");
  assert.deepEqual(GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS, EXPECTED_INDICATORS);
  assert.equal(snapshot.score_contract.supplemental_score_impact, "none");
  assert.equal(snapshot.score_contract.core_artifact_sha256, coreHash);
  assert.deepEqual(snapshot.series.map((series) => series.indicator_id), EXPECTED_INDICATORS);
  for (const series of snapshot.series) {
    assert.deepEqual(series.geographies.map((item) => item.geography), ["IT", "FR", "DE", "ES"]);
    for (const geography of series.geographies) {
      assert.ok(geography.points.length > 0);
      assert.deepEqual(geography.points.map((point) => point.period_start), geography.points.map((point) => point.period_start).toSorted());
      for (const point of geography.points) {
        assert.equal(point.status, "observed");
        assert.equal(Number.isFinite(point.value), true);
        assert.match(point.source_url, /^https:\/\//);
        assert.match(point.raw_sha256, /^[0-9a-f]{64}$/);
      }
    }
  }
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

test("both runtime contracts fail closed on score or evidence corruption", () => {
  const scoreInput = structuredClone(buildGovernmentScorecardV6Input("draghi-i"));
  scoreInput.observations[0].end.observed_or_forecast = "forecast";
  assert.throws(() => parseGovernmentScorecardV6Input(scoreInput));

  const legacyTracer = structuredClone(buildGovernmentScorecardV6Input("meloni-i"));
  legacyTracer.snapshot_version = "meloni-v6-tracer-1";
  assert.throws(() => parseGovernmentScorecardV6Input(legacyTracer));

  const pageSnapshot = structuredClone(getGovernmentScorecardV6SupplementalSnapshot());
  pageSnapshot.contexts[0].slides.find((slide) => slide.status === "ready").items[0].summary += " altered";
  assert.throws(() => parseGovernmentScorecardV6SupplementalSnapshot(pageSnapshot));

  assert.equal(getGovernmentScorecardV6SupplementalSnapshot().contexts.length, GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.length);
});
