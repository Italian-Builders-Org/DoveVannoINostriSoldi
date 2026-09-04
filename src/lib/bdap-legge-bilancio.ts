import {
  decodePublicDataText,
  parseDelimitedRecords,
  type DelimitedRecord,
} from "@/lib/data/delimited";
import { fetchOfficialSource, SourceFetchError } from "@/lib/data/source-fetch";
import { getSourcePolicy } from "@/lib/data/source-policy";
import { parseOpenBdapAmount } from "@/lib/data/bdap-payment-contract";
import budgetLawSnapshotArtifact from "@/data/generated/openbdap-budget-law-missions.json";

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
const SNAPSHOT_PACKAGE_ID = "e0be9f03-134b-446d-8e6c-cb5c14ddc11c";
const SNAPSHOT_RESOURCE_ID = "32750";
const SNAPSHOT_CATALOG_SHA256 =
  "sha256:c29936b96b538c669f47f62319c051724cd10ce8105b38906eed85f06c696e0c";
const SNAPSHOT_CSV_SHA256 =
  "sha256:5988ac55ed61d517d7500402547dccd94c4cae11611f10c77459dcfe64239338";
const SNAPSHOT_CATALOG_BYTES = 6_283;
const SNAPSHOT_CSV_BYTES = 3_422_462;
const SNAPSHOT_CATALOG_URL =
  `${BDAP_ACTION}/package_search?q=LBF_SPE_CRU_AMPMA_001&rows=20`;
const SNAPSHOT_ANNUAL_TOTALS_EUR = new Map<number, number>([
  [2017, 861_047_385_808],
  [2018, 852_369_824_700],
  [2019, 869_498_990_905],
  [2020, 897_423_599_901],
  [2021, 1_060_697_407_565],
  [2022, 1_093_956_278_557],
  [2023, 1_183_723_964_094],
  [2024, 1_215_086_092_281],
  [2025, 1_199_544_721_805],
  [2026, 1_253_161_463_689],
]);

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
  license_id?: unknown;
  license_title?: unknown;
  license_url?: unknown;
  resources?: unknown;
};

type CkanResource = {
  id?: unknown;
  url?: unknown;
  format?: unknown;
  mimetype?: unknown;
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
  license: string;
  licenseUrl: string;
  resourceId: string;
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
  dataMode: "live" | "snapshot";
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

export class BudgetLawSourceTemporarilyUnavailableError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BudgetLawSourceTemporarilyUnavailableError";
    this.cause = cause;
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isTemporarySourceFailure(error: unknown): boolean {
  if (error instanceof BudgetLawSourceTemporarilyUnavailableError) return true;
  if (isAbortLike(error) && (error as DOMException).name === "TimeoutError") return true;
  return (
    error instanceof SourceFetchError &&
    (error.message.startsWith("Errore di rete verso") ||
      error.message.startsWith("Impossibile interrogare la fonte"))
  );
}

function throwForTemporaryHttpFailure(response: Response, operation: string): void {
  if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
    throw new BudgetLawSourceTemporarilyUnavailableError(
      `OpenBDAP ${operation} temporaneamente non disponibile (HTTP ${response.status})`,
    );
  }
}

// OpenBDAP has emitted both messages for the same missing-attachment failure:
// the shorter form is the current live response, while the longer form is
// retained for compatibility with older gateway responses. Other JSON errors
// must remain fail-closed instead of silently switching to the snapshot.
const KNOWN_CSV_ATTACHMENT_OUTAGE_MESSAGES = new Set([
  "Cannot convert data to csv",
  "Cannot convert data to csv. Attachment not found",
]);

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

function csvResource(pkg: CkanPackage, packageId: string): CkanResource | null {
  if (!Array.isArray(pkg.resources)) return null;
  const expectedPath = `/SpodCkanApi/api/3/datastore/dump/${packageId}.csv`;
  const matches = pkg.resources.filter((resource): resource is CkanResource => {
    if (!resource || typeof resource !== "object") return false;
    if (text(resource.format)?.toLowerCase() !== "csv") return false;
    if (text(resource.mimetype)?.toLowerCase() !== "text/csv") return false;
    const rawUrl = text(resource.url);
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl);
      return url.hostname === "bdap-opendata.rgs.mef.gov.it" && url.pathname === expectedPath;
    } catch {
      return false;
    }
  });
  return matches.length === 1 ? matches[0] : null;
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

  const licenseId = text(pkg.license_id);
  const license = text(pkg.license_title);
  const licenseUrl = text(pkg.license_url);
  if (
    licenseId !== "cc-by" ||
    license !== "Creative Commons Attribution" ||
    licenseUrl !== "http://www.opendefinition.org/licenses/cc-by"
  ) {
    return null;
  }
  const resource = csvResource(pkg, packageId);
  const resourceId = text(resource?.id);
  if (!resource || !resourceId) return null;

  return {
    packageId,
    name,
    title,
    notes,
    metadataModified: text(pkg.metadata_modified),
    license,
    licenseUrl,
    resourceId,
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
    throwForTemporaryHttpFailure(response, "package_search");
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

/** Generous ceiling over the live dump (~4.5 MB): guards the aggregation
 * step against an unexpectedly large or runaway response, not a size we
 * expect to hit in normal operation. */
const MAX_CSV_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_ERROR_BYTES = 16 * 1024;
// Discovery and CSV download are sequential. OpenBDAP policy allows two
// 15-second attempts for each request, so the aggregate deadline must leave
// both operations enough time to exhaust their bounded retry budget.
const FULL_AGGREGATE_DEADLINE_MS = 70_000;

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
    throwForTemporaryHttpFailure(response, "CSV");
    throw new Error(`OpenBDAP CSV HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("csv")) {
    if (contentType.toLowerCase().includes("json")) {
      const body = await readBoundedResponseBody(
        response,
        MAX_SOURCE_ERROR_BYTES,
        "risposta di errore",
      );
      try {
        const payload = JSON.parse(new TextDecoder("utf-8").decode(body)) as {
          success?: unknown;
          error?: { message?: unknown };
        };
        if (
          payload.success === false &&
          typeof payload.error?.message === "string" &&
          KNOWN_CSV_ATTACHMENT_OUTAGE_MESSAGES.has(payload.error.message)
        ) {
          throw new BudgetLawSourceTemporarilyUnavailableError(
            "OpenBDAP non ha reso disponibile l'allegato CSV richiesto",
          );
        }
      } catch (error) {
        if (error instanceof BudgetLawSourceTemporarilyUnavailableError) throw error;
      }
    }
    throw new Error("OpenBDAP non ha restituito un CSV per il dataset Legge di Bilancio");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CSV_BYTES) {
    throw new Error(
      `OpenBDAP CSV troppo grande (${declaredLength} byte, limite ${MAX_CSV_BYTES})`,
    );
  }

  const buffer = await readBoundedResponseBody(response, MAX_CSV_BYTES, "CSV");

  const rows = parseDelimitedRecords(decodePublicDataText(buffer));
  if (rows.length === 0) throw new Error("Dataset OpenBDAP Legge di Bilancio vuoto");
  return rows;
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`OpenBDAP ${label} troppo grande (${buffer.byteLength} byte, limite ${maxBytes})`);
    }
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`OpenBDAP ${label} troppo grande (${totalBytes} byte, limite ${maxBytes})`);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
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

type FullMissionAggregate = {
  dataset: BudgetLawMissionDataset;
  acquiredAt: string;
  availableYears: number[];
  missionsByYear: Map<number, Set<string>>;
  totalsByYearMission: Map<string, number>;
};

function latestConsecutiveYears(availableYears: readonly number[]): number[] {
  if (availableYears.length === 0) return [];
  let start = availableYears.length - 1;
  while (start > 0 && availableYears[start - 1] === availableYears[start] - 1) {
    start -= 1;
  }
  return availableYears.slice(start);
}

/**
 * In-memory cache for the expensive step (discover + download + parse the
 * ~4.5 MB CSV + aggregate per year/mission), which is independent of the
 * requested window. The CSV response is well over Next's 2 MB Data Cache
 * entry limit, so relying on `fetch`'s own cache silently fails and
 * re-downloads/re-parses the whole file on every visit; caching the small
 * aggregated result here instead means that only happens once per
 * `dataRevalidateSeconds`. The in-flight promise itself is cached so
 * concurrent callers share one download instead of racing separate ones.
 */
let fullAggregateCache: { promise: Promise<FullMissionAggregate>; expiresAt: number } | null =
  null;

async function computeFullMissionAggregate(signal: AbortSignal): Promise<FullMissionAggregate> {
  const dataset = await discoverBudgetLawMissionDataset(signal);
  const records = await fetchDatasetRows(dataset, signal);

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
  return {
    dataset,
    acquiredAt: new Date().toISOString(),
    availableYears,
    missionsByYear,
    totalsByYearMission,
  };
}

/**
 * Returns the cached aggregate, refreshing it when missing or expired. A
 * failed population is not cached, so the next call retries instead of
 * being stuck on an error for the rest of the TTL.
 */
function getFullMissionAggregate(): Promise<FullMissionAggregate> {
  if (fullAggregateCache && fullAggregateCache.expiresAt > Date.now()) {
    return fullAggregateCache.promise;
  }
  const revalidateSeconds = getSourcePolicy("openbdap").dataRevalidateSeconds;
  const promise = computeFullMissionAggregate(
    AbortSignal.timeout(FULL_AGGREGATE_DEADLINE_MS),
  ).catch((error: unknown) => {
    if (fullAggregateCache?.promise === promise) fullAggregateCache = null;
    throw error;
  });
  fullAggregateCache = { promise, expiresAt: Date.now() + revalidateSeconds * 1000 };
  return promise;
}

function waitForAggregate(
  promise: Promise<FullMissionAggregate>,
  signal?: AbortSignal,
): Promise<FullMissionAggregate> {
  if (!signal) return promise;
  const abortReason = () =>
    signal.reason ?? new DOMException("Request aborted", "AbortError");
  if (signal.aborted) return Promise.reject(abortReason());

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Test-only: drops the cached aggregate so the next call fetches fresh. */
export function resetBudgetLawMissionSeriesCacheForTests(): void {
  fullAggregateCache = null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot Legge di Bilancio: oggetto non valido");
  }
  return value as Record<string, unknown>;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Snapshot Legge di Bilancio: ${label} non valido`);
  }
  return value;
}

export function validateBudgetLawMissionSeries(
  value: unknown,
  options: { expectedDataMode?: "live" | "snapshot" } = {},
): BudgetLawMissionSeries {
  const series = objectRecord(value);
  const dataMode = series.dataMode;
  if (dataMode !== "live" && dataMode !== "snapshot") {
    throw new Error("Snapshot Legge di Bilancio: modalità non valida");
  }
  if (options.expectedDataMode && dataMode !== options.expectedDataMode) {
    throw new Error(`Snapshot Legge di Bilancio: modalità ${dataMode} inattesa`);
  }

  const dataset = objectRecord(series.dataset);
  if (
    dataset.packageId !== SNAPSHOT_PACKAGE_ID ||
    dataset.title !== EXPECTED_TITLE ||
    dataset.license !== "Creative Commons Attribution" ||
    dataset.licenseUrl !== "http://www.opendefinition.org/licenses/cc-by" ||
    dataset.resourceId !== SNAPSHOT_RESOURCE_ID ||
    dataset.csvUrl !== `${BDAP_DUMP}/${SNAPSHOT_PACKAGE_ID}.csv`
  ) {
    throw new Error("Snapshot Legge di Bilancio: identità o licenza della fonte inattesa");
  }

  if (!Array.isArray(series.years) || series.years.length < 2) {
    throw new Error("Snapshot Legge di Bilancio: copertura temporale insufficiente");
  }
  const years = series.years.map((year) => {
    if (!Number.isInteger(year) || year < MIN_STABLE_MISSION_YEAR) {
      throw new Error("Snapshot Legge di Bilancio: anno non valido");
    }
    return year as number;
  });
  if (years.some((year, index) => index > 0 && year !== years[index - 1] + 1)) {
    throw new Error("Snapshot Legge di Bilancio: gli anni devono essere consecutivi");
  }

  if (!Array.isArray(series.missions) || series.missions.length === 0) {
    throw new Error("Snapshot Legge di Bilancio: missioni mancanti");
  }
  const missions = series.missions.map((mission) => {
    if (typeof mission !== "string" || !mission.trim()) {
      throw new Error("Snapshot Legge di Bilancio: missione non valida");
    }
    return mission;
  });
  if (new Set(missions).size !== missions.length) {
    throw new Error("Snapshot Legge di Bilancio: missioni duplicate");
  }

  if (!Array.isArray(series.allocations)) {
    throw new Error("Snapshot Legge di Bilancio: stanziamenti mancanti");
  }
  const allocations = series.allocations.map((entry) => {
    const row = objectRecord(entry);
    if (!years.includes(row.year as number) || !missions.includes(row.mission as string)) {
      throw new Error("Snapshot Legge di Bilancio: chiave stanziamento inattesa");
    }
    return {
      year: row.year as number,
      mission: row.mission as string,
      amountEur: safeNonNegativeInteger(row.amountEur, "stanziamento"),
    };
  });
  const allocationMap = new Map(
    allocations.map((row) => [`${row.year}::${row.mission}`, row.amountEur]),
  );
  if (
    allocations.length !== years.length * missions.length ||
    allocationMap.size !== allocations.length
  ) {
    throw new Error("Snapshot Legge di Bilancio: matrice stanziamenti incompleta o duplicata");
  }

  if (!Array.isArray(series.yearOverYearDeltas)) {
    throw new Error("Snapshot Legge di Bilancio: variazioni mancanti");
  }
  const yearOverYearDeltas = series.yearOverYearDeltas.map((entry) => {
    const row = objectRecord(entry);
    const mission = row.mission;
    const fromYear = row.fromYear;
    const toYear = row.toYear;
    if (
      typeof mission !== "string" ||
      !missions.includes(mission) ||
      typeof fromYear !== "number" ||
      typeof toYear !== "number" ||
      toYear !== fromYear + 1
    ) {
      throw new Error("Snapshot Legge di Bilancio: chiave variazione inattesa");
    }
    const fromAmountEur = allocationMap.get(`${fromYear}::${mission}`);
    const toAmountEur = allocationMap.get(`${toYear}::${mission}`);
    if (fromAmountEur === undefined || toAmountEur === undefined) {
      throw new Error("Snapshot Legge di Bilancio: variazione senza stanziamenti di base");
    }
    const expectedDelta = toAmountEur - fromAmountEur;
    const deltaEur = row.deltaEur;
    const deltaPct = row.deltaPct;
    const expectedPct = fromAmountEur === 0 ? null : (expectedDelta / fromAmountEur) * 100;
    if (
      !Number.isSafeInteger(deltaEur) ||
      deltaEur !== expectedDelta ||
      row.fromAmountEur !== fromAmountEur ||
      row.toAmountEur !== toAmountEur ||
      !(
        (expectedPct === null && deltaPct === null) ||
        (typeof deltaPct === "number" && Math.abs(deltaPct - (expectedPct ?? 0)) < 1e-9)
      )
    ) {
      throw new Error("Snapshot Legge di Bilancio: variazione non riconciliata");
    }
    return {
      mission,
      fromYear,
      toYear,
      fromAmountEur,
      toAmountEur,
      deltaEur,
      deltaPct: deltaPct as number | null,
    };
  });
  const deltaKeys = new Set(
    yearOverYearDeltas.map((row) => `${row.fromYear}::${row.toYear}::${row.mission}`),
  );
  if (
    yearOverYearDeltas.length !== missions.length * (years.length - 1) ||
    deltaKeys.size !== yearOverYearDeltas.length
  ) {
    throw new Error("Snapshot Legge di Bilancio: matrice variazioni incompleta");
  }

  if (typeof series.observedAt !== "string" || Number.isNaN(Date.parse(series.observedAt))) {
    throw new Error("Snapshot Legge di Bilancio: data di acquisizione non valida");
  }
  if (series.minStableMissionYear !== MIN_STABLE_MISSION_YEAR) {
    throw new Error("Snapshot Legge di Bilancio: soglia tassonomia inattesa");
  }

  return {
    dataMode,
    dataset: dataset as BudgetLawMissionDataset,
    minStableMissionYear: MIN_STABLE_MISSION_YEAR,
    years,
    missions,
    allocations,
    yearOverYearDeltas,
    observedAt: series.observedAt,
  };
}

function sliceBudgetLawSeries(
  series: BudgetLawMissionSeries,
  requestedWindow: number,
  dataMode: "live" | "snapshot" = series.dataMode,
): BudgetLawMissionSeries {
  const years = series.years.slice(-Math.min(requestedWindow, series.years.length));
  const yearSet = new Set(years);
  return {
    ...series,
    dataMode,
    years,
    allocations: series.allocations.filter((row) => yearSet.has(row.year)),
    yearOverYearDeltas: series.yearOverYearDeltas.filter(
      (row) => yearSet.has(row.fromYear) && yearSet.has(row.toYear),
    ),
  };
}

type BudgetLawSnapshotArtifact = {
  schemaVersion: 1;
  source: {
    packageId: string;
    resourceId: string;
    title: string;
    license: string;
    licenseUrl: string;
    catalogUrl: string;
    catalogSha256: string;
    catalogBytes: number;
    csvUrl: string;
    csvSha256: string;
    csvBytes: number;
    encoding: string;
    delimiter: string;
    quoteChar: string;
    lineEnding: string;
    observedAt: string;
  };
  series: BudgetLawMissionSeries;
};

export function validateBudgetLawSnapshotArtifact(value: unknown): BudgetLawSnapshotArtifact {
  const candidate = objectRecord(value);
  if (candidate.schemaVersion !== 1) {
    throw new Error("Snapshot Legge di Bilancio: versione artefatto non valida");
  }
  const source = objectRecord(candidate.source);
  if (
    source.packageId !== SNAPSHOT_PACKAGE_ID ||
    source.resourceId !== SNAPSHOT_RESOURCE_ID ||
    source.title !== EXPECTED_TITLE ||
    source.license !== "Creative Commons Attribution" ||
    source.licenseUrl !== "http://www.opendefinition.org/licenses/cc-by" ||
    source.catalogSha256 !== SNAPSHOT_CATALOG_SHA256 ||
    source.catalogBytes !== SNAPSHOT_CATALOG_BYTES ||
    source.csvUrl !== `${BDAP_DUMP}/${SNAPSHOT_PACKAGE_ID}.csv` ||
    source.csvSha256 !== SNAPSHOT_CSV_SHA256 ||
    source.csvBytes !== SNAPSHOT_CSV_BYTES ||
    source.encoding !== "cp1252" ||
    source.delimiter !== ";" ||
    source.quoteChar !== '"' ||
    source.lineEnding !== "CRLF" ||
    source.catalogUrl !== SNAPSHOT_CATALOG_URL ||
    typeof source.observedAt !== "string" ||
    Number.isNaN(Date.parse(source.observedAt))
  ) {
    throw new Error("Snapshot Legge di Bilancio: provenienza sorgente inattesa");
  }
  const series = validateBudgetLawMissionSeries(candidate.series, {
    expectedDataMode: "snapshot",
  });
  if (series.observedAt !== source.observedAt) {
    throw new Error("Snapshot Legge di Bilancio: date di acquisizione non coerenti");
  }
  if (
    series.years.length !== SNAPSHOT_ANNUAL_TOTALS_EUR.size ||
    series.years.some((year) => !SNAPSHOT_ANNUAL_TOTALS_EUR.has(year))
  ) {
    throw new Error("Snapshot Legge di Bilancio: copertura sorgente inattesa");
  }
  for (const year of series.years) {
    const total = series.allocations
      .filter((row) => row.year === year)
      .reduce((sum, row) => sum + row.amountEur, 0);
    if (!Number.isSafeInteger(total) || total !== SNAPSHOT_ANNUAL_TOTALS_EUR.get(year)) {
      throw new Error(`Snapshot Legge di Bilancio: totale ${year} non riconciliato`);
    }
  }
  return {
    schemaVersion: 1,
    source: source as BudgetLawSnapshotArtifact["source"],
    series,
  };
}

function committedBudgetLawSnapshot(requestedWindow: number): BudgetLawMissionSeries {
  const artifact = validateBudgetLawSnapshotArtifact(budgetLawSnapshotArtifact);
  const series = artifact.series;
  return sliceBudgetLawSeries(series, requestedWindow, "snapshot");
}

/** Verified committed series for bounded machine clients that must not start a live CSV refresh. */
export function getCommittedBudgetLawMissionSeries(
  requestedWindow = DEFAULT_BUDGET_LAW_WINDOW_YEARS,
): BudgetLawMissionSeries {
  if (
    !Number.isInteger(requestedWindow)
    || requestedWindow < MIN_BUDGET_LAW_WINDOW_YEARS
    || requestedWindow > MAX_BUDGET_LAW_WINDOW_YEARS
  ) {
    throw new BudgetLawInvalidWindowError(
      `Finestra di anni non valida per la Legge di Bilancio: deve essere tra ${MIN_BUDGET_LAW_WINDOW_YEARS} e ${MAX_BUDGET_LAW_WINDOW_YEARS}`,
    );
  }
  return committedBudgetLawSnapshot(requestedWindow);
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
 *
 * The window is validated up front, before any cache lookup or fetch. The
 * shared population fetch has its own global deadline. A caller's `signal`
 * stops only that caller from waiting: it does not cancel the shared fetch,
 * since other pending requests may depend on it completing.
 */
export async function getBudgetLawMissionSeries(
  options: {
    windowYears?: number;
    signal?: AbortSignal;
    allowSnapshot?: boolean;
    fallbackOnAbort?: boolean;
  } = {},
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
  if (options.signal?.aborted) throw options.signal.reason;

  let aggregate: FullMissionAggregate;
  try {
    aggregate = await waitForAggregate(getFullMissionAggregate(), options.signal);
  } catch (error) {
    if (options.signal?.aborted && !options.fallbackOnAbort) {
      throw options.signal.reason ?? error;
    }
    if (options.allowSnapshot === false) throw error;
    if (!options.signal?.aborted && !isTemporarySourceFailure(error)) throw error;
    return committedBudgetLawSnapshot(requestedWindow);
  }
  const { dataset, acquiredAt, availableYears, missionsByYear, totalsByYearMission } = aggregate;

  const consecutiveYears = latestConsecutiveYears(availableYears);
  if (consecutiveYears.length < MIN_BUDGET_LAW_WINDOW_YEARS) {
    throw new BudgetLawWindowUnavailableError(
      `OpenBDAP non pubblica almeno ${MIN_BUDGET_LAW_WINDOW_YEARS} Leggi di Bilancio consecutive e confrontabili dal ${MIN_STABLE_MISSION_YEAR} in poi.`,
    );
  }

  const years = consecutiveYears.slice(-Math.min(requestedWindow, consecutiveYears.length));
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
    dataMode: "live",
    dataset,
    minStableMissionYear: MIN_STABLE_MISSION_YEAR,
    years,
    missions,
    allocations,
    yearOverYearDeltas,
    observedAt: acquiredAt,
  };
}
