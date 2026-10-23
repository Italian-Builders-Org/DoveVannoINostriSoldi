import "server-only";

import { z } from "zod";
import { loadAllIntegratedDatasetRows } from "@/lib/integrated-full-dataset-page";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";
import {
  ADE_IMMOBILI_TABLE_API_PREFIX,
  ADE_IMMOBILI_TABELLE_DATASET,
} from "@/lib/ade-immobili-italia-2026";

const cellSchema = z.object({
  "Tabella id": z.string().regex(/^2026_\d{2}_\d{2}_\d{2}$/),
  "Titolo tabella": z.string().min(1),
  Riga: z.string().regex(/^[1-9][0-9]*$/),
  Colonna: z.string().min(1),
  Valore: z.string(),
  "URL fonte": z.string().url(),
}).strict();

const AREA_TABLES = {
  Nord: "2026_01_03_10",
  Centro: "2026_01_03_11",
  Sud: "2026_01_03_12",
} as const;

// Full AdE PF use breakdown for Nord/Centro/Sud (shares sum ≈ 100%).
// Centro omits "-16" in the locati label; encoding of "Unità" varies in the export.
const AREA_USES = [
  { match: /^Abitazioni principali/i, label: "Abitazione principale", focus: true },
  { match: /^Pertinenze di abitazioni principali/i, label: "Pertinenze", focus: false },
  { match: /^Immobili a disposizione/i, label: "A disposizione", focus: true },
  { match: /^Immobili locati/i, label: "Locati", focus: true },
  { match: /^Uso gratuito/i, label: "Uso gratuito", focus: false },
  { match: /^Altri utilizzi/i, label: "Altri utilizzi", focus: false },
  { match: /^Utilizzo non ricostruito/i, label: "Non ricostruito", focus: false },
  // Nord/Centro: "Unita'"; Sud export has mojibake for "Unità".
  { match: /^Unit.+non riscontrate in dichiarazione/i, label: "Non in dichiarazione", focus: false },
] as const;

export type MacroAreaUse = {
  label: string;
  count: number;
  share: number;
  focus: boolean;
};

export type MacroAreaInsight = {
  area: keyof typeof AREA_TABLES;
  tableId: string;
  title: string;
  sourceUrl: string;
  uses: MacroAreaUse[];
};

export type RegionValueInsight = {
  region: string;
  residentialMld: number;
  housingMld: number;
  gdpMld: number;
  residentialOverGdp: number;
  territorialShare: number;
  sourceUrl: string;
};

export type IncomeClassInsight = {
  label: string;
  taxpayers: number;
  owners: number;
  ownershipRate: number;
  sourceUrl: string;
};

export type IncomeTypeInsight = {
  label: string;
  owners: number;
  meanIncome: number;
  meanVsm: number;
  sourceUrl: string;
};

export type AdeImmobiliTabelleInsights = {
  macroAreas: MacroAreaInsight[];
  regions: RegionValueInsight[];
  italyResidentialMld: number | null;
  italyResidentialOverGdp: number | null;
  incomeClasses: IncomeClassInsight[];
  incomeTypes: IncomeTypeInsight[];
  sources: {
    macroAreas: string[];
    regions: string;
    incomeClasses: string;
    incomeTypes: string;
  };
};

let cache: AdeImmobiliTabelleInsights | null = null;

function parseIntStrict(raw: string, label: string): number {
  const trimmed = raw.trim().replace(/\./g, "").replace(",", "");
  if (!/^\d+$/.test(trimmed)) throw new Error(`Intero AdE non valido (${label}): ${raw}`);
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) throw new Error(`Intero fuori range (${label})`);
  return value;
}

function parseFloatStrict(raw: string, label: string): number {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new Error(`Decimale AdE non valido (${label}): ${raw}`);
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Decimale non finito (${label})`);
  return value;
}

function pivotTable(rows: IntegratedPublicRow[], tableId: string) {
  const expectedUrl = `${ADE_IMMOBILI_TABLE_API_PREFIX}${tableId}&cq=1`;
  const byRow = new Map<string, Record<string, string>>();
  let title: string | null = null;
  for (const row of rows) {
    const cells = cellSchema.parse(row.cells);
    if (cells["Tabella id"] !== tableId) continue;
    if (cells["URL fonte"] !== expectedUrl) throw new Error(`URL tabella ${tableId} divergente.`);
    title = cells["Titolo tabella"];
    const bucket = byRow.get(cells.Riga) ?? {};
    if (Object.prototype.hasOwnProperty.call(bucket, cells.Colonna)) {
      // Duplicate column names exist in some AdE exports; keep the first occurrence only.
      continue;
    }
    bucket[cells.Colonna] = cells.Valore;
    byRow.set(cells.Riga, bucket);
  }
  if (!title || byRow.size === 0) throw new Error(`Tabella ${tableId} assente o vuota.`);
  const pivoted = [...byRow.entries()]
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, value]) => value);
  return { title, sourceUrl: expectedUrl, rows: pivoted };
}

function buildMacroArea(rows: IntegratedPublicRow[], area: keyof typeof AREA_TABLES): MacroAreaInsight {
  const tableId = AREA_TABLES[area];
  const pivoted = pivotTable(rows, tableId);
  const uses: MacroAreaUse[] = [];
  for (const useDef of AREA_USES) {
    const match = pivoted.rows.find((row) => useDef.match.test(row.Utilizzo ?? ""));
    if (!match?.Numero || match["Numero · Quota %"] === undefined) {
      throw new Error(`Utilizzo ${useDef.label} assente in ${tableId}`);
    }
    uses.push({
      label: useDef.label,
      count: parseIntStrict(match.Numero, `${tableId} numero`),
      share: parseFloatStrict(match["Numero · Quota %"], `${tableId} quota`),
      focus: useDef.focus,
    });
  }
  if (uses.some((use) => use.share < 0 || use.share > 1)) {
    throw new Error(`Quota macroarea fuori da [0,1] in ${tableId}`);
  }
  if (uses.length !== AREA_USES.length) {
    throw new Error(`Attesi ${AREA_USES.length} usi in ${tableId}, trovati ${uses.length}`);
  }
  const shareSum = uses.reduce((sum, use) => sum + use.share, 0);
  // AdE round percentages to 0.1 pp; Nord/Centro/Sud land within ~0.1 pp of 100%.
  if (Math.abs(shareSum - 1) > 0.005) {
    throw new Error(`Somma quote usi incoerente in ${tableId}: ${shareSum}`);
  }
  return {
    area,
    tableId,
    title: pivoted.title,
    sourceUrl: pivoted.sourceUrl,
    uses,
  };
}

function buildRegions(rows: IntegratedPublicRow[]) {
  const pivoted = pivotTable(rows, "2026_02_01_03");
  // "Quota territoriale %" is repeated three times in the AdE export (abitazioni,
  // pertinenze, residenziale). Do not trust that label: derive the share from
  // residential VSM / Italia after the national row is known.
  const parsed: Array<Omit<RegionValueInsight, "territorialShare"> & { territorialShare?: number }> = [];
  for (const row of pivoted.rows) {
    const region = row.Regione?.trim();
    if (!region) throw new Error("Regione assente in 2026_02_01_03");
    if (region.endsWith(" Totale")) continue;
    parsed.push({
      region,
      residentialMld: parseFloatStrict(row["Valore complessivo residenziale (mld euro)"] ?? "", "VSM res"),
      housingMld: parseFloatStrict(row["Valore complessivo abitazioni (mld euro)"] ?? "", "VSM abitazioni"),
      gdpMld: parseFloatStrict(row["PIL 2023 (mld euro)"] ?? "", "PIL"),
      residentialOverGdp: parseFloatStrict(row["Valore res. / PIL"] ?? "", "VSM/PIL"),
      sourceUrl: pivoted.sourceUrl,
    });
  }
  const italy = parsed.find((row) => row.region === "Italia");
  if (!italy || !(italy.residentialMld > 0)) throw new Error("Riga Italia assente in 2026_02_01_03");
  const regions: RegionValueInsight[] = parsed
    .filter((row) => row.region !== "Italia")
    .map((row) => ({
      ...row,
      territorialShare: row.residentialMld / italy.residentialMld,
    }));
  if (regions.length !== 20) throw new Error(`Attese 20 regioni, trovate ${regions.length}`);
  const shareSum = regions.reduce((sum, row) => sum + row.territorialShare, 0);
  if (Math.abs(shareSum - 1) > 0.02) {
    throw new Error(`Somma quote regionali incoerente: ${shareSum}`);
  }
  regions.sort((left, right) => right.residentialMld - left.residentialMld || left.region.localeCompare(right.region, "it"));
  return {
    regions,
    italyResidentialMld: italy.residentialMld,
    italyResidentialOverGdp: italy.residentialOverGdp,
    sourceUrl: pivoted.sourceUrl,
  };
}

function buildIncomeClasses(rows: IntegratedPublicRow[]): IncomeClassInsight[] {
  const pivoted = pivotTable(rows, "2026_03_01_02");
  const insights: IncomeClassInsight[] = [];
  for (const row of pivoted.rows) {
    const label = row["Reddito complessivo"]?.trim();
    const taxpayersRaw = row["Numero di contribuenti"];
    const ownersRaw = row["Numero di contribuenti proprietari di immobili"];
    if (!label || !taxpayersRaw || !ownersRaw) throw new Error("Classe di reddito AdE incompleta");
    const taxpayers = parseIntStrict(taxpayersRaw, "contribuenti");
    const owners = parseIntStrict(ownersRaw, "proprietari");
    if (owners > taxpayers) throw new Error(`Proprietari > contribuenti in ${label}`);
    insights.push({
      label,
      taxpayers,
      owners,
      ownershipRate: owners / taxpayers,
      sourceUrl: pivoted.sourceUrl,
    });
  }
  if (insights.length !== 5) throw new Error(`Attese 5 classi di reddito, trovate ${insights.length}`);
  return insights;
}

function buildIncomeTypes(rows: IntegratedPublicRow[]): IncomeTypeInsight[] {
  const pivoted = pivotTable(rows, "2026_03_03_01");
  const insights: IncomeTypeInsight[] = [];
  for (const row of pivoted.rows) {
    const label = row["Reddito Prevalente"]?.trim();
    if (!label) throw new Error("Reddito prevalente assente");
    insights.push({
      label,
      owners: parseIntStrict(row["Numero dei proprietari"] ?? "", "proprietari tipo"),
      meanIncome: parseFloatStrict(row["Reddito Complessivo · Media"] ?? "", "reddito medio"),
      meanVsm: parseFloatStrict(row["VSM totale · Media"] ?? "", "VSM medio"),
      sourceUrl: pivoted.sourceUrl,
    });
  }
  if (insights.length !== 4) throw new Error(`Attesi 4 tipi di reddito, trovati ${insights.length}`);
  insights.sort((left, right) => right.owners - left.owners || left.label.localeCompare(right.label, "it"));
  return insights;
}

export async function getAdeImmobiliTabelleInsights(): Promise<AdeImmobiliTabelleInsights> {
  if (cache) return cache;
  const loaded = await loadAllIntegratedDatasetRows(ADE_IMMOBILI_TABELLE_DATASET, undefined);
  if (loaded.dataset.publicRows !== 3_033 || loaded.dataset.licenseStatus !== "verified-open-cc-by-3.0-it") {
    throw new Error("Dataset tabelle AdE incompleto o licenza divergente.");
  }
  const macroAreas = (Object.keys(AREA_TABLES) as Array<keyof typeof AREA_TABLES>).map((area) =>
    buildMacroArea(loaded.rows, area)
  );
  const regionBundle = buildRegions(loaded.rows);
  const incomeClasses = buildIncomeClasses(loaded.rows);
  const incomeTypes = buildIncomeTypes(loaded.rows);
  cache = {
    macroAreas,
    regions: regionBundle.regions,
    italyResidentialMld: regionBundle.italyResidentialMld,
    italyResidentialOverGdp: regionBundle.italyResidentialOverGdp,
    incomeClasses,
    incomeTypes,
    sources: {
      macroAreas: macroAreas.map((area) => area.sourceUrl),
      regions: regionBundle.sourceUrl,
      incomeClasses: incomeClasses[0]!.sourceUrl,
      incomeTypes: incomeTypes[0]!.sourceUrl,
    },
  };
  return cache;
}
