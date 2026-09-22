import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const artifact = JSON.parse(
  readFileSync("src/data/generated/openbdap-defence-budget-macroaggregates.json", "utf8"),
);
const lock = JSON.parse(
  readFileSync("scripts/etl/specs/openbdap-defence-budget-macroaggregates.source.json", "utf8"),
);
const budgetLaw = JSON.parse(
  readFileSync("src/data/generated/openbdap-budget-law-missions.json", "utf8"),
);

const {
  validateDefenceBudgetMacroaggregatesArtifact,
  DEFENCE_MISSION,
  INVESTMENT_MACROAGGREGATE,
} = await import("../src/lib/defence-budget-macroaggregates-contract.ts");
const {
  defenceInvestmentSeries,
  defenceMacroaggregatesForYear,
  getDefenceBudgetMacroaggregates,
} = await import("../src/lib/defence-budget-macroaggregates.ts");

test("defence macroaggregates artifact passes the fail-closed contract", () => {
  const validated = validateDefenceBudgetMacroaggregatesArtifact(artifact, lock);
  assert.equal(validated.mission, DEFENCE_MISSION);
  assert.equal(validated.investmentMacroaggregate, INVESTMENT_MACROAGGREGATE);
  assert.equal(validated.rows.length, 50);
  assert.equal(validated.source.csvSha256, `sha256:${lock.source.csv.sha256}`);
});

test("defence INVESTIMENTI reconcile to the shared budget-law mission totals", () => {
  const macros = getDefenceBudgetMacroaggregates();
  assert.equal(macros.source.csvSha256, budgetLaw.source.csvSha256);
  for (const year of macros.years) {
    const mission = budgetLaw.series.allocations.find(
      (row) => row.mission === DEFENCE_MISSION && row.year === year,
    );
    assert.ok(mission, `missione ${year}`);
    const yearMacros = defenceMacroaggregatesForYear(year);
    assert.equal(yearMacros.missionTotalEur, mission.amountEur);
    assert.equal(yearMacros.missionTotalEur, lock.expectedMissionTotalsEur[String(year)]);
    const investment = yearMacros.rows.find((row) => row.macroaggregate === INVESTMENT_MACROAGGREGATE);
    assert.equal(investment.amountEur, lock.expectedInvestmentEur[String(year)]);
  }
});

test("defence investment series is complete and rises as a share of the mission", () => {
  const series = defenceInvestmentSeries();
  assert.deepEqual(series.map((row) => row.year), lock.transformation.years);
  assert.equal(series[0].amountEur, 2216352138);
  assert.equal(series.at(-1).amountEur, 9791907392);
  const firstShare = series[0].amountEur / lock.expectedMissionTotalsEur["2017"];
  const lastShare = series.at(-1).amountEur / lock.expectedMissionTotalsEur["2026"];
  assert.ok(lastShare > firstShare);
  assert.ok(lastShare > 0.3);
});

test("defence macroaggregates refuse duplicate cells and hash drift", () => {
  assert.throws(
    () => validateDefenceBudgetMacroaggregatesArtifact({
      ...artifact,
      rows: [...artifact.rows, artifact.rows[0]],
    }, lock),
    /celle|duplicato/,
  );
  assert.throws(
    () => validateDefenceBudgetMacroaggregatesArtifact({
      ...artifact,
      source: { ...artifact.source, csvSha256: "sha256:deadbeef" },
    }, lock),
    /hash/,
  );
});
