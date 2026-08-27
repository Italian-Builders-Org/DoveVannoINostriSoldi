import {
  decodePublicDataText,
  parseDelimitedRecords,
  type DelimitedRecord,
} from "@/lib/data/delimited";
import { fetchOfficialSource } from "@/lib/data/source-fetch";
import { parseOpenBdapAmount } from "@/lib/data/bdap-payment-contract";

const BDAP_BASE = "https://bdap-opendata.rgs.mef.gov.it";
const BDAP_ACTION = `${BDAP_BASE}/SpodCkanApi/api/3/action`;
const BDAP_DUMP = `${BDAP_BASE}/SpodCkanApi/api/3/datastore/dump`;

/** RGS product code for "Legge di Bilancio Pubblicata - Serie storica - Spese per
 * Amministrazione Missione Programma Macroaggregato". Verified live against
 * package_search: this product publishes one CKAN package with the full
 * historical series in a single resource, unlike the Rendiconto payment
 * products (bdap-payments.ts) which publish one package per year. */
const PRODUCT_CODE = "LBF_SPE_CRU_AMPMA_001";
const EXPECTED_TITLE =
  "Legge di Bilancio Pubblicata - Serie storica - Spese per Amministrazione Missione Programma Macroaggregato";

/**
 * The RGS mission taxonomy was reworded in 2017 (e.g. "Diritti sociali
 * politiche sociali e famiglia" became "Diritti sociali, politiche sociali e
 * famiglia"): verified live, every one of the 34 missions has exactly one
 * stable label for every year from 2017 onward, but several have a second,
 * differently-punctuated label for 2008-2016. Comparing across the rename
 * would silently treat two distinct strings as a continuous series, so the
 * adapter only ever serves years from this floor.
 */
export const MIN_STABLE_MISSION_YEAR = 2017;

export const DEFAULT_BUDGET_LAW_WINDOW_YEARS = 6;
const MIN_BUDGET_LAW_WINDOW_YEARS = 2;
const MAX_BUDGET_LAW_WINDOW_YEARS = 20;

/** Column holding the enacted competenza (accrual) appropriation for the
 * budget year itself, as published by that year's Legge di Bilancio — the
 * first of the three rolling years the law also forecasts (A2, A3). This is
 * what "stanziamento pubblicato" means throughout this module. */
const ENACTED_AMOUNT_FIELD = "Legge di Bilancio CP A1";

export type CkanPackage = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  notes?: unknown;
  metadata_modified?: unknown;
  license_title?: unknown;
};

type PackageSearchResponse = {
  success?: boolean;
  result?: {
    results?: CkanPackage[];
  };
};

export type BudgetLawMissionDataset = {
  packageId: string;
  name: string;
  title: string;
  notes: string;
  metadataModified: string | null;
  license: string | null;
  csvUrl: string;
  apiUrl: string;
};

export type MissionEnactedAllocation = {
  year: number;
  mission: string;
  /** Sum of "Legge di Bilancio CP A1" across every amministrazione and
   * macroaggregato reporting under this mission in this year. Euro, not cents. */
  amountEur: number;
};

export type MissionYearOverYearDelta = {
  mission: string;
  fromYear: number;
  toYear: number;
  fromAmountEur: number;
  toAmountEur: number;
  deltaEur: number;
  /** null when fromAmountEur is 0: a percentage change from zero is undefined. */
  deltaPct: number | null;
};

export type BudgetLawMissionSeries = {
  dataset: BudgetLawMissionDataset;
  minStableMissionYear: number;
  /** Years actually served, ascending; a subset of the requested window when
   * OpenBDAP has not yet published that many stable years. */
  years: number[];
  /** Mission labels present in every one of `years` — a mission published for
   * some but not all served years is left out rather than shown with a false zero. */
  missions: string[];
  /** One entry per (year, mission) pair, covering `years` × `missions`. */
  allocations: MissionEnactedAllocation[];
  /** Consecutive-year deltas for each mission in `missions`. */
  yearOverYearDeltas: MissionYearOverYearDelta[];
  observedAt: string;
};

export class BudgetLawDatasetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetLawDatasetUnavailableError";
  }
}

export class BudgetLawWindowUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetLawWindowUnavailableError";
  }
}

export class BudgetLawInvalidWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetLawInvalidWindowError";
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function uuid(value: unknown): string | null {
  const candidate = text(value);
  if (
    !candidate ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function required(record: DelimitedRecord, key: string): string {
  const value = record[key]?.trim();
  if (!value) throw new Error(`OpenBDAP: campo obbligatorio mancante: ${key}`);
  return value;
}

/**
 * Validates one CKAN package against the exact product-code + title contract
 * for this dataset. Exported so the guard can be unit tested against
 * synthetic packages without depending on the live catalog.
 */
export function normalizeBudgetLawPackage(pkg: CkanPackage): BudgetLawMissionDataset | null {
  const packageId = uuid(pkg.id);
  const name = text(pkg.name);
  const title = text(pkg.title);
  const notes = text(pkg.notes);
  if (!packageId || !name || !title || !notes) return null;
  if (title !== EXPECTED_TITLE) return null;

  const escapedCode = PRODUCT_CODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if ((notes.match(new RegExp(`\\[${escapedCode}\\]`, "g"))?.length ?? 0) !== 1) {
    return null;
  }

  return {
    packageId,
    name,
    title,
    notes,
    metadataModified: text(pkg.metadata_modified),
    license: text(pkg.license_title),
    csvUrl: `${BDAP_DUMP}/${packageId}.csv`,
    apiUrl: `${BDAP_ACTION}/package_show?id=${encodeURIComponent(packageId)}`,
  };
}

export async function discoverBudgetLawMissionDataset(
  signal?: AbortSignal,
): Promise<BudgetLawMissionDataset> {
  const url = `${BDAP_ACTION}/package_search?${new URLSearchParams({
    q: PRODUCT_CODE,
    rows: "20",
  }).toString()}`;
  const response = await fetchOfficialSource("openbdap", url, {
    kind: "discovery",
    signal,
    headers: { Accept: "application/json" },
    tags: [`product:${PRODUCT_CODE}`],
  });

  if (!response.ok) {
    throw new Error(`OpenBDAP package_search HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PackageSearchResponse;
  if (!payload.success || !Array.isArray(payload.result?.results)) {
    throw new Error("Risposta package_search OpenBDAP non valida");
  }

  const matches = payload.result.results
    .map((pkg) => normalizeBudgetLawPackage(pkg))
    .filter((dataset): dataset is BudgetLawMissionDataset => dataset !== null);

  if (matches.length === 0) {
    throw new BudgetLawDatasetUnavailableError(
      "OpenBDAP non pubblica più il dataset Legge di Bilancio per Amministrazione, Missione, Programma e Macroaggregato con questo codice prodotto.",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      "OpenBDAP ha restituito più pacchetti per il prodotto Legge di Bilancio AMPMA: serve un identificativo univoco.",
    );
  }
  return matches[0];
}

async function fetchDatasetRows(
  dataset: BudgetLawMissionDataset,
  signal?: AbortSignal,
): Promise<DelimitedRecord[]> {
  const response = await fetchOfficialSource("openbdap", dataset.csvUrl, {
    kind: "data",
    signal,
    headers: { Accept: "text/csv" },
    tags: [`dataset:${dataset.packageId}`, "product:legge-bilancio-ampma"],
  });

  if (!response.ok) {
    throw new Error(`OpenBDAP CSV HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("csv")) {
    throw new Error("OpenBDAP non ha restituito un CSV per il dataset Legge di Bilancio");
  }

  const rows = parseDelimitedRecords(decodePublicDataText(await response.arrayBuffer()));
  if (rows.length === 0) throw new Error("Dataset OpenBDAP Legge di Bilancio vuoto");
  return rows;
}

type RawAllocationRow = {
  year: number;
  mission: string;
  amountEur: number;
};

/**
 * Parses one CSV record, or returns null for rows outside this module's
 * scope: pre-2008 rows never had a Missione classification at all (the
 * mission-program budget structure was introduced in 2008), and those are
 * not the same absence as a zero appropriation.
 */
function parseAllocationRow(record: DelimitedRecord): RawAllocationRow | null {
  const yearRaw = record["Esercizio Finanziario"]?.trim();
  const mission = record["Missione"]?.trim();
  if (!yearRaw || !mission) return null;

  const year = Number.parseInt(yearRaw, 10);
  if (!Number.isInteger(year) || !/^\d{4}$/.test(yearRaw)) {
    throw new Error(`OpenBDAP: anno non valido nel campo Esercizio Finanziario: ${yearRaw}`);
  }
  required(record, "Amministrazione");
  const amountEur = parseOpenBdapAmount(record[ENACTED_AMOUNT_FIELD], ENACTED_AMOUNT_FIELD);

  return { year, mission, amountEur };
}

/**
 * Computes the descriptive year-over-year change for one mission between two
 * of its enacted allocations. Pure and exported so the arithmetic (including
 * the zero-base guard) can be unit tested without a live fetch.
 */
export function missionYearOverYearDelta(
  from: MissionEnactedAllocation,
  to: MissionEnactedAllocation,
): MissionYearOverYearDelta {
  if (from.mission !== to.mission) {
    throw new Error("Il delta anno su anno richiede due stanziamenti della stessa missione");
  }
  const deltaEur = to.amountEur - from.amountEur;
  return {
    mission: from.mission,
    fromYear: from.year,
    toYear: to.year,
    fromAmountEur: from.amountEur,
    toAmountEur: to.amountEur,
    deltaEur,
    deltaPct: from.amountEur !== 0 ? (deltaEur / from.amountEur) * 100 : null,
  };
}

/**
 * Reads the full OpenBDAP AMPMA historical series once, aggregates the
 * enacted competenza appropriation (CP A1) per year and mission across every
 * amministrazione and macroaggregato, and returns the most recent stable
 * window plus its consecutive year-over-year deltas per mission.
 *
 * "Enacted appropriation" is not "actual payment": this reads what each
 * Legge di Bilancio set aside, not what OpenBDAP's Rendiconto consuntivo
 * later recorded as paid (bdap-payments.ts / /stato/legislature).
 */
export async function getBudgetLawMissionSeries(
  options: { windowYears?: number; signal?: AbortSignal } = {},
): Promise<BudgetLawMissionSeries> {
  const requestedWindow = options.windowYears ?? DEFAULT_BUDGET_LAW_WINDOW_YEARS;
  if (
    !Number.isInteger(requestedWindow) ||
    requestedWindow < MIN_BUDGET_LAW_WINDOW_YEARS ||
    requestedWindow > MAX_BUDGET_LAW_WINDOW_YEARS
  ) {
    throw new BudgetLawInvalidWindowError(
      `Finestra di anni non valida per la Legge di Bilancio: deve essere tra ${MIN_BUDGET_LAW_WINDOW_YEARS} e ${MAX_BUDGET_LAW_WINDOW_YEARS}`,
    );
  }

  const dataset = await discoverBudgetLawMissionDataset(options.signal);
  const records = await fetchDatasetRows(dataset, options.signal);

  const totalsByYearMission = new Map<string, number>();
  const missionsByYear = new Map<number, Set<string>>();

  for (const record of records) {
    const row = parseAllocationRow(record);
    if (!row || row.year < MIN_STABLE_MISSION_YEAR) continue;

    const key = `${row.year}::${row.mission}`;
    totalsByYearMission.set(key, (totalsByYearMission.get(key) ?? 0) + row.amountEur);

    const missionsForYear = missionsByYear.get(row.year) ?? new Set<string>();
    missionsForYear.add(row.mission);
    missionsByYear.set(row.year, missionsForYear);
  }

  const availableYears = [...missionsByYear.keys()].sort((left, right) => left - right);
  if (availableYears.length < MIN_BUDGET_LAW_WINDOW_YEARS) {
    throw new BudgetLawWindowUnavailableError(
      `OpenBDAP non pubblica ancora almeno ${MIN_BUDGET_LAW_WINDOW_YEARS} Leggi di Bilancio confrontabili dal ${MIN_STABLE_MISSION_YEAR} in poi.`,
    );
  }

  const years = availableYears.slice(-Math.min(requestedWindow, availableYears.length));
  const firstYearMissions = missionsByYear.get(years[0]) ?? new Set<string>();
  const missions = [...firstYearMissions]
    .filter((mission) => years.every((year) => missionsByYear.get(year)?.has(mission)))
    .sort((left, right) => left.localeCompare(right, "it-IT"));

  const amountFor = (year: number, mission: string): number =>
    totalsByYearMission.get(`${year}::${mission}`) ?? 0;

  const allocations: MissionEnactedAllocation[] = [];
  for (const year of years) {
    for (const mission of missions) {
      allocations.push({ year, mission, amountEur: amountFor(year, mission) });
    }
  }

  const yearOverYearDeltas: MissionYearOverYearDelta[] = [];
  for (const mission of missions) {
    for (let index = 1; index < years.length; index += 1) {
      const fromYear = years[index - 1];
      const toYear = years[index];
      yearOverYearDeltas.push(
        missionYearOverYearDelta(
          { year: fromYear, mission, amountEur: amountFor(fromYear, mission) },
          { year: toYear, mission, amountEur: amountFor(toYear, mission) },
        ),
      );
    }
  }

  return {
    dataset,
    minStableMissionYear: MIN_STABLE_MISSION_YEAR,
    years,
    missions,
    allocations,
    yearOverYearDeltas,
    observedAt: new Date().toISOString(),
  };
}
