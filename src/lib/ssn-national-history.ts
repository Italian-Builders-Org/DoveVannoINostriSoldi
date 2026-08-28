import { decodePublicDataText, parseDelimitedRows, type DelimitedRecord } from "@/lib/data/delimited";
import {
  isOpenBdapCsvConversionError,
  OpenBdapUnavailableError,
} from "@/lib/data/openbdap-response";
import { fetchOfficialSource } from "@/lib/data/source-fetch";
import { SSN_CCE_METRICS, type SsnCceMetricId, type SsnCceValues } from "@/lib/data/ssn-cce-contract";

const BDAP_BASE = "https://bdap-opendata.rgs.mef.gov.it";
const BDAP_ACTION = `${BDAP_BASE}/SpodCkanApi/api/3/action`;
const BDAP_DUMP = `${BDAP_BASE}/SpodCkanApi/api/3/datastore/dump`;
const PACKAGE_TITLE_QUERY = "Modello di rilevazione del Conto Economico degli enti del SSN a livello Nazionale";
const PACKAGE_NAME_PATTERN = /^spd_ssn_cce_naz_voccn_01_(\d{4})$/;
const NATIONAL_HISTORY_SOURCE_OWNER = "Ragioneria Generale dello Stato";
const NATIONAL_HISTORY_SOURCE_PLATFORM = "OpenBDAP";
const NATIONAL_HISTORY_LICENSE = "Creative Commons Attribution";
const NATIONAL_HISTORY_LICENSE_URLS = new Set([
  "http://www.opendefinition.org/licenses/cc-by",
  "https://creativecommons.org/licenses/by/3.0/",
]);

export const SSN_NATIONAL_HISTORY_MAX_CONCURRENCY = 3;
/**
 * OpenBDAP can take longer than 25 seconds for the 13-year live read. Keep a 50-second
 * adapter budget under the route's 60-second maxDuration so the request still has headroom
 * for response serialization while bounded workers stop all in-flight fetches at the deadline.
 */
export const SSN_NATIONAL_HISTORY_DEADLINE_MS = 50_000;

/**
 * The national CSV is intentionally a small, strict contract. Keeping the header list
 * here means a renamed/reordered column cannot silently turn into an all-empty record.
 */
export const SSN_NATIONAL_HISTORY_COLUMNS = Object.freeze([
  "Anno di Riferimento",
  "Codice Voce Contabile",
  "Descrizione Voce Contabile",
  "Data Aggiornamento",
  "Importo Totale",
] as const);

/**
 * Official voice code for each already-defined SSN_CCE metric, reused as-is from the
 * single-year snapshot (src/lib/data/ssn-cce-contract.ts) so this trend cannot drift
 * from the meaning already documented and shown on /spese/sanita.
 */
const METRIC_CODE: Readonly<Record<SsnCceMetricId, string>> = {
  productionCosts: "BZ9999",
  personnelCost: "BA2080",
  healthcareWorkServices: "BA1350",
  nonHealthcareWorkServices: "BA1750",
  purchasedServices: "BA0390",
};

const METRIC_DESCRIPTION: Readonly<Record<SsnCceMetricId, string>> = {
  productionCosts: "Totale costi della produzione (B)",
  personnelCost: "Totale Costo del personale",
  healthcareWorkServices:
    "B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie",
  nonHealthcareWorkServices:
    "B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie",
  purchasedServices: "B.2) Acquisti di servizi",
};

/**
 * Calendar years verified live (package_search against OpenBDAP RGS, 23/08/2026) to have
 * a national-level consuntivo release with a stable schema: same 5 voice codes, same
 * descriptions, on 2012, 2018 and 2024. Extending this range requires re-verifying that a
 * new year's package exists and still uses the same voice codes before trusting it here.
 */
export const SSN_NATIONAL_HISTORY_YEARS = Object.freeze(
  Array.from({ length: 2024 - 2012 + 1 }, (_, index) => 2012 + index),
);

type PackageSearchResult = {
  id?: unknown;
  name?: unknown;
  metadata_modified?: unknown;
  license_id?: unknown;
  license_title?: unknown;
  license_url?: unknown;
};

type PackageSearchResponse = {
  success: boolean;
  result?: { results: PackageSearchResult[] };
};

type NationalPackage = {
  year: number;
  packageId: string;
  packageName: string;
  packageUrl: string;
  csvUrl: string;
  metadataModified: string;
  license: string;
  licenseUrl: string;
};

type SourceFetcher = typeof fetchOfficialSource;

export type SsnNationalHistoryOptions = {
  signal?: AbortSignal;
  /** A short-lived test seam; production callers use the shared source fetcher. */
  fetchSource?: SourceFetcher;
  /** Override the default request deadline for deterministic adapter tests. */
  deadlineMs?: number;
  /** Pin the observation clock in tests without changing source data. */
  now?: Date;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Operazione annullata");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

/**
 * A caller signal must stop the adapter even when a test double or a platform fetch wrapper
 * does not promptly reject its own promise. The underlying fetch still receives the signal,
 * so native fetch also releases the socket and response body.
 */
async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function metadataTimestamp(value: unknown, label: string): string {
  const candidate = text(value);
  if (!candidate || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(candidate)) {
    throw new Error(`${label} non valida`);
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} non valida`);
  return candidate;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function packageFromSearchResult(pkg: PackageSearchResult, year: number): NationalPackage {
  const packageId = text(pkg.id);
  const packageName = text(pkg.name);
  if (!packageId || !packageName) {
    throw new Error(`Metadati package OpenBDAP incompleti per il ${year}`);
  }
  const expectedName = `spd_ssn_cce_naz_voccn_01_${year}`;
  if (packageName !== expectedName) {
    throw new Error(`Nome package OpenBDAP inatteso per il ${year}`);
  }

  const metadataModified = metadataTimestamp(
    pkg.metadata_modified,
    `metadata_modified del package ${packageId}`,
  );
  const license = text(pkg.license_title);
  if (license !== NATIONAL_HISTORY_LICENSE) {
    throw new Error(`Licenza OpenBDAP inattesa per il package ${packageId}`);
  }
  const licenseId = text(pkg.license_id);
  if (licenseId !== "cc-by") {
    throw new Error(`license_id OpenBDAP inatteso per il package ${packageId}`);
  }
  const declaredLicenseUrl = text(pkg.license_url);
  if (!declaredLicenseUrl || !NATIONAL_HISTORY_LICENSE_URLS.has(declaredLicenseUrl)) {
    throw new Error(`license_url OpenBDAP inatteso per il package ${packageId}`);
  }

  return {
    year,
    packageId,
    packageName,
    packageUrl: `${BDAP_ACTION}/package_show?id=${encodeURIComponent(packageId)}`,
    csvUrl: `${BDAP_DUMP}/${encodeURIComponent(packageId)}.csv?download=1`,
    metadataModified,
    license,
    licenseUrl: declaredLicenseUrl,
  };
}

/**
 * Discovers each year's package metadata in one CKAN call and builds its CSV dump URL from
 * the official package id. Resource URLs are deliberately not trusted: some OpenBDAP
 * packages declare a CSV resource whose MIME type is actually PDF. `download=1` is accepted
 * by the dump endpoint, while the response is still checked for status, content type and CSV
 * schema before any values are used.
 */
async function discoverNationalPackages(
  fetchSource: SourceFetcher,
  signal: AbortSignal,
): Promise<Map<number, NationalPackage>> {
  const url = `${BDAP_ACTION}/package_search?${new URLSearchParams({
    q: PACKAGE_TITLE_QUERY,
    rows: "100",
  }).toString()}`;
  const response = await withAbort(
    Promise.resolve().then(() => fetchSource("openbdap", url, {
      kind: "discovery",
      signal,
      headers: { Accept: "application/json" },
      tags: ["dataset:ssn-cce-national-history"],
    })),
    signal,
  );
  if (!response.ok) throw new Error(`OpenBDAP package_search HTTP ${response.status}`);

  const payload = await withAbort(response.json() as Promise<PackageSearchResponse>, signal);
  if (!payload.success || !Array.isArray(payload.result?.results)) {
    throw new Error("Risposta package_search OpenBDAP non valida");
  }

  const byYear = new Map<number, NationalPackage>();
  for (const pkg of payload.result.results) {
    const packageName = text(pkg.name);
    const match = packageName ? PACKAGE_NAME_PATTERN.exec(packageName) : null;
    if (!match) continue;
    const year = Number(match[1]);
    if (!SSN_NATIONAL_HISTORY_YEARS.includes(year)) continue;
    if (byYear.has(year)) {
      throw new Error(`OpenBDAP pubblica più pacchetti per il Conto Economico SSN nazionale ${year}`);
    }
    byYear.set(year, packageFromSearchResult(pkg, year));
  }
  return byYear;
}

/**
 * Parses a euro amount string into integer cents using string/integer arithmetic only
 * (never a float multiply-and-round), matching the exact-cents guarantee the Python ETL
 * enforces for the single-year SSN snapshot (scripts/etl/ssn_cce_snapshot.py) via
 * Decimal(value * 100).to_integral_exact(). Keeping the same unit lets this trend reuse
 * the existing SsnCceValues type and the page's cents-to-euro formatter unmodified.
 */
function amountCents(record: DelimitedRecord): number {
  const raw = record["Importo Totale"]?.trim();
  if (!raw) throw new Error("Importo SSN mancante");
  const match = /^(-?\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error(`Importo SSN non numerico o con precisione inattesa: "${raw}"`);
  const [, integerPart, decimalPart = ""] = match;
  const cents = Number(`${integerPart}${decimalPart.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) throw new Error(`Importo SSN fuori range: "${raw}"`);
  return cents;
}

function sourceDate(value: unknown): string {
  const raw = text(value);
  const match = raw?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error("Data Aggiornamento non valida");
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error("Data Aggiornamento non valida");
  }
  return `${year}-${month}-${day}`;
}

function assertNationalHeaders(headers: readonly string[]): void {
  if (
    headers.length !== SSN_NATIONAL_HISTORY_COLUMNS.length ||
    headers.some((header, index) => header !== SSN_NATIONAL_HISTORY_COLUMNS[index]) ||
    new Set(headers).size !== headers.length
  ) {
    throw new Error("Header CSV del Conto Economico SSN nazionale divergente dallo schema atteso");
  }
}

function recordsFromNationalCsv(input: string): DelimitedRecord[] {
  const parsedRows = parseDelimitedRows(input);
  const parsedHeaders = parsedRows[0] ?? [];
  const hasTrailingEmptyColumn =
    parsedHeaders.length === SSN_NATIONAL_HISTORY_COLUMNS.length + 1 &&
    parsedHeaders.at(-1) === "" &&
    parsedRows.slice(1).every(
      (values) => values.length === parsedHeaders.length && values.at(-1) === "",
    );
  const rows = hasTrailingEmptyColumn
    ? parsedRows.map((values) => values.slice(0, -1))
    : parsedRows;
  const headers = rows[0] ?? [];
  assertNationalHeaders(headers);
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`Riga CSV SSN nazionale ${rowIndex + 2} con numero colonne inatteso`);
    }
    const record: DelimitedRecord = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

type ParsedNationalRows = {
  values: SsnCceValues;
  dataUpdatedAt: string;
  sourceDescriptions: Record<string, string>;
};

function parseNationalRows(rows: DelimitedRecord[], year: number): ParsedNationalRows {
  const expectedKeys = [...SSN_NATIONAL_HISTORY_COLUMNS].sort().join("\u0000");
  const byCode = new Map<string, DelimitedRecord>();
  const updatedAtByCode = new Map<string, string>();
  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      throw new Error("Schema CSV del Conto Economico SSN nazionale non valido");
    }
    if (Object.keys(row).sort().join("\u0000") !== expectedKeys) {
      throw new Error("Schema CSV del Conto Economico SSN nazionale divergente");
    }

    const rowYear = row["Anno di Riferimento"]?.trim();
    if (rowYear !== String(year)) {
      throw new Error(`Anno di Riferimento "${rowYear}" incoerente con il rilascio ${year} richiesto`);
    }
    const updatedAt = sourceDate(row["Data Aggiornamento"]);
    const code = row["Codice Voce Contabile"]?.trim();
    if (!code) throw new Error(`Codice Voce Contabile mancante nel rilascio ${year}`);
    if (byCode.has(code)) {
      throw new Error(`Voce ${code} duplicata nel Conto Economico SSN nazionale ${year}`);
    }
    byCode.set(code, row);
    updatedAtByCode.set(code, updatedAt);
  }

  const values = {} as SsnCceValues;
  const sourceDescriptions: Record<string, string> = {};
  const metricDates = new Set<string>();
  for (const metricId of SSN_CCE_METRICS) {
    const code = METRIC_CODE[metricId];
    const row = byCode.get(code);
    if (!row) throw new Error(`Voce ${code} assente nel Conto Economico SSN nazionale ${year}`);
    const rawDescription = row["Descrizione Voce Contabile"]?.trim();
    if (!rawDescription || normalizeWhitespace(rawDescription) !== METRIC_DESCRIPTION[metricId]) {
      throw new Error(`Descrizione Voce Contabile divergente per ${code} nel rilascio ${year}`);
    }
    sourceDescriptions[code] = rawDescription;
    metricDates.add(updatedAtByCode.get(code)!);
    values[metricId] = amountCents(row);
  }
  if (metricDates.size !== 1) {
    throw new Error(`Data Aggiornamento incoerente nel Conto Economico SSN nazionale ${year}`);
  }
  return {
    values,
    dataUpdatedAt: [...metricDates][0],
    sourceDescriptions,
  };
}

/**
 * Pure parsing step, kept separate from the network fetch so the duplicate-detection and
 * amount-parsing guardrails are unit-testable with synthetic rows, not only exercised
 * incidentally by however the live 2012-2024 data happens to be shaped today.
 */
export function nationalValuesFromRows(rows: DelimitedRecord[], year: number): SsnCceValues {
  return parseNationalRows(rows, year).values;
}

async function fetchNationalYear(
  pkg: NationalPackage,
  signal: AbortSignal,
  fetchSource: SourceFetcher,
): Promise<ParsedNationalRows> {
  const response = await withAbort(
    Promise.resolve().then(() => fetchSource("openbdap", pkg.csvUrl, {
      kind: "data",
      signal,
      headers: { Accept: "text/csv" },
      tags: ["dataset:ssn-cce-national-history", `year:${pkg.year}`],
    })),
    signal,
  );
  if (!response.ok) throw new Error(`OpenBDAP CSV HTTP ${response.status} per l'anno ${pkg.year}`);
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  const payload = await withAbort(response.arrayBuffer(), signal);
  const textPayload = decodePublicDataText(payload);
  // A 200 JSON error from the dump endpoint must never be parsed as a partial dataset.
  if (isOpenBdapCsvConversionError(textPayload)) {
    throw new OpenBdapUnavailableError(
      `OpenBDAP non ha reso disponibile il CSV per l'anno ${pkg.year}`,
    );
  }
  if (textPayload.trimStart().startsWith("{") || textPayload.trimStart().startsWith("[")) {
    throw new Error(`OpenBDAP ha restituito un errore JSON invece del CSV per l'anno ${pkg.year}`);
  }
  if (!contentType.includes("csv") && !contentType.includes("text/plain")) {
    throw new Error(`OpenBDAP non ha restituito un CSV per l'anno ${pkg.year}`);
  }
  const rows = recordsFromNationalCsv(textPayload);
  return parseNationalRows(rows, pkg.year);
}

export type SsnNationalHistoryYear = {
  year: number;
  values: SsnCceValues;
  provenance: {
    packageId: string;
    packageName: string;
    packageUrl: string;
    csvUrl: string;
    sourceDate: string;
    metadataModified: string;
    dataUpdatedAt: string;
    sourceDescriptions: Record<string, string>;
    observedAt: string;
    license: string;
    licenseUrl: string;
  };
};

export type SsnNationalHistory = {
  years: SsnNationalHistoryYear[];
  source: {
    owner: string;
    platform: string;
    landingUrl: string;
    observedAt: string;
    license: string;
    licenseUrl: string;
  };
};

async function mapBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const failure = new AbortController();
  const workSignal = AbortSignal.any([signal, failure.signal]);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      throwIfAborted(workSignal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], workSignal);
      } catch (error) {
        if (!failure.signal.aborted) failure.abort(error);
        throw error;
      }
    }
  };

  const workerCount = Math.min(Math.max(1, Math.trunc(concurrency)), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

/**
 * National-only SSN Conto Economico trend across SSN_NATIONAL_HISTORY_YEARS, fetched live
 * from OpenBDAP (not a locked snapshot like the single-year entity/regional detail). Reuses
 * the same 5 metrics already shown on /spese/sanita; does not touch that page's regional or
 * per-entity data, which remain limited to 2024.
 */
export async function getSsnNationalHistory(
  options: SsnNationalHistoryOptions = {},
): Promise<SsnNationalHistory> {
  const requestedDeadline = options.deadlineMs ?? SSN_NATIONAL_HISTORY_DEADLINE_MS;
  if (!Number.isFinite(requestedDeadline) || requestedDeadline <= 0) {
    throw new Error("Deadline serie storica SSN non valida");
  }
  const deadline = AbortSignal.timeout(Math.trunc(requestedDeadline));
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const observedAt = (options.now ?? new Date()).toISOString();
  const fetchSource = options.fetchSource ?? fetchOfficialSource;

  throwIfAborted(signal);
  const packages = await discoverNationalPackages(fetchSource, signal);
  const missingYears = SSN_NATIONAL_HISTORY_YEARS.filter((year) => !packages.has(year));
  if (missingYears.length > 0) {
    throw new Error(`OpenBDAP non pubblica il Conto Economico SSN nazionale per il/i ${missingYears.join(", ")}`);
  }

  const years = await mapBounded(
    SSN_NATIONAL_HISTORY_YEARS,
    SSN_NATIONAL_HISTORY_MAX_CONCURRENCY,
    signal,
    async (year, workSignal) => {
      const pkg = packages.get(year);
      if (!pkg) throw new Error(`OpenBDAP non pubblica il Conto Economico SSN nazionale per il ${year}`);
      const parsed = await fetchNationalYear(pkg, workSignal, fetchSource);
      return {
        year,
        values: parsed.values,
        provenance: {
          packageId: pkg.packageId,
          packageName: pkg.packageName,
          packageUrl: pkg.packageUrl,
          csvUrl: pkg.csvUrl,
          sourceDate: pkg.metadataModified.slice(0, 10),
          metadataModified: pkg.metadataModified,
          dataUpdatedAt: parsed.dataUpdatedAt,
          sourceDescriptions: parsed.sourceDescriptions,
          observedAt,
          license: pkg.license,
          licenseUrl: pkg.licenseUrl,
        },
      } satisfies SsnNationalHistoryYear;
    },
  );

  return {
    years,
    source: {
      owner: NATIONAL_HISTORY_SOURCE_OWNER,
      platform: NATIONAL_HISTORY_SOURCE_PLATFORM,
      landingUrl: "https://bdap-opendata.rgs.mef.gov.it",
      observedAt,
      license: NATIONAL_HISTORY_LICENSE,
      licenseUrl: years[0]?.provenance.licenseUrl ?? "",
    },
  };
}
