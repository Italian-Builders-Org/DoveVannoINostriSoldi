import "server-only";

import rawCrosswalk from "@/data/generated/istat-sardegna-codici-2026.json";

/**
 * Official ISTAT aliases of a municipal code.
 *
 * From 1 January 2026 ISTAT recoded every Sardinian Comune. SITUAS 2026 and
 * IPA publish the new code, while sources released earlier (MEF IRPEF, MIM,
 * ReGiS) keep the previous one. The table comes from the ISTAT file locked in
 * scripts/etl/specs/istat-sardegna-codici-2026.source.json and reconciled
 * offline with SITUAS 2025/2026 by scripts/etl/istat_sardegna_codici_2026.py.
 */

type Row = readonly [code: string, previousCode: string, name: string, provinceCode: string, previousProvinceCode: string];

type Crosswalk = Readonly<{
  schemaVersion: number;
  datasetId: string;
  source: typeof rawCrosswalk.source;
  columns: readonly string[];
  rows: readonly Row[];
}>;

const EXPECTED_COLUMNS = ["code", "previousCode", "name", "provinceCode", "previousProvinceCode"] as const;
const MUNICIPALITY_CODE = /^\d{6}$/;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Tabella ISTAT dei codici sardi non valida: ${message}`);
}

const crosswalk = rawCrosswalk as unknown as Crosswalk;

invariant(crosswalk.schemaVersion === 1, "schemaVersion inattesa");
invariant(crosswalk.datasetId === "istat-sardegna-codici-2026", "dataset inatteso");
invariant(crosswalk.source.url.startsWith("https://www.istat.it/"), "fonte non ufficiale");
invariant(/^[0-9a-f]{64}$/.test(crosswalk.source.sha256), "hash della fonte non valido");
invariant(crosswalk.source.effectiveFrom === "2026-01-01", "decorrenza inattesa");
invariant(
  crosswalk.columns.length === EXPECTED_COLUMNS.length &&
    crosswalk.columns.every((column, index) => column === EXPECTED_COLUMNS[index]),
  "colonne inattese",
);
invariant(crosswalk.rows.length > 0, "nessuna riga");

/** Every code of a recoded Comune maps to [current, previous]. */
const aliasesByCode = new Map<string, readonly [string, string]>();
for (const row of crosswalk.rows) {
  const [code, previousCode] = row;
  invariant(row.length === EXPECTED_COLUMNS.length, `riga ${code}`);
  invariant(MUNICIPALITY_CODE.test(code) && MUNICIPALITY_CODE.test(previousCode), `codice ${code}/${previousCode}`);
  // A code shared by two rows would name two Comuni: the alias would be ambiguous.
  invariant(!aliasesByCode.has(code) && !aliasesByCode.has(previousCode), `codice ripetuto ${code}/${previousCode}`);
  const aliases = Object.freeze([code, previousCode] as const);
  aliasesByCode.set(code, aliases);
  aliasesByCode.set(previousCode, aliases);
}

export const istatMunicipalityCodeAliasesSource = crosswalk.source;

/**
 * Return every official ISTAT code of the same Comune, current code first.
 * Codes not involved in a recoding return themselves; malformed input returns
 * an empty list so callers cannot join on it.
 */
export function istatMunicipalityCodeAliases(code: string): readonly string[] {
  const normalized = code.trim();
  if (!MUNICIPALITY_CODE.test(normalized)) return [];
  return aliasesByCode.get(normalized) ?? [normalized];
}

/** Current (2026) ISTAT code for any official alias, or null for malformed input. */
export function currentIstatMunicipalityCode(code: string): string | null {
  return istatMunicipalityCodeAliases(code)[0] ?? null;
}
