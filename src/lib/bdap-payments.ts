import {
  decodePublicDataText,
  parseDelimitedRecords,
  type DelimitedRecord,
} from "@/lib/data/delimited";
import { fetchOfficialSource } from "@/lib/data/source-fetch";
import {
  assertOpenBdapComponentTotal,
  parseOpenBdapAmount,
} from "@/lib/data/bdap-payment-contract";
import {
  getStateAdministrationIdentity,
  type StateAdministrationIdentity,
} from "@/lib/data/state-administration-identities";

const BDAP_BASE = "https://bdap-opendata.rgs.mef.gov.it";
const BDAP_ACTION = `${BDAP_BASE}/SpodCkanApi/api/3/action`;
const BDAP_DUMP = `${BDAP_BASE}/SpodCkanApi/api/3/datastore/dump`;

export type StatePaymentDimension =
  | "mission"
  | "missionAdministration"
  | "administrationEconomic";

export type CkanPackage = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  notes?: unknown;
  metadata_modified?: unknown;
};

type PackageSearchResponse = {
  success?: boolean;
  result?: {
    count?: number;
    results?: CkanPackage[];
  };
};

export type BdapReleaseKind = "monthly" | "consuntivo";

type BdapDatasetBase = {
  dimension: StatePaymentDimension;
  productCode: string;
  packageId: string;
  name: string;
  title: string;
  notes: string;
  referenceYear: number;
  metadataModified: string | null;
  csvUrl: string;
  apiUrl: string;
};

export type MonthlyBdapDataset = BdapDatasetBase & {
  releaseKind: "monthly";
  referenceMonth: number;
};

export type ConsuntivoBdapDataset = BdapDatasetBase & {
  releaseKind: "consuntivo";
  referenceMonth: null;
};

export type BdapDataset = MonthlyBdapDataset | ConsuntivoBdapDataset;

type PaymentComponents = {
  opErario: number;
  opTesoreria: number;
  opEsterno: number;
  oaTesoreria: number;
  oaSpesaFunzDeleg: number;
  rsfStipendi: number;
  rsfAltro: number;
  noteImputazione: number;
  totalPaid: number;
};

export type StateMissionPayment = PaymentComponents & {
  year: number;
  month: string | null;
  missionCode: string;
  mission: string;
};

export type StateAdministrationMissionPayment = StateMissionPayment & {
  administrationCode: string;
  administration: string;
};

export type StateAdministrationEconomicPayment = PaymentComponents & {
  year: number;
  month: string | null;
  administrationCode: string;
  administration: string;
  categoryCode: string;
  category: string;
  economicLevel2Code: string;
  economicLevel2: string;
};

export type SpendingAggregate = {
  code: string | null;
  label: string;
  value: number;
};

export type StateAdministrationAggregate = SpendingAggregate & {
  identity: StateAdministrationIdentity | null;
};

export type StateSpendingSnapshot = {
  period: {
    year: number;
    month: number | null;
    monthName: string;
    label: string;
    releaseKind: BdapReleaseKind;
  };
  totalPaid: number;
  counts: {
    missions: number;
    administrations: number;
    economicCategories: number;
  };
  missions: SpendingAggregate[];
  administrations: StateAdministrationAggregate[];
  economicCategories: SpendingAggregate[];
  paymentMethods: SpendingAggregate[];
  availability: {
    missions: "available";
    administrations: "available" | "unavailable";
    economicCategories: "available" | "unavailable";
  };
  warnings: string[];
  consistency: {
    missionTotal: number;
    administrationTotal: number | null;
    economicTotal: number | null;
    administrationDifferencePct: number | null;
    economicDifferencePct: number | null;
  };
  sources: {
    mission: BdapDataset;
    missionAdministration: BdapDataset | null;
    administrationEconomic: BdapDataset | null;
  };
  observedAt: string;
};

export type StateAdministrationSpending = {
  period: StateSpendingSnapshot["period"];
  administration: {
    code: string;
    name: string;
    totalPaid: number;
    identity: StateAdministrationIdentity | null;
  };
  counts: {
    missions: number;
    economicCategories: number;
    economicDetails: number;
  };
  missions: SpendingAggregate[];
  economicCategories: SpendingAggregate[];
  economicDetails: SpendingAggregate[];
  paymentMethods: SpendingAggregate[];
  availability: {
    missions: "available";
    economicBreakdown: "available" | "unavailable";
  };
  warnings: string[];
  consistency: {
    missionTotal: number;
    economicTotal: number | null;
    economicDifferencePct: number | null;
  };
  sources: {
    missionAdministration: BdapDataset;
    administrationEconomic: BdapDataset | null;
  };
  observedAt: string;
};

export class StatePaymentPeriodUnavailableError extends Error {
  constructor(year: number, month: number | null) {
    super(
      month === null
        ? `OpenBDAP non contiene un rilascio disponibile per il ${year}`
        : `OpenBDAP non contiene un rilascio disponibile per ${String(month).padStart(2, "0")}/${year}`,
    );
    this.name = "StatePaymentPeriodUnavailableError";
  }
}

export class StateAdministrationNotFoundError extends Error {
  constructor(code: string, year: number, month: number | null) {
    super(
      `L'amministrazione ${code} non è presente nel rilascio OpenBDAP ${
        month === null ? `consuntivo ${year}` : `${String(month).padStart(2, "0")}/${year}`
      }`,
    );
    this.name = "StateAdministrationNotFoundError";
  }
}

const MONTH_NAMES = [
  "GENNAIO",
  "FEBBRAIO",
  "MARZO",
  "APRILE",
  "MAGGIO",
  "GIUGNO",
  "LUGLIO",
  "AGOSTO",
  "SETTEMBRE",
  "OTTOBRE",
  "NOVEMBRE",
  "DICEMBRE",
] as const;

const DIMENSION_SUFFIX: Record<StatePaymentDimension, string> = {
  mission: "MISS",
  missionAdministration: "MISAM",
  administrationEconomic: "AMCE2",
};

const DIMENSION_TITLE: Record<StatePaymentDimension, string> = {
  mission: "Pagamenti Bilancio dello Stato per Missione",
  missionAdministration: "Pagamenti Bilancio dello Stato per Missione Amministrazione",
  administrationEconomic:
    "Pagamenti Bilancio dello Stato per Amministrazione Classificazione Economica II livello",
};

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

function productCode(month: number, dimension: StatePaymentDimension): string {
  return `PBS_SPE_M${String(month).padStart(2, "0")}_${DIMENSION_SUFFIX[dimension]}_001`;
}

function consuntivoProductCode(dimension: StatePaymentDimension): string {
  return `PBS_SPE_RND_${DIMENSION_SUFFIX[dimension]}_001`;
}

function productCodeForRelease(
  dimension: StatePaymentDimension,
  releaseKind: BdapReleaseKind,
  month: number | null,
): string | null {
  if (releaseKind === "consuntivo") return consuntivoProductCode(dimension);
  return month === null ? null : productCode(month, dimension);
}

function parsePackagePeriod(
  title: string,
  dimension: StatePaymentDimension,
  releaseKind: BdapReleaseKind,
): { year: number; month: number | null } | null {
  const titlePrefix = DIMENSION_TITLE[dimension];
  if (releaseKind === "consuntivo") {
    const match = title.match(new RegExp(`^(20\\d{2}) - ${titlePrefix} Consuntivo$`));
    return match ? { year: Number.parseInt(match[1], 10), month: null } : null;
  }

  const match = title.match(new RegExp(`^(20\\d{2})/(0[1-9]|1[0-2]) - ${titlePrefix}$`));
  return match
    ? {
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10),
      }
    : null;
}

function normalizePackage(
  pkg: CkanPackage,
  dimension: StatePaymentDimension,
  releaseKind: BdapReleaseKind,
  expectedCode: string,
): BdapDataset | null {
  const packageId = uuid(pkg.id);
  const name = text(pkg.name);
  const title = text(pkg.title);
  if (!packageId || !name || !title) return null;

  const period = parsePackagePeriod(title, dimension, releaseKind);
  if (!period) return null;

  const notes = text(pkg.notes);
  if (!notes) return null;
  const expectedCodeFromTitle = productCodeForRelease(dimension, releaseKind, period.month);
  if (expectedCodeFromTitle !== expectedCode) return null;
  const escapedCode = expectedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if ((notes.match(new RegExp(`\\[${escapedCode}\\]`, "g"))?.length ?? 0) !== 1) {
    return null;
  }

  const notesLower = notes.toLocaleLowerCase("it-IT");
  const expectedScope = releaseKind === "monthly"
    ? "mese contabile di riferimento"
    : "esercizio finanziario di riferimento";
  if (!notesLower.includes(expectedScope)) return null;

  const common = {
    dimension,
    productCode: expectedCode,
    packageId,
    name,
    title,
    notes,
    referenceYear: period.year,
    metadataModified: text(pkg.metadata_modified),
    csvUrl: `${BDAP_DUMP}/${packageId}.csv`,
    apiUrl: `${BDAP_ACTION}/package_show?id=${encodeURIComponent(packageId)}`,
  };

  if (releaseKind === "monthly") {
    return period.month === null
      ? null
      : { ...common, releaseKind: "monthly", referenceMonth: period.month };
  }
  return period.month !== null
    ? null
    : { ...common, releaseKind: "consuntivo", referenceMonth: null };
}

/**
 * Validates one CKAN package against the exact OpenBDAP release contract.
 * This export is intentionally pure so the title/code/perimeter guard can be
 * tested without depending on the live catalog.
 */
export function normalizeBdapPackage(
  pkg: CkanPackage,
  dimension: StatePaymentDimension,
  releaseKind: BdapReleaseKind,
): BdapDataset | null {
  const title = text(pkg.title);
  if (!title) return null;
  const period = parsePackagePeriod(title, dimension, releaseKind);
  if (!period) return null;
  const expectedCode = productCodeForRelease(dimension, releaseKind, period.month);
  return expectedCode === null ? null : normalizePackage(pkg, dimension, releaseKind, expectedCode);
}

async function searchProduct(
  code: string,
  dimension: StatePaymentDimension,
  releaseKind: BdapReleaseKind,
  signal?: AbortSignal,
): Promise<BdapDataset[]> {
  const url = `${BDAP_ACTION}/package_search?${new URLSearchParams({
    q: code,
    rows: "50",
  }).toString()}`;
  const response = await fetchOfficialSource("openbdap", url, {
    kind: "discovery",
    signal,
    headers: { Accept: "application/json" },
    tags: [`product:${code}`, `dimension:${dimension}`],
  });

  if (!response.ok) {
    throw new Error(`OpenBDAP package_search HTTP ${response.status}`);
  }

  const payload = (await response.json()) as PackageSearchResponse;
  if (!payload.success || !Array.isArray(payload.result?.results)) {
    throw new Error("Risposta package_search OpenBDAP non valida");
  }

  return payload.result.results
    .map((pkg) => normalizePackage(pkg, dimension, releaseKind, code))
    .filter((dataset): dataset is BdapDataset => dataset !== null);
}

function periodAtOffset(now: Date, offset: number): { year: number; month: number } {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export async function discoverLatestStatePaymentDataset(
  dimension: StatePaymentDimension,
  options: { now?: Date; maxMonthsBack?: number; signal?: AbortSignal } = {},
): Promise<MonthlyBdapDataset> {
  const now = options.now ?? new Date();
  const maxMonthsBack = Math.min(Math.max(options.maxMonthsBack ?? 16, 1), 36);

  for (let offset = 0; offset < maxMonthsBack; offset += 1) {
    const target = periodAtOffset(now, offset);
    const dataset = await getStatePaymentDatasetForPeriod(
      dimension,
      target.year,
      target.month,
      { signal: options.signal },
    );
    if (dataset) return dataset;
  }

  throw new Error(`Nessun dataset OpenBDAP recente trovato per ${dimension}`);
}

export async function getStatePaymentDatasetForPeriod(
  dimension: StatePaymentDimension,
  year: number,
  month: number,
  options: { signal?: AbortSignal } = {},
): Promise<MonthlyBdapDataset | null> {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error(`Anno OpenBDAP non valido: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Mese OpenBDAP non valido: ${month}`);
  }

  const code = productCode(month, dimension);
  const datasets = await searchProduct(code, dimension, "monthly", options.signal);
  const matches = datasets.filter(
    (dataset): dataset is MonthlyBdapDataset =>
      dataset.releaseKind === "monthly" &&
      dataset.referenceYear === year &&
      dataset.referenceMonth === month,
  );
  if (matches.length > 1) {
    throw new Error(`OpenBDAP ha restituito più rilasci mensili per ${code} ${year}/${month}`);
  }
  return matches[0] ?? null;
}

export async function getStatePaymentDatasetForYear(
  dimension: StatePaymentDimension,
  year: number,
  options: { signal?: AbortSignal } = {},
): Promise<ConsuntivoBdapDataset | null> {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error(`Anno OpenBDAP non valido: ${year}`);
  }

  const code = consuntivoProductCode(dimension);
  const datasets = await searchProduct(code, dimension, "consuntivo", options.signal);
  const matches = datasets.filter(
    (dataset): dataset is ConsuntivoBdapDataset =>
      dataset.releaseKind === "consuntivo" && dataset.referenceYear === year,
  );
  if (matches.length > 1) {
    throw new Error(`OpenBDAP ha restituito più consuntivi per ${code} ${year}`);
  }
  return matches[0] ?? null;
}

async function resolveStatePaymentDataset(
  dimension: StatePaymentDimension,
  options: { year?: number; month?: number; signal?: AbortSignal },
): Promise<BdapDataset> {
  const { year, month, signal } = options;

  if (year === undefined && month !== undefined) {
    throw new Error("Per scegliere il mese OpenBDAP serve anche l'anno");
  }

  if (year === undefined) {
    return discoverLatestStatePaymentDataset(dimension, { signal });
  }

  if (month !== undefined) {
    const dataset = await getStatePaymentDatasetForPeriod(dimension, year, month, { signal });
    if (!dataset) throw new StatePaymentPeriodUnavailableError(year, month);
    return dataset;
  }

  const consuntivo = await getStatePaymentDatasetForYear(dimension, year, { signal });
  if (consuntivo) return consuntivo;

  for (let candidateMonth = 12; candidateMonth >= 1; candidateMonth -= 1) {
    const dataset = await getStatePaymentDatasetForPeriod(
      dimension,
      year,
      candidateMonth,
      { signal },
    );
    if (dataset) return dataset;
  }

  throw new StatePaymentPeriodUnavailableError(year, null);
}

async function fetchDatasetRows(
  dataset: BdapDataset,
  signal?: AbortSignal,
): Promise<DelimitedRecord[]> {
  const response = await fetchOfficialSource("openbdap", dataset.csvUrl, {
    kind: "data",
    signal,
    headers: { Accept: "text/csv" },
    tags: [
      `dataset:${dataset.packageId}`,
      `dimension:${dataset.dimension}`,
      `release:${dataset.releaseKind}`,
    ],
  });

  if (!response.ok) {
    throw new Error(`OpenBDAP CSV HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("csv")) {
    throw new Error("OpenBDAP non ha restituito un CSV per il dataset richiesto");
  }

  const rows = parseDelimitedRecords(decodePublicDataText(await response.arrayBuffer()));
  if (rows.length === 0) throw new Error("Dataset OpenBDAP vuoto");
  return rows;
}

export async function getStatePaymentDatasetTotal(
  dataset: BdapDataset,
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const rows = await fetchDatasetRows(dataset, options.signal);
  return rows.reduce((total, record) => total + amount(record, totalPaidField(dataset)), 0);
}

function amount(record: DelimitedRecord, key: string): number {
  return parseOpenBdapAmount(record[key], key);
}

function integer(record: DelimitedRecord, key: string): number {
  const raw = record[key]?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`OpenBDAP: intero non valido nel campo ${key}`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`OpenBDAP: intero fuori intervallo nel campo ${key}`);
  }
  return parsed;
}

function required(record: DelimitedRecord, key: string): string {
  const value = record[key]?.trim();
  if (!value) throw new Error(`OpenBDAP: campo obbligatorio mancante: ${key}`);
  return value;
}

function totalPaidField(dataset: BdapDataset): string {
  return dataset.releaseKind === "consuntivo" ? "Totale pagato" : "Totale Pagato";
}

function rowYear(record: DelimitedRecord, dataset: BdapDataset): number {
  const year = integer(record, "Esercizio finanziario");
  if (year !== dataset.referenceYear) {
    throw new Error(
      `OpenBDAP: l'anno della riga ${year} non coincide con il rilascio ${dataset.referenceYear}`,
    );
  }
  return year;
}

function rowMonth(record: DelimitedRecord, dataset: BdapDataset): string | null {
  if (dataset.releaseKind === "consuntivo") return null;
  const observed = required(record, "Mese contabile");
  const expected = monthName(dataset.referenceMonth);
  if (observed.toLocaleUpperCase("it-IT") !== expected) {
    throw new Error(
      `OpenBDAP: il mese della riga ${observed} non coincide con il rilascio ${expected}`,
    );
  }
  return observed;
}

function components(record: DelimitedRecord, dataset: BdapDataset): PaymentComponents {
  const result = {
    opErario: amount(record, "OP Erario"),
    opTesoreria: amount(record, "OP Tesoreria"),
    opEsterno: amount(record, "OP Esterno"),
    oaTesoreria: amount(record, "OA Tesoreria"),
    oaSpesaFunzDeleg: amount(record, "OA Spesa Funz Deleg"),
    rsfStipendi: amount(record, "RSF Stipendi"),
    rsfAltro: amount(record, "RSF Altro"),
    noteImputazione: amount(record, "Note Imputazione"),
    totalPaid: amount(record, totalPaidField(dataset)),
  };
  assertOpenBdapComponentTotal(result);
  return result;
}

function normalizeMissionRows(
  rows: DelimitedRecord[],
  dataset: BdapDataset,
): StateMissionPayment[] {
  return rows.map((record) => ({
    year: rowYear(record, dataset),
    month: rowMonth(record, dataset),
    missionCode: required(record, "Codice Missione"),
    mission: required(record, "Missione"),
    ...components(record, dataset),
  }));
}

function normalizeAdministrationRows(
  rows: DelimitedRecord[],
  dataset: BdapDataset,
): StateAdministrationMissionPayment[] {
  return rows.map((record) => ({
    year: rowYear(record, dataset),
    month: rowMonth(record, dataset),
    missionCode: required(record, "Codice Missione"),
    mission: required(record, "Missione"),
    administrationCode: required(record, "Codice STP"),
    administration: required(record, "Amministrazione"),
    ...components(record, dataset),
  }));
}

function normalizeEconomicRows(
  rows: DelimitedRecord[],
  dataset: BdapDataset,
): StateAdministrationEconomicPayment[] {
  return rows.map((record) => ({
    year: rowYear(record, dataset),
    month: rowMonth(record, dataset),
    administrationCode: required(record, "Codice STP"),
    administration: required(record, "Amministrazione"),
    categoryCode: required(record, "Codice Categoria"),
    category: required(record, "Categoria"),
    economicLevel2Code: required(record, "Codice CE2"),
    economicLevel2: required(record, "CE2"),
    ...components(record, dataset),
  }));
}

function sum<T>(rows: T[], selector: (row: T) => number): number {
  return rows.reduce((total, row) => total + selector(row), 0);
}

function groupBy<T>(
  rows: T[],
  key: (row: T) => string,
  label: (row: T) => string,
  value: (row: T) => number,
  code?: (row: T) => string | null,
): SpendingAggregate[] {
  const grouped = new Map<string, SpendingAggregate>();

  for (const row of rows) {
    const groupKey = key(row);
    const current = grouped.get(groupKey);
    if (current) {
      current.value += value(row);
      continue;
    }

    grouped.set(groupKey, {
      code: code ? code(row) : null,
      label: label(row),
      value: value(row),
    });
  }

  return [...grouped.values()].sort((left, right) => right.value - left.value);
}

function differencePct(reference: number, comparison: number | null): number | null {
  if (comparison === null || reference === 0) return null;
  return ((comparison - reference) / reference) * 100;
}

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? `MESE ${month}`;
}

function period(dataset: BdapDataset): StateSpendingSnapshot["period"] {
  const { referenceYear: year, referenceMonth: month, releaseKind } = dataset;
  const monthLabel = month === null ? "CONSUNTIVO" : monthName(month);
  return {
    year,
    month,
    monthName: monthLabel,
    label: `${monthLabel} ${year}`,
    releaseKind,
  };
}

async function getCompanionDataset(
  dimension: StatePaymentDimension,
  primary: BdapDataset,
  signal?: AbortSignal,
): Promise<BdapDataset | null> {
  const candidate = primary.releaseKind === "consuntivo"
    ? await getStatePaymentDatasetForYear(dimension, primary.referenceYear, { signal })
    : await getStatePaymentDatasetForPeriod(
        dimension,
        primary.referenceYear,
        primary.referenceMonth,
        { signal },
      );
  if (!candidate) return null;
  if (
    candidate.releaseKind !== primary.releaseKind ||
    candidate.referenceYear !== primary.referenceYear ||
    candidate.referenceMonth !== primary.referenceMonth
  ) {
    throw new Error("OpenBDAP ha restituito dettagli di una serie diversa dal rilascio principale");
  }
  return candidate;
}

function paymentMethodsForRows<T extends PaymentComponents>(rows: T[]): SpendingAggregate[] {
  return [
    {
      code: "op-erario",
      label: "Pagamenti tramite Erario",
      value: sum(rows, (row) => row.opErario),
    },
    {
      code: "op-tesoreria",
      label: "Pagamenti tramite Tesoreria",
      value: sum(rows, (row) => row.opTesoreria),
    },
    {
      code: "op-esterno",
      label: "Altri ordini di pagamento",
      value: sum(rows, (row) => row.opEsterno),
    },
    {
      code: "oa-tesoreria",
      label: "Accreditamenti tramite Tesoreria",
      value: sum(rows, (row) => row.oaTesoreria),
    },
    {
      code: "oa-delegata",
      label: "Spesa delegata",
      value: sum(rows, (row) => row.oaSpesaFunzDeleg),
    },
    {
      code: "rsf-stipendi",
      label: "Stipendi",
      value: sum(rows, (row) => row.rsfStipendi),
    },
    {
      code: "rsf-altro",
      label: "Altre spese fisse",
      value: sum(rows, (row) => row.rsfAltro),
    },
    {
      code: "note-imputazione",
      label: "Note di imputazione",
      value: sum(rows, (row) => row.noteImputazione),
    },
  ]
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

export async function getStateSpendingSnapshot(
  options: { year?: number; month?: number; signal?: AbortSignal } = {},
): Promise<StateSpendingSnapshot> {
  const missionDataset = await resolveStatePaymentDataset("mission", options);

  const [administrationDatasetResult, economicDatasetResult] = await Promise.allSettled([
    getCompanionDataset("missionAdministration", missionDataset, options.signal),
    getCompanionDataset("administrationEconomic", missionDataset, options.signal),
  ]);

  const administrationDataset =
    administrationDatasetResult.status === "fulfilled"
      ? administrationDatasetResult.value
      : null;
  const economicDataset =
    economicDatasetResult.status === "fulfilled" ? economicDatasetResult.value : null;

  const [missionRowsResult, administrationRowsResult, economicRowsResult] = await Promise.allSettled([
    fetchDatasetRows(missionDataset, options.signal),
    administrationDataset
      ? fetchDatasetRows(administrationDataset, options.signal)
      : Promise.resolve([]),
    economicDataset ? fetchDatasetRows(economicDataset, options.signal) : Promise.resolve([]),
  ]);

  if (missionRowsResult.status !== "fulfilled") {
    throw missionRowsResult.reason instanceof Error
      ? missionRowsResult.reason
      : new Error("Impossibile leggere il dataset per missione");
  }

  const missionRows = normalizeMissionRows(missionRowsResult.value, missionDataset);
  const administrationRows =
    administrationDataset && administrationRowsResult.status === "fulfilled"
      ? normalizeAdministrationRows(administrationRowsResult.value, administrationDataset)
      : [];
  const economicRows =
    economicDataset && economicRowsResult.status === "fulfilled"
      ? normalizeEconomicRows(economicRowsResult.value, economicDataset)
      : [];
  const warnings: string[] = [];
  if (!administrationDataset) {
    warnings.push("OpenBDAP non ha pubblicato il dettaglio per amministrazione per questo periodo.");
  } else if (administrationRowsResult.status === "rejected") {
    warnings.push("Il dettaglio per amministrazione non era raggiungibile durante questo controllo.");
  }
  if (!economicDataset) {
    warnings.push("OpenBDAP non ha pubblicato il dettaglio economico per questo periodo.");
  } else if (economicRowsResult.status === "rejected") {
    warnings.push("Il dettaglio economico non era raggiungibile durante questo controllo.");
  }

  const missionTotal = sum(missionRows, (row) => row.totalPaid);
  const administrationTotal =
    administrationRows.length > 0 ? sum(administrationRows, (row) => row.totalPaid) : null;
  const economicTotal =
    economicRows.length > 0 ? sum(economicRows, (row) => row.totalPaid) : null;

  const missions = groupBy(
    missionRows,
    (row) => row.missionCode,
    (row) => row.mission,
    (row) => row.totalPaid,
    (row) => row.missionCode,
  );

  const administrations: StateAdministrationAggregate[] = groupBy(
    administrationRows,
    (row) => row.administrationCode,
    (row) => row.administration,
    (row) => row.totalPaid,
    (row) => row.administrationCode,
  ).map((item) => ({
    ...item,
    identity:
      item.code === null ? null : getStateAdministrationIdentity(item.code, item.label),
  }));

  const economicCategories = groupBy(
    economicRows,
    (row) => row.categoryCode,
    (row) => row.category,
    (row) => row.totalPaid,
    (row) => row.categoryCode,
  );

  const paymentMethods = paymentMethodsForRows(missionRows);

  return {
    period: period(missionDataset),
    totalPaid: missionTotal,
    counts: {
      missions: missions.length,
      administrations: administrations.length,
      economicCategories: economicCategories.length,
    },
    missions,
    administrations,
    economicCategories,
    paymentMethods,
    availability: {
      missions: "available",
      administrations:
        administrationDataset && administrationRowsResult.status === "fulfilled"
          ? "available"
          : "unavailable",
      economicCategories:
        economicDataset && economicRowsResult.status === "fulfilled"
          ? "available"
          : "unavailable",
    },
    warnings,
    consistency: {
      missionTotal,
      administrationTotal,
      economicTotal,
      administrationDifferencePct: differencePct(missionTotal, administrationTotal),
      economicDifferencePct: differencePct(missionTotal, economicTotal),
    },
    sources: {
      mission: missionDataset,
      missionAdministration: administrationDataset,
      administrationEconomic: economicDataset,
    },
    observedAt: new Date().toISOString(),
  };
}

export async function getStateAdministrationSpending(
  administrationCode: string,
  options: { year?: number; month?: number; signal?: AbortSignal } = {},
): Promise<StateAdministrationSpending> {
  const requestedCode = administrationCode.trim();
  if (!requestedCode || requestedCode.length > 64) {
    throw new Error("Codice amministrazione OpenBDAP non valido");
  }

  const administrationDataset = await resolveStatePaymentDataset(
    "missionAdministration",
    options,
  );
  const economicDataset = await getCompanionDataset(
    "administrationEconomic",
    administrationDataset,
    options.signal,
  );

  const [administrationRecords, economicRecordsResult] = await Promise.all([
    fetchDatasetRows(administrationDataset, options.signal),
    economicDataset
      ? fetchDatasetRows(economicDataset, options.signal)
          .then((records) => ({ ok: true as const, records }))
          .catch(() => ({ ok: false as const, records: null }))
      : Promise.resolve({ ok: false as const, records: null }),
  ]);

  const administrationRows = normalizeAdministrationRows(administrationRecords, administrationDataset).filter(
    (row) => row.administrationCode === requestedCode,
  );
  if (administrationRows.length === 0) {
    throw new StateAdministrationNotFoundError(
      requestedCode,
      administrationDataset.referenceYear,
      administrationDataset.referenceMonth,
    );
  }

  const economicRows = economicRecordsResult.records
    ? normalizeEconomicRows(economicRecordsResult.records, economicDataset!).filter(
        (row) => row.administrationCode === requestedCode,
      )
    : [];
  const warnings = economicDataset && !economicRecordsResult.ok
    ? ["Il dettaglio economico non era raggiungibile durante questo controllo."]
    : !economicDataset
      ? ["OpenBDAP non ha pubblicato il dettaglio economico per questo periodo."]
      : [];
  const missionTotal = sum(administrationRows, (row) => row.totalPaid);
  const economicTotal =
    economicRows.length > 0 ? sum(economicRows, (row) => row.totalPaid) : null;
  const missions = groupBy(
    administrationRows,
    (row) => row.missionCode,
    (row) => row.mission,
    (row) => row.totalPaid,
    (row) => row.missionCode,
  );
  const economicCategories = groupBy(
    economicRows,
    (row) => row.categoryCode,
    (row) => row.category,
    (row) => row.totalPaid,
    (row) => row.categoryCode,
  );
  const economicDetails = groupBy(
    economicRows,
    (row) => `${row.categoryCode}:${row.economicLevel2Code}`,
    (row) => row.economicLevel2,
    (row) => row.totalPaid,
    (row) => row.economicLevel2Code,
  );

  return {
    period: period(administrationDataset),
    administration: {
      code: requestedCode,
      name: administrationRows[0].administration,
      totalPaid: missionTotal,
      identity: getStateAdministrationIdentity(
        requestedCode,
        administrationRows[0].administration,
      ),
    },
    counts: {
      missions: missions.length,
      economicCategories: economicCategories.length,
      economicDetails: economicDetails.length,
    },
    missions,
    economicCategories,
    economicDetails,
    paymentMethods: paymentMethodsForRows(administrationRows),
    availability: {
      missions: "available",
      economicBreakdown: economicRecordsResult.ok ? "available" : "unavailable",
    },
    warnings,
    consistency: {
      missionTotal,
      economicTotal,
      economicDifferencePct: differencePct(missionTotal, economicTotal),
    },
    sources: {
      missionAdministration: administrationDataset,
      administrationEconomic: economicDataset,
    },
    observedAt: new Date().toISOString(),
  };
}
