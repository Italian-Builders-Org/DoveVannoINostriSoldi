import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const {
  calculateGovernmentScorecardV6,
  calculatePeerScoreV6,
} = await import("../src/lib/government-scorecard.ts");
const {
  buildGovernmentScorecardV6Input,
  getGovernmentScorecardV6Assessment,
  GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS,
} = await import("../src/lib/government-scorecard-governments.ts");
const {
  getGovernmentScorecardV6CoupledAudit,
  getGovernmentScorecardV6Sensitivity,
} = await import("../src/lib/government-scorecard-sensitivity.ts");

const EXPECTED = {
  "dini-i": ["not_scored_data", null],
  "prodi-i": ["scored_final", 46.88470786684212],
  "dalema-i": ["scored_final", 34.723735063111015],
  "dalema-ii": ["not_scored_short", null],
  "amato-ii": ["scored_final", 43.26750593796899],
  "berlusconi-ii": ["scored_final", 60.11606972233079],
  "berlusconi-iii": ["scored_final", 47.58423629067717],
  "prodi-ii": ["scored_final", 43.36233105982603],
  "berlusconi-iv": ["scored_final", 29.149136511178632],
  "monti-i": ["scored_final", 13.995586208506166],
  "letta-i": ["not_scored_short", null],
  "renzi-i": ["scored_final", 35.056474459947566],
  "gentiloni-i": ["scored_final", 32.93392583381037],
  "conte-i": ["scored_final", 40.01717159931412],
  "conte-ii": ["scored_final", 36.60652386528869],
  "draghi-i": ["scored_final", 76.22399483691306],
  "meloni-i": ["scored_provisional", 61.516307107906734],
};

test("all governments use the same duration, data and forecast gates", () => {
  assert.deepEqual(GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS, Object.keys(EXPECTED));
  for (const id of GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS) {
    const assessment = getGovernmentScorecardV6Assessment(id);
    assert.equal(assessment.score_state, EXPECTED[id][0], id);
    assert.equal(assessment.gate.minimum_duration_days, 365);
    assert.equal(assessment.gate.forecast_free, true);
    assert.equal(assessment.gate.comparable, true);
    assert.equal(assessment.window.observed_through, 2024);
  }
  assert.equal(getGovernmentScorecardV6Assessment("dalema-ii").gate.duration_days, 126);
  assert.equal(getGovernmentScorecardV6Assessment("letta-i").gate.duration_days, 300);
  assert.match(getGovernmentScorecardV6Assessment("dini-i").reason, /1994/);
});

test("the frozen reference scores and all five equal-weight pillars reconcile exactly", () => {
  for (const [id, [state, expectedScore]] of Object.entries(EXPECTED)) {
    if (!state.startsWith("scored_")) continue;
    const input = buildGovernmentScorecardV6Input(id);
    const result = calculateGovernmentScorecardV6(input);
    assert.ok(Math.abs(result.score_raw - expectedScore) < 1e-10, id);
    assert.equal(result.pillars.length, 5);
    assert.equal(result.pillars.reduce((total, pillar) => total + pillar.weight_basis_points, 0), 10_000);
    assert.ok(Math.abs(result.pillars.reduce(
      (total, pillar) => total + pillar.score_raw * (pillar.weight_basis_points / 10_000),
      0,
    ) - result.score_raw) < 1e-10);
    assert.ok(input.observations.every((observation) => observation.end.observed_or_forecast === "observed"));
  }
});

test("the score is neutral at equal change and bounded for extreme gaps", () => {
  assert.equal(calculatePeerScoreV6(0, 1), 50);
  assert.ok(calculatePeerScoreV6(1e9, 1) <= 100);
  assert.ok(calculatePeerScoreV6(-1e9, 1) >= 0);
  assert.throws(() => calculatePeerScoreV6(1, 0));
});

test("sensitivity diagnostics preserve the published score and report incomplete axes", () => {
  for (const id of ["berlusconi-ii", "draghi-i", "meloni-i"]) {
    const base = calculateGovernmentScorecardV6(buildGovernmentScorecardV6Input(id));
    const sensitivity = getGovernmentScorecardV6Sensitivity(id);
    assert.ok(Math.abs(sensitivity.base_score - base.score_raw) < 1e-10, id);
    assert.equal(sensitivity.method_audit.configurations_evaluated, 29_160);
    assert.equal(sensitivity.method_audit.base_reconciled, true);
    assert.ok(sensitivity.operational_min <= base.score_raw && base.score_raw <= sensitivity.operational_max);
    assert.equal(sensitivity.sensitivity_complete, false);
    assert.ok(sensitivity.sensitivity_badges.includes("Stress parziale"));
  }
});

test("the coupled stress audit covers its preregistered grid without changing scores", () => {
  const audit = getGovernmentScorecardV6CoupledAudit();
  assert.equal(audit.government_count, 13);
  assert.equal(audit.configurations_evaluated, 233_280);
  assert.equal(audit.government_scores_evaluated, 3_032_640);
  assert.equal(audit.base_reconciled, true);
  assert.deepEqual(audit.failures, []);
  assert.equal(audit.complete, true);
});
