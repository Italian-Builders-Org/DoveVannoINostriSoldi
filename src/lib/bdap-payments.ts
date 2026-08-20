import {
  decodePublicDataText,
  parseDelimitedRecords,
  parsePublicNumber,
  type DelimitedRecord,
} from "@/lib/data/delimited";
import { fetchOfficialSource } from "@/lib/data/source-fetch";

const BDAP_BASE = "https://bdap-opendata.rgs.mef.gov.it";
const BDAP_ACTION = `${BDAP_BASE}/SpodCkanApi/api/3/action`;
const BDAP_DUMP = `${BDAP_BASE}/SpodCkanApi/api/3/datastore/dump`;

export type StatePaymentDimension =
  | "mission"
  | "missionAdministration"
  | "administrationEconomic";

type CkanPackage = {
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

export type BdapDataset = {
  dimension: StatePaymentDimension;
  productCode: string;
  packageId: string;
  name: string;
  title: string;
  notes: string | null;
  referenceYear: number;
  referenceMonth: number;
  metadataModified: string | null;
  csvUrl: string;
  apiUrl: string;
};

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
  month: string;
  missionCode: string;
  mission: string;
};

export type StateAdministrationMissionPayment = StateMissionPayment & {
  administrationCode: string;
  administration: string;
};

export type StateAdministrationEconomicPayment = PaymentComponents & {
  year: number;
  month: string;
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

export type StateSpendingSnapshot = {
  period: {
    year: number;
    month: number;
    monthName: string;
    label: string;
  };
  totalPaid: number;
  counts: {
    missions: number;
    administrations: number;
    economicCategories: number;
  };
  missions: SpendingAggregate[];
  administrations: SpendingAggregate[];
  economicCategories: SpendingAggregate[];
  paymentMethods: SpendingAggregate[];
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

function parsePeriod(title: string): { year: number; month: number } | null {
  const match = title.match(/\b(20\d{2})\/(0[1-9]|1[0-2])\b/);
  if (!match) return null;

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
  };
}

function normalizePackage(
  pkg: CkanPackage,
  dimension: StatePaymentDimension,
  expectedCode: string,
): BdapDataset | null {
  const packageId = uuid(pkg.id);
  const name = text(pkg.name);
  const title = text(pkg.title);
  if (!packageId || !name || !title) return null;

  const period = parsePeriod(title);
  if (!period) return null;

  const notes = text(pkg.notes);
  if (!(notes?.includes(`[${expectedCode}]`) ?? false)) return null;

  return {
    dimension,
    productCode: expectedCode,
    packageId,
    name,
    title,
    notes,
    referenceYear: period.year,
    referenceMonth: period.month,
    metadataModified: text(pkg.metadata_modified),
    csvUrl: `${BDAP_DUMP}/${packageId}.csv`,
    apiUrl: `${BDAP_ACTION}/package_show?id=${encodeURIComponent(packageId)}`,
  };
}

async function searchProduct(
  code: string,
  dimension: StatePaymentDimension,
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
    .map((pkg) => normalizePackage(pkg, dimension, code))
    .filter((dataset): dataset is BdapDataset => dataset !== null);
}

function periodAtOffset(now: Date, offset: number): { year: number; month: number } {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export async function discoverLatestStatePaymentDataset(
  dimension: StatePaymentDimension,
  options: { now?: Date; maxMonthsBack?: number; signal?: AbortSignal } = {},
): Promise<BdapDataset> {
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
): Promise<BdapDataset | null> {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error(`Anno OpenBDAP non valido: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Mese OpenBDAP non valido: ${month}`);
  }

  const code = productCode(month, dimension);
  const datasets = await searchProduct(code, dimension, options.signal);
  return (
    datasets.find(
      (dataset) => dataset.referenceYear === year && dataset.referenceMonth === month,
    ) ?? null
  );
}

async function fetchDatasetRows(
  dataset: BdapDataset,
  signal?: AbortSignal,
): Promise<DelimitedRecord[]> {
  const response = await fetchOfficialSource("openbdap", dataset.csvUrl, {
    kind: "data",
    signal,
    headers: { Accept: "text/csv" },
    tags: [`dataset:${dataset.packageId}`, `dimension:${dataset.dimension}`],
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
  return rows.reduce(
    (total, record) => total + parsePublicNumber(record["Totale Pagato"]),
    0,
  );
}

function amount(record: DelimitedRecord, key: string): number {
  return parsePublicNumber(record[key]);
}

function integer(record: DelimitedRecord, key: string): number {
  const parsed = Number.parseInt(record[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function required(record: DelimitedRecord, key: string): string {
  return record[key]?.trim() || "Non indicato";
}

function components(record: DelimitedRecord): PaymentComponents {
  return {
    opErario: amount(record, "OP Erario"),
    opTesoreria: amount(record, "OP Tesoreria"),
    opEsterno: amount(record, "OP Esterno"),
    oaTesoreria: amount(record, "OA Tesoreria"),
    oaSpesaFunzDeleg: amount(record, "OA Spesa Funz Deleg"),
    rsfStipendi: amount(record, "RSF Stipendi"),
    rsfAltro: amount(record, "RSF Altro"),
    noteImputazione: amount(record, "Note Imputazione"),
    totalPaid: amount(record, "Totale Pagato"),
  };
}

function normalizeMissionRows(rows: DelimitedRecord[]): StateMissionPayment[] {
  return rows.map((record) => ({
    year: integer(record, "Esercizio finanziario"),
    month: required(record, "Mese contabile"),
    missionCode: required(record, "Codice Missione"),
    mission: required(record, "Missione"),
    ...components(record),
  }));
}

function normalizeAdministrationRows(
  rows: DelimitedRecord[],
): StateAdministrationMissionPayment[] {
  return rows.map((record) => ({
    year: integer(record, "Esercizio finanziario"),
    month: required(record, "Mese contabile"),
    missionCode: required(record, "Codice Missione"),
    mission: required(record, "Missione"),
    administrationCode: required(record, "Codice STP"),
    administration: required(record, "Amministrazione"),
    ...components(record),
  }));
}

function normalizeEconomicRows(
  rows: DelimitedRecord[],
): StateAdministrationEconomicPayment[] {
  return rows.map((record) => ({
    year: integer(record, "Esercizio finanziario"),
    month: required(record, "Mese contabile"),
    administrationCode: required(record, "Codice STP"),
    administration: required(record, "Amministrazione"),
    categoryCode: required(record, "Codice Categoria"),
    category: required(record, "Categoria"),
    economicLevel2Code: required(record, "Codice CE2"),
    economicLevel2: required(record, "CE2"),
    ...components(record),
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

export async function getStateSpendingSnapshot(
  options: { signal?: AbortSignal } = {},
): Promise<StateSpendingSnapshot> {
  const missionDataset = await discoverLatestStatePaymentDataset("mission", {
    signal: options.signal,
  });
  const { referenceYear: year, referenceMonth: month } = missionDataset;

  const [administrationDatasetResult, economicDatasetResult] = await Promise.allSettled([
    getStatePaymentDatasetForPeriod("missionAdministration", year, month, options),
    getStatePaymentDatasetForPeriod("administrationEconomic", year, month, options),
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

  const missionRows = normalizeMissionRows(missionRowsResult.value);
  const administrationRows =
    administrationRowsResult.status === "fulfilled"
      ? normalizeAdministrationRows(administrationRowsResult.value)
      : [];
  const economicRows =
    economicRowsResult.status === "fulfilled"
      ? normalizeEconomicRows(economicRowsResult.value)
      : [];

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

  const administrations = groupBy(
    administrationRows,
    (row) => row.administrationCode,
    (row) => row.administration,
    (row) => row.totalPaid,
    (row) => row.administrationCode,
  );

  const economicCategories = groupBy(
    economicRows,
    (row) => row.categoryCode,
    (row) => row.category,
    (row) => row.totalPaid,
    (row) => row.categoryCode,
  );

  const paymentMethods: SpendingAggregate[] = [
    {
      code: "op-erario",
      label: "Ordini di pagamento · Erario",
      value: sum(missionRows, (row) => row.opErario),
    },
    {
      code: "op-tesoreria",
      label: "Ordini di pagamento · Tesoreria",
      value: sum(missionRows, (row) => row.opTesoreria),
    },
    {
      code: "op-esterno",
      label: "Ordini di pagamento · Esterno",
      value: sum(missionRows, (row) => row.opEsterno),
    },
    {
      code: "oa-tesoreria",
      label: "Ordini di accreditamento · Tesoreria",
      value: sum(missionRows, (row) => row.oaTesoreria),
    },
    {
      code: "oa-delegata",
      label: "Ordini di accreditamento · Spesa delegata",
      value: sum(missionRows, (row) => row.oaSpesaFunzDeleg),
    },
    {
      code: "rsf-stipendi",
      label: "Ruoli di spesa fissa · Stipendi",
      value: sum(missionRows, (row) => row.rsfStipendi),
    },
    {
      code: "rsf-altro",
      label: "Ruoli di spesa fissa · Altro",
      value: sum(missionRows, (row) => row.rsfAltro),
    },
    {
      code: "note-imputazione",
      label: "Note di imputazione",
      value: sum(missionRows, (row) => row.noteImputazione),
    },
  ]
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);

  return {
    period: {
      year,
      month,
      monthName: monthName(month),
      label: `${monthName(month)} ${year}`,
    },
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
