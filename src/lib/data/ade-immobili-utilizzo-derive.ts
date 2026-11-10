import "server-only";

import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";
import { ADE_IMMOBILI_OPEN_DATA_ZIP } from "@/lib/ade-immobili-italia-2026";

/** Use categories published for abitazioni · numero immobili (Totale / provincia). */
export const HOUSING_USE_ORDER = [
  {
    match: "ABITAZIONI PRINCIPALI (IN TUTTO O IN PARTE) · Numero immobili totale",
    label: "Abitazione principale",
    hint: "Residenza dichiarata (in tutto o in parte)",
  },
  {
    match: "IMMOBILI A DISPOSIZIONE · Numero immobili totale",
    label: "A disposizione",
    hint: "Seconde case, vuoti o non locati",
  },
  {
    match: "IMMOBILI LOCATI · Numero immobili totale",
    label: "Locati",
    hint: "Affittati a terzi",
  },
  {
    match: "USO GRATUITO · Numero immobili totale",
    label: "Uso gratuito",
    hint: "Concessi senza canone",
  },
  {
    match: "ALTRI UTILIZZI · Numero immobili totale",
    label: "Altri utilizzi",
    hint: "Residuo classificato da AdE",
  },
  {
    match: "UNITA NON RISCONTRATE IN DICH. DEI REDDITI · Numero immobili totale",
    label: "Fuori dichiarazione redditi",
    hint: "Unità non ritrovate nelle dichiarazioni",
  },
  {
    match: "UTILIZZO NON RICOSTRUITO · Numero immobili totale",
    label: "Utilizzo non ricostruito",
    hint: "AdE non ha ricostruito l’uso",
  },
] as const;

const TOTAL_INDICATOR = "TOTALE PF + PNF · Numero immobili totale";

export type HousingUseShare = {
  label: string;
  hint: string;
  count: number;
  shareOfTotal: number | null;
};

export type HousingTerritoryInsight = {
  territory: string;
  territoryLabel: string;
  taxYear: 2023;
  totalHomes: number | null;
  uses: HousingUseShare[];
  sourceUrl: string;
};

function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

function buildInsight(
  territory: string,
  territoryLabel: string,
  rows: Array<{ indicatore: string; valore: string; sourceUrl: string }>,
): HousingTerritoryInsight {
  const totalHomes = parseCount(rows.find((row) => row.indicatore === TOTAL_INDICATOR)?.valore ?? "");
  const sourceUrl = rows[0]?.sourceUrl ?? ADE_IMMOBILI_OPEN_DATA_ZIP;
  const uses: HousingUseShare[] = [];
  for (const use of HOUSING_USE_ORDER) {
    const count = parseCount(rows.find((row) => row.indicatore === use.match)?.valore ?? "");
    if (count === null) continue;
    uses.push({
      label: use.label,
      hint: use.hint,
      count,
      shareOfTotal: totalHomes && totalHomes > 0 ? count / totalHomes : null,
    });
  }
  return { territory, territoryLabel, taxYear: 2023, totalHomes, uses, sourceUrl };
}

export function buildAdeImmobiliHousingInsights(rows: readonly IntegratedPublicRow[]) {
  if (rows.length !== 16_632) throw new Error("Dataset utilizzo AdE incompleto per gli insight.");

  const housing: Array<{ provincia: string; indicatore: string; valore: string; sourceUrl: string }> = [];
  for (const row of rows) {
    const provincia = row.cells["Provincia (sigla)"];
    const categoria = row.cells["Categoria utilizzo"];
    const indicatore = row.cells.Indicatore;
    const valore = row.cells.Valore;
    if (typeof provincia !== "string" || typeof categoria !== "string" || typeof indicatore !== "string" || typeof valore !== "string") {
      throw new Error("Cella utilizzo AdE non stringa.");
    }
    if (categoria !== "abitazioni") continue;
    if (!indicatore.includes("Numero immobili totale")) continue;
    housing.push({
      provincia,
      indicatore,
      valore,
      sourceUrl: ADE_IMMOBILI_OPEN_DATA_ZIP,
    });
  }

  const nationalRows = housing.filter((row) => row.provincia === "Totale");
  const national = buildInsight("Totale", "Italia", nationalRows);
  if (!national.totalHomes || national.uses.length < 4) {
    throw new Error("Totale nazionale abitazioni AdE incompleto.");
  }

  const provinces = [...new Set(housing.map((row) => row.provincia).filter((code) => code !== "Totale"))].sort();
  const byProvince = Object.fromEntries(provinces.map((code) => [
    code,
    buildInsight(code, `Provincia ${code}`, housing.filter((row) => row.provincia === code)),
  ]));
  return { national, byProvince, provinces };
}
