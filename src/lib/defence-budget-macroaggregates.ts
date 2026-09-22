import "server-only";

import artifactJson from "@/data/generated/openbdap-defence-budget-macroaggregates.json";
import {
  DEFENCE_MISSION,
  INVESTMENT_MACROAGGREGATE,
  validateDefenceBudgetMacroaggregatesArtifact,
  type DefenceBudgetMacroaggregatesArtifact,
  type DefenceBudgetMacroRow,
} from "@/lib/defence-budget-macroaggregates-contract";

export {
  DEFENCE_MISSION,
  INVESTMENT_MACROAGGREGATE,
  validateDefenceBudgetMacroaggregatesArtifact,
};
export type { DefenceBudgetMacroaggregatesArtifact, DefenceBudgetMacroRow };

const artifact = validateDefenceBudgetMacroaggregatesArtifact(artifactJson);

export function getDefenceBudgetMacroaggregates() {
  return artifact;
}

export function defenceInvestmentSeries() {
  return artifact.years.map((year) => {
    const row = artifact.rows.find(
      (entry) => entry.year === year && entry.macroaggregate === artifact.investmentMacroaggregate,
    );
    if (!row) throw new Error(`INVESTIMENTI mancante per ${year}`);
    return row;
  });
}

export function defenceMacroaggregatesForYear(year: number) {
  const rows = artifact.rows.filter((row) => row.year === year);
  if (rows.length !== artifact.macroaggregates.length) {
    throw new Error(`Macroaggregati incompleti per ${year}`);
  }
  const missionTotalEur = rows.reduce((sum, row) => sum + row.amountEur, 0);
  return {
    year,
    missionTotalEur,
    rows: [...rows].sort(
      (left, right) =>
        right.amountEur - left.amountEur || left.macroaggregate.localeCompare(right.macroaggregate, "it"),
    ),
  };
}
