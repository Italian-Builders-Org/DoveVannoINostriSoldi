/** Contract for OpenBDAP Difesa mission × macroaggregate CP A1 snapshot.
 * No generated artifact import — safe for ETL bootstrap and --check. */

import sourceLock from "../../scripts/etl/specs/openbdap-defence-budget-macroaggregates.source.json";

export const DEFENCE_MISSION = "Difesa e sicurezza del territorio" as const;
export const INVESTMENT_MACROAGGREGATE = "INVESTIMENTI" as const;

export type DefenceBudgetMacroRow = {
  year: number;
  macroaggregate: string;
  amountEur: number;
};

export type DefenceBudgetMacroaggregatesArtifact = {
  schemaVersion: 1;
  datasetId: string;
  mission: string;
  measure: string;
  unit: "euro";
  years: number[];
  macroaggregates: string[];
  investmentMacroaggregate: string;
  rows: DefenceBudgetMacroRow[];
  source: {
    owner: string;
    platform: string;
    packageId: string;
    resourceId: string;
    productCode: string;
    title: string;
    catalogUrl: string;
    csvUrl: string;
    landingUrl: string;
    license: string;
    licenseId: string;
    licenseUrl: string;
    observedAt: string;
    csvSha256: string;
  };
  caveats: string[];
};

type SourceLock = typeof sourceLock;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateDefenceBudgetMacroaggregatesArtifact(
  artifact: unknown,
  lock: SourceLock = sourceLock,
): DefenceBudgetMacroaggregatesArtifact {
  assert(artifact && typeof artifact === "object", "Snapshot macroaggregati Difesa assente");
  const value = artifact as DefenceBudgetMacroaggregatesArtifact;
  assert(value.schemaVersion === 1, "schemaVersion macroaggregati Difesa");
  assert(value.datasetId === lock.datasetId, "datasetId macroaggregati Difesa");
  assert(value.mission === lock.mission, "missione macroaggregati Difesa");
  assert(value.measure === lock.transformation.measure, "misura CP A1");
  assert(value.unit === "euro", "unità euro");
  assert(value.investmentMacroaggregate === lock.transformation.investmentMacroaggregate, "etichetta INVESTIMENTI");
  assert(
    Array.isArray(value.years) && value.years.join() === lock.transformation.years.join(),
    "anni macroaggregati Difesa",
  );
  assert(
    Array.isArray(value.macroaggregates)
      && value.macroaggregates.join() === lock.transformation.macroaggregates.join(),
    "elenco macroaggregati",
  );
  assert(Array.isArray(value.rows) && value.rows.length === lock.transformation.cells, "celle macroaggregati");
  assert(Array.isArray(value.caveats) && value.caveats.length >= 3, "caveat macroaggregati");
  assert(value.source?.csvSha256 === `sha256:${lock.source.csv.sha256}`, "hash CSV macroaggregati");
  assert(value.source?.packageId === lock.source.packageId, "packageId macroaggregati");
  assert(value.source?.licenseId === "cc-by", "licenza CC BY");
  assert(
    typeof value.source?.observedAt === "string"
      && !Number.isNaN(Date.parse(value.source.observedAt))
      && new Date(value.source.observedAt).toISOString() === value.source.observedAt,
    "observedAt ISO UTC",
  );

  const byYearMacro = new Map<string, number>();
  for (const row of value.rows) {
    assert(Number.isInteger(row.year) && lock.transformation.years.includes(row.year), `anno riga ${row.year}`);
    assert(lock.transformation.macroaggregates.includes(row.macroaggregate), `macro ${row.macroaggregate}`);
    assert(Number.isSafeInteger(row.amountEur) && row.amountEur >= 0, `importo ${row.year}/${row.macroaggregate}`);
    const key = `${row.year}::${row.macroaggregate}`;
    assert(!byYearMacro.has(key), `duplicato ${key}`);
    byYearMacro.set(key, row.amountEur);
  }

  for (const year of lock.transformation.years) {
    let total = 0;
    for (const macro of lock.transformation.macroaggregates) {
      const amount = byYearMacro.get(`${year}::${macro}`);
      assert(amount !== undefined, `manca ${year}/${macro}`);
      total += amount;
    }
    const yearKey = String(year) as keyof typeof lock.expectedMissionTotalsEur;
    assert(total === lock.expectedMissionTotalsEur[yearKey], `totale missione ${year}`);
    assert(
      byYearMacro.get(`${year}::${lock.transformation.investmentMacroaggregate}`)
        === lock.expectedInvestmentEur[yearKey],
      `INVESTIMENTI ${year}`,
    );
  }

  return value;
}
