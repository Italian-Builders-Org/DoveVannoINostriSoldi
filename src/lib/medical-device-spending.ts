import "server-only";

import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { canonicalJson, sha256Hex } from "@/lib/integrated-source-contract";

const ROOT = "src/data/generated/medical-device-spending-index";
const META_PATH = join(ROOT, "meta.json");
const CATALOG_PATH = "src/data/generated/integrated/catalog.json";
const SOURCE_SPEC_PATH = "scripts/etl/specs/medical-device-spending-pilot.source.json";
const SHA256 = /^[a-f0-9]{64}$/;
const DEVICE_REF = /^dm-[a-f0-9]{20}$/;
const DEVICE_NUMBER = /^\d+$/;
const MONEY = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
const MAX_META_BYTES = 512 * 1024;
const MAX_SEARCH_BYTES = 64 * 1024 * 1024;
const MAX_SEARCH_OUTPUT = 128 * 1024 * 1024;
const MAX_BLOCK_OUTPUT = 32 * 1024 * 1024;
const MAX_RECORDS = 250_000;
const MAX_FACT_SCAN = 100_000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MAX_CURSOR = 512;
const MAX_QUERY = 120;
const CACHE_BLOCKS = 8;

const MEDICAL_REGION_NAMES: Readonly<Record<string, string>> = {
  "10": "Piemonte", "20": "Valle d’Aosta", "30": "Lombardia",
  "41": "P.A. Bolzano", "42": "P.A. Trento", "50": "Veneto",
  "60": "Friuli-Venezia Giulia", "70": "Liguria", "80": "Emilia-Romagna",
  "90": "Toscana", "100": "Umbria", "110": "Marche", "120": "Lazio",
  "130": "Abruzzo", "140": "Molise", "150": "Campania", "160": "Puglia",
  "170": "Basilicata", "180": "Calabria", "190": "Sicilia", "200": "Sardegna",
};

export function medicalDeviceRegionName(code: string): string {
  const lookupCode = code.replace(/^0+(?=\d)/, "");
  return MEDICAL_REGION_NAMES[lookupCode] ?? `Codice ${code}`;
}

export function medicalDeviceRegionLabel(code: string): string {
  const name = medicalDeviceRegionName(code);
  return name === `Codice ${code}` ? name : `${name} · ${code}`;
}

export class MedicalDeviceQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MedicalDeviceQueryError";
  }
}

export type MedicalDeviceCoverage = Readonly<{
  rows: number;
  spending: string;
  negativeRows: number;
  zeroRows: number;
  matchedRows: number;
  matchedSpending: string;
  unresolvedRows: number;
  unresolvedSpending: string;
}>;

export type MedicalDeviceSearchHit = Readonly<{
  schemaVersion: 1;
  ref: string;
  type: "1" | "2";
  number: string;
  registryRecordId: string | null;
  name: string | null;
  catalog: string | null;
  manufacturer: string | null;
  role: "fabbricante" | "assemblatore" | null;
  classification: string | null;
  classificationLabel: string | null;
  searchKey: string;
  scopes: readonly number[];
  years: Readonly<Record<string, Readonly<{ rows: number; spending: string }>>>;
}>;

type Block = Readonly<{ key: string; offset: number; bytes: number; rawBytes: number; sha256: string }>;
type DetailBlock = Block & Readonly<{ records: number; facts: number }>;
type Scope = Block & Readonly<{
  year: number;
  region: string | null;
  company: string | null;
  companyName: string | null;
  companyNames?: readonly string[];
}>;
type SearchCandidate = Pick<MedicalDeviceSearchHit, "schemaVersion" | "ref" | "type" | "number" | "searchKey" | "scopes" | "years">;
type Meta = Readonly<{
  schemaVersion: 1;
  dataset: "salute-spesa-dispositivi-index";
  registrySnapshotDate: string;
  sourceSpecSha256: string;
  corpusCatalogSha256: string;
  coverage: Readonly<{ devicesWithSpending: number; matchedDevices: number; unresolvedDevices: number; facts: number }>;
  search: Readonly<{ path: string; bytes: number; rawBytes: number; sha256: string; records: number }>;
  details: Readonly<{ path: string; bytes: number; sha256: string; blocks: readonly DetailBlock[] }>;
  aggregates: Readonly<{ path: string; bytes: number; sha256: string; scopes: readonly Scope[] }>;
  contract: Readonly<Record<string, unknown>>;
}>;

export type MedicalDeviceFact = Readonly<{
  datasetId: string;
  sourceRow: number;
  year: number;
  region: string;
  company: string;
  companyName: string;
  sourceClassification: string;
  spending: string;
  joinStatus: "matched" | "not_found";
}>;

type Detail = Omit<MedicalDeviceSearchHit, "searchKey" | "scopes" | "years"> & Readonly<{
  facts: readonly MedicalDeviceFact[];
}>;

export type MedicalDeviceAggregate = Readonly<{
  code: string | null;
  label: string | null;
  labels: readonly string[];
  role: "fabbricante" | "assemblatore" | null;
  rows: number;
  spending: string;
  negativeRows: number;
  zeroRows: number;
  matchedRows: number;
  unresolvedRows: number;
}>;

export type MedicalDeviceFilterOptions = Readonly<{
  registrySnapshotDate: string;
  years: readonly Readonly<{
    year: number;
    regions: readonly Readonly<{
      code: string;
      companies: readonly Readonly<{ code: string; names: readonly string[] }> [];
    }>[];
  }>[];
}>;

type ScopePayload = Readonly<{
  schemaVersion: 1;
  scope: Scope;
  coverage: MedicalDeviceCoverage;
  territories: readonly MedicalDeviceAggregate[];
  classifications: readonly MedicalDeviceAggregate[];
  manufacturers: readonly MedicalDeviceAggregate[];
}>;

let cachedMeta: Meta | null = null;
let cachedSearchBytes: Buffer | null = null;
const detailCache = new Map<string, readonly Detail[]>();
const aggregateCache = new Map<string, ScopePayload>();

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}: intero non valido`);
  }
  return value;
}

function text(value: unknown, label: string, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${label}: testo non valido`);
  return value;
}

function money(value: unknown, label: string): string {
  if (typeof value !== "string" || !MONEY.test(value)) throw new Error(`${label}: importo non valido`);
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label}: SHA-256 non valido`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: oggetto non valido`);
  return value as Record<string, unknown>;
}

function stableBytes(path: string, maximum: number, expectedBytes?: number): Buffer {
  const descriptor = openSync(path, "r");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maximum || (expectedBytes !== undefined && before.size !== expectedBytes)) {
      throw new Error(`File indice non valido: ${path}`);
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error(`File indice incompleto: ${path}`);
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
      throw new Error(`File indice cambiato durante la lettura: ${path}`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function validateBlock(value: unknown, label: string): Block {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: blocco non valido`);
  const row = value as Record<string, unknown>;
  return { key: text(row.key, `${label}.key`, 120)!, offset: integer(row.offset, `${label}.offset`),
    bytes: integer(row.bytes, `${label}.bytes`), rawBytes: integer(row.rawBytes, `${label}.rawBytes`),
    sha256: sha(row.sha256, `${label}.sha256`) };
}

function validatePacked(blocks: readonly Block[], totalBytes: number, label: string): void {
  let offset = 0;
  for (const block of blocks) {
    if (block.offset !== offset || block.bytes <= 0 || block.rawBytes > MAX_BLOCK_OUTPUT) {
      throw new Error(`${label}: disposizione dei blocchi non valida`);
    }
    offset += block.bytes;
  }
  if (offset !== totalBytes) throw new Error(`${label}: dimensione complessiva non valida`);
}

function loadMeta(): Meta {
  if (cachedMeta) return cachedMeta;
  const raw = stableBytes(META_PATH, MAX_META_BYTES);
  const value = record(JSON.parse(raw.toString("utf8")), "meta");
  if (value.schemaVersion !== 1 || value.dataset !== "salute-spesa-dispositivi-index") {
    throw new Error("Metadati indice dispositivi non validi");
  }
  const searchValue = record(value.search, "search");
  const detailsValue = record(value.details, "details");
  const aggregatesValue = record(value.aggregates, "aggregates");
  const search = { path: text(searchValue.path, "search.path", 100)!, bytes: integer(searchValue.bytes, "search.bytes"),
    rawBytes: integer(searchValue.rawBytes, "search.rawBytes"), sha256: sha(searchValue.sha256, "search.sha256"),
    records: integer(searchValue.records, "search.records") };
  if (search.path !== "search.jsonl.gz" || detailsValue.path !== "details.jsonl.gz"
      || aggregatesValue.path !== "aggregates.json.gz") throw new Error("Percorsi indice non validi");
  if (search.bytes > MAX_SEARCH_BYTES || search.rawBytes > MAX_SEARCH_OUTPUT || search.records > MAX_RECORDS) {
    throw new Error("Budget indice di ricerca superato");
  }
  if (!Array.isArray(detailsValue.blocks) || !Array.isArray(aggregatesValue.scopes)) throw new Error("Blocchi indice non validi");
  const details = detailsValue.blocks.map((value, index) => {
    const row = record(value, `details[${index}]`);
    return { ...validateBlock(row, `details[${index}]`), records: integer(row.records, "details.records"),
      facts: integer(row.facts, "details.facts") };
  });
  if (details.length !== 256 || details.some((block, index) => block.key !== index.toString(16).padStart(2, "0"))) {
    throw new Error("Partizioni dettaglio non valide");
  }
  const scopes = aggregatesValue.scopes.map((value, index) => {
    const row = record(value, `scopes[${index}]`);
    const block = validateBlock(row, `scopes[${index}]`);
    const year = integer(row.year, `scopes[${index}].year`);
    if (year < 2000 || year > 2100) throw new Error("Anno del perimetro non valido");
    return { ...block, year, region: text(row.region, "scope.region", 20, true),
      company: text(row.company, "scope.company", 40, true), companyName: text(row.companyName, "scope.companyName", 500, true),
      companyNames: Array.isArray(row.companyNames) ? row.companyNames.map((item) => text(item, "scope.companyNames", 500)!) : undefined };
  });
  const coverage = value.coverage as Record<string, unknown>;
  const meta: Meta = { schemaVersion: 1, dataset: value.dataset,
    registrySnapshotDate: text(value.registrySnapshotDate, "registrySnapshotDate", 10)!,
    sourceSpecSha256: sha(value.sourceSpecSha256, "sourceSpecSha256"),
    corpusCatalogSha256: sha(value.corpusCatalogSha256, "corpusCatalogSha256"),
    coverage: { devicesWithSpending: integer(coverage.devicesWithSpending, "devicesWithSpending"),
      matchedDevices: integer(coverage.matchedDevices, "matchedDevices"),
      unresolvedDevices: integer(coverage.unresolvedDevices, "unresolvedDevices"), facts: integer(coverage.facts, "facts") },
    search,
    details: { path: text(detailsValue.path, "details.path", 100)!, bytes: integer(detailsValue.bytes, "details.bytes"),
      sha256: sha(detailsValue.sha256, "details.sha256"), blocks: details },
    aggregates: { path: text(aggregatesValue.path, "aggregates.path", 100)!, bytes: integer(aggregatesValue.bytes, "aggregates.bytes"),
      sha256: sha(aggregatesValue.sha256, "aggregates.sha256"), scopes }, contract: record(value.contract, "contract") };
  if (meta.coverage.matchedDevices + meta.coverage.unresolvedDevices !== meta.coverage.devicesWithSpending
      || search.records !== meta.coverage.devicesWithSpending) throw new Error("Copertura indice incoerente");
  if (meta.details.blocks.reduce((sum, block) => sum + block.records, 0) !== meta.coverage.devicesWithSpending
      || meta.details.blocks.reduce((sum, block) => sum + block.facts, 0) !== meta.coverage.facts) {
    throw new Error("Copertura dei blocchi di dettaglio incoerente");
  }
  validatePacked(meta.details.blocks, meta.details.bytes, "details");
  validatePacked(meta.aggregates.scopes, meta.aggregates.bytes, "aggregates");
  const catalog = readFileSync(CATALOG_PATH);
  if (createHash("sha256").update(catalog).digest("hex") !== meta.corpusCatalogSha256) {
    throw new Error("Indice dispositivi non allineato al catalogo integrato");
  }
  if (createHash("sha256").update(readFileSync(SOURCE_SPEC_PATH)).digest("hex") !== meta.sourceSpecSha256) {
    throw new Error("Indice dispositivi non allineato al source lock");
  }
  cachedMeta = meta;
  return meta;
}

function validateSearchCandidate(value: unknown): SearchCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Record ricerca non valido");
  const row = record(value, "search");
  if (row.schemaVersion !== 1 || typeof row.ref !== "string" || !DEVICE_REF.test(row.ref)
      || (row.type !== "1" && row.type !== "2") || typeof row.number !== "string" || !DEVICE_NUMBER.test(row.number)) {
    throw new Error("Identità dispositivo non valida");
  }
  const years: Record<string, { rows: number; spending: string }> = {};
  for (const [year, summary] of Object.entries(record(row.years, "years"))) {
    if (!/^20\d{2}$/.test(year) || !summary || typeof summary !== "object") throw new Error("Anno ricerca non valido");
    const summaryRecord = record(summary, "years.summary");
    years[year] = { rows: integer(summaryRecord.rows, "years.rows"), spending: money(summaryRecord.spending, "years.spending") };
  }
  if (!Array.isArray(row.scopes)) throw new Error("Perimetri di ricerca non validi");
  const scopes = row.scopes.map((scope) => integer(scope, "scope"));
  return { schemaVersion: 1, ref: row.ref, type: row.type, number: row.number,
    searchKey: text(row.searchKey, "searchKey", 7000)!, scopes, years };
}

function loadSearchBytes(): Buffer {
  if (cachedSearchBytes) return cachedSearchBytes;
  const meta = loadMeta();
  const compressed = stableBytes(join(ROOT, meta.search.path), MAX_SEARCH_BYTES, meta.search.bytes);
  if (createHash("sha256").update(compressed).digest("hex") !== meta.search.sha256) throw new Error("SHA-256 ricerca divergente");
  const raw = gunzipSync(compressed, { maxOutputLength: MAX_SEARCH_OUTPUT });
  if (raw.length !== meta.search.rawBytes) throw new Error("Dimensione ricerca divergente");
  cachedSearchBytes = raw;
  return raw;
}

function readBlock(path: string, totalBytes: number, block: Block): Buffer {
  if (block.rawBytes > MAX_BLOCK_OUTPUT || block.bytes <= 0 || block.offset + block.bytes > totalBytes) {
    throw new Error("Budget blocco indice non valido");
  }
  const descriptor = openSync(join(ROOT, path), "r");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size !== totalBytes) throw new Error("File blocchi indice non allineato");
    const bytes = Buffer.alloc(block.bytes);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(descriptor, bytes, read, bytes.length - read, block.offset + read);
      if (!count) throw new Error("Blocco indice incompleto");
      read += count;
    }
    const after = fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("Indice cambiato durante la lettura");
    if (createHash("sha256").update(bytes).digest("hex") !== block.sha256) throw new Error("SHA-256 blocco divergente");
    const raw = gunzipSync(bytes, { maxOutputLength: MAX_BLOCK_OUTPUT });
    if (raw.length !== block.rawBytes) throw new Error("Dimensione blocco divergente");
    return raw;
  } finally {
    closeSync(descriptor);
  }
}

function normalized(value: string): string {
  return value.normalize("NFKD").toUpperCase().replace(/[^0-9A-Z]+/g, "");
}

function optionalString(value: unknown, label: string, pattern?: RegExp, maximum = MAX_QUERY): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) || typeof value !== "string" || value.length > maximum || (pattern && !pattern.test(value))) {
    throw new MedicalDeviceQueryError(`Il parametro ${label} non è valido.`);
  }
  return value;
}

function limit(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_LIMIT;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw new MedicalDeviceQueryError(`limit deve essere compreso tra 1 e ${MAX_LIMIT}.`);
  return parsed;
}

function filterHash(value: object): string {
  return sha256Hex(canonicalJson(value));
}

function totalSpending(hit: SearchCandidate): bigint {
  return Object.values(hit.years).reduce((sum, item) => sum + moneyCents(item.spending), BigInt(0));
}

function moneyCents(value: string): bigint {
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(whole.startsWith("-") ? `-${fraction}` : fraction);
}

function euroFromCents(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const magnitude = value < BigInt(0) ? -value : value;
  return `${sign}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
}

function catalogHref(datasetId: string, number: string): string {
  return `/dati/${datasetId}?${new URLSearchParams({ q: number, limit: "100" })}`;
}

function pageStart(cursor: unknown, hash: string, meta: Meta): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  if (typeof cursor !== "string" || cursor.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new MedicalDeviceQueryError("cursor non valido.");
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error();
    const value = JSON.parse(bytes.toString("utf8"));
    if (canonicalJson(value) !== bytes.toString("utf8") || value.v !== 1 || value.filter !== hash
        || value.source !== meta.sourceSpecSha256 || !Number.isSafeInteger(value.next) || value.next < 1) throw new Error();
    return value.next;
  } catch {
    throw new MedicalDeviceQueryError("cursor non valido o riferito a un altro filtro.");
  }
}

function nextCursor(next: number, total: number, hash: string, meta: Meta): string | null {
  return next < total ? Buffer.from(canonicalJson({ filter: hash, next, source: meta.sourceSpecSha256, v: 1 })).toString("base64url") : null;
}

function scope(meta: Meta, year: number, region: string | null, company: string | null): Scope {
  const key = [year, region, company].filter((value) => value !== null).join(":");
  const found = meta.aggregates.scopes.find((candidate) => candidate.key === key);
  if (!found) throw new MedicalDeviceQueryError("Il territorio richiesto non è presente nei dati pubblicati.");
  return found;
}

function assertSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Operazione annullata", "AbortError");
}

export async function searchMedicalDevices(input: Readonly<{
  q?: unknown; type?: unknown; year?: unknown; region?: unknown; company?: unknown;
  limit?: unknown; cursor?: unknown; signal?: AbortSignal;
}> = {}) {
  const meta = loadMeta();
  const query = optionalString(input.q, "q")?.trim() ?? "";
  const folded = normalized(query);
  if (!query) throw new MedicalDeviceQueryError("q è obbligatorio per la ricerca dei dispositivi.");
  if (folded.length < (DEVICE_NUMBER.test(folded) ? 1 : 2)) throw new MedicalDeviceQueryError("q è troppo breve.");
  const type = optionalString(input.type, "tipo", /^[12]$/) as "1" | "2" | null;
  const yearText = optionalString(input.year, "anno", /^20\d{2}$/);
  const year = yearText === null ? null : Number(yearText);
  const region = optionalString(input.region, "regione", /^\d+$/);
  const company = optionalString(input.company, "azienda", /^\d+$/);
  if (region !== null && year === null) throw new MedicalDeviceQueryError("regione richiede anno.");
  if (company !== null && region === null) throw new MedicalDeviceQueryError("azienda richiede anno e regione.");
  const selectedScope = year !== null && region !== null ? scope(meta, year, region, company) : null;
  const selectedScopeIds = selectedScope === null ? null : company !== null
    ? new Set([meta.aggregates.scopes.indexOf(selectedScope)])
    : new Set(meta.aggregates.scopes.map((item, index) => item.year === year && item.region === region && item.company !== null ? index : -1).filter((index) => index >= 0));
  assertSignal(input.signal);
  const matches: SearchCandidate[] = [];
  const raw = loadSearchBytes();
  let position = 0;
  let scanned = 0;
  while (position < raw.length) {
    const end = raw.indexOf(0x0a, position);
    if (end < 0) throw new Error("Indice ricerca senza terminatore finale");
    if ((scanned++ & 4095) === 0) {
      await setImmediate();
      assertSignal(input.signal);
    }
    const line = raw.toString("utf8", position, end);
    position = end + 1;
    if (!line.includes(folded)) continue;
    const hit = validateSearchCandidate(JSON.parse(line));
    if (hit.scopes.some((id) => id >= meta.aggregates.scopes.length)) throw new Error("Scope ricerca fuori indice");
    if (type !== null && hit.type !== type) continue;
    if (year !== null && hit.years[String(year)] === undefined) continue;
    if (selectedScopeIds !== null && !hit.scopes.some((id) => selectedScopeIds.has(id))) continue;
    if (hit.searchKey.includes(folded)) matches.push(hit);
  }
  if (scanned !== meta.search.records) throw new Error("Conteggio ricerca divergente");
  matches.sort((left, right) => {
    const leftScore = normalized(left.number) === folded ? 0 : left.searchKey.startsWith(folded) ? 1 : 2;
    const rightScore = normalized(right.number) === folded ? 0 : right.searchKey.startsWith(folded) ? 1 : 2;
    if (leftScore !== rightScore) return leftScore - rightScore;
    const leftSpend = totalSpending(left);
    const rightSpend = totalSpending(right);
    return (leftSpend === rightSpend ? 0 : leftSpend > rightSpend ? -1 : 1)
      || left.type.localeCompare(right.type) || left.number.localeCompare(right.number, "en", { numeric: true }) || left.ref.localeCompare(right.ref);
  });
  const filter = { company, q: folded, region, type, year };
  const hash = filterHash(filter);
  const start = pageStart(input.cursor, hash, meta);
  if (start > matches.length) throw new MedicalDeviceQueryError("cursor oltre i risultati disponibili.");
  const size = limit(input.limit);
  const candidates = matches.slice(start, start + size);
  const detailsByRef = new Map<string, Detail>();
  for (const prefix of new Set(candidates.map((candidate) => candidate.ref.slice(3, 5)))) {
    for (const detail of loadDetails(meta, prefix)) detailsByRef.set(detail.ref, detail);
  }
  const hits = candidates.map((candidate) => {
    const detail = detailsByRef.get(candidate.ref);
    if (!detail) throw new Error("Dettaglio ricerca assente");
    return { schemaVersion: 1, ref: detail.ref, type: detail.type, number: detail.number,
      registryRecordId: detail.registryRecordId, name: detail.name, catalog: detail.catalog,
      manufacturer: detail.manufacturer, role: detail.role, classification: detail.classification,
      classificationLabel: detail.classificationLabel, searchKey: candidate.searchKey,
      scopes: candidate.scopes, years: candidate.years } satisfies MedicalDeviceSearchHit;
  });
  const exactNumberTypes = new Set(matches.filter((hit) => hit.number === query).map((hit) => hit.type));
  return { query, normalizedQuery: folded, filters: filter, hits, matched: matches.length,
    requiresType: type === null && exactNumberTypes.size > 1,
    pagination: { limit: size, returned: hits.length, nextCursor: nextCursor(start + hits.length, matches.length, hash, meta), exhausted: start + hits.length >= matches.length },
    provenance: { registrySnapshotDate: meta.registrySnapshotDate, sourceSpecSha256: meta.sourceSpecSha256,
      moneyNature: "spesa rilevata per dispositivi associati all’anagrafica BD/RDM; non incassi, prezzi unitari o fatturato" } } as const;
}

export function listMedicalDeviceFilters(): MedicalDeviceFilterOptions {
  const meta = loadMeta();
  const years = meta.aggregates.scopes
    .filter((item) => item.region === null && item.company === null)
    .map((item) => ({
      year: item.year,
      regions: meta.aggregates.scopes
        .filter((region) => region.year === item.year && region.region !== null && region.company === null)
        .map((region) => ({
          code: region.region!,
          companies: meta.aggregates.scopes
            .filter((company) => company.year === item.year && company.region === region.region && company.company !== null)
            .map((company) => ({ code: company.company!, names: company.companyNames ?? [] })),
        })),
    }));
  return { registrySnapshotDate: meta.registrySnapshotDate, years };
}

export async function getMedicalDeviceProfile(input: Readonly<{
  type: unknown;
  number: unknown;
  signal?: AbortSignal;
}>) {
  const meta = loadMeta();
  const type = optionalString(input.type, "tipo", /^[12]$/) as "1" | "2" | null;
  const number = optionalString(input.number, "numero", DEVICE_NUMBER);
  if (type === null || number === null) throw new MedicalDeviceQueryError("tipo e numero sono obbligatori.");
  const ref = "dm-" + createHash("sha256").update(`${type}\0${number}`).digest("hex").slice(0, 20);
  assertSignal(input.signal);
  const device = loadDetails(meta, ref.slice(3, 5)).find((candidate) => candidate.ref === ref);
  if (!device) throw new MedicalDeviceQueryError("Dispositivo non presente nei dati di spesa pubblicati.");
  const years = new Map<number, {
    rows: number;
    spendingCents: bigint;
    negativeRows: number;
    zeroRows: number;
    regions: Map<string, { rows: number; spendingCents: bigint; companies: Map<string, { names: Set<string>; rows: number; spendingCents: bigint }> }>;
  }>();
  for (const fact of device.facts) {
    const cents = moneyCents(fact.spending);
    const annual = years.get(fact.year) ?? {
      rows: 0, spendingCents: BigInt(0), negativeRows: 0, zeroRows: 0, regions: new Map(),
    };
    annual.rows += 1;
    annual.spendingCents += cents;
    annual.negativeRows += Number(cents < BigInt(0));
    annual.zeroRows += Number(cents === BigInt(0));
    const region = annual.regions.get(fact.region) ?? { rows: 0, spendingCents: BigInt(0), companies: new Map() };
    region.rows += 1;
    region.spendingCents += cents;
    const company = region.companies.get(fact.company) ?? { names: new Set<string>(), rows: 0, spendingCents: BigInt(0) };
    company.names.add(fact.companyName);
    company.rows += 1;
    company.spendingCents += cents;
    region.companies.set(fact.company, company);
    annual.regions.set(fact.region, region);
    years.set(fact.year, annual);
  }
  const deviceSummary = {
    schemaVersion: device.schemaVersion, ref: device.ref, type: device.type, number: device.number,
    registryRecordId: device.registryRecordId, name: device.name, catalog: device.catalog,
    manufacturer: device.manufacturer, role: device.role, classification: device.classification,
    classificationLabel: device.classificationLabel,
  } as const;
  return {
    device: deviceSummary,
    registrySnapshotDate: meta.registrySnapshotDate,
    sourceSpecSha256: meta.sourceSpecSha256,
    facts: device.facts.length,
    years: [...years.entries()].sort(([left], [right]) => right - left).map(([year, annual]) => ({
      year, rows: annual.rows, spending: euroFromCents(annual.spendingCents),
      negativeRows: annual.negativeRows, zeroRows: annual.zeroRows,
      regions: [...annual.regions.entries()].map(([code, region]) => ({
        code, rows: region.rows, spending: euroFromCents(region.spendingCents),
        companies: [...region.companies.entries()].map(([companyCode, company]) => ({
          code: companyCode, names: [...company.names].sort(), rows: company.rows,
          spending: euroFromCents(company.spendingCents),
        })).sort((left, right) => left.code.localeCompare(right.code)),
      })).sort((left, right) => left.code.localeCompare(right.code)),
    })),
  } as const;
}

function validateAggregate(value: unknown): MedicalDeviceAggregate {
  const row = record(value, "aggregate");
  return { code: text(row.code, "aggregate.code", 100, true), label: text(row.label, "aggregate.label", 1000, true),
    labels: Array.isArray(row.labels) ? row.labels.map((item) => text(item, "aggregate.labels", 1000)!) : [],
    role: row.role === null ? null : row.role === "fabbricante" || row.role === "assemblatore" ? row.role : (() => { throw new Error("Ruolo aggregato non valido"); })(),
    rows: integer(row.rows, "aggregate.rows"), spending: money(row.spending, "aggregate.spending"),
    negativeRows: integer(row.negativeRows, "aggregate.negativeRows"), zeroRows: integer(row.zeroRows, "aggregate.zeroRows"),
    matchedRows: integer(row.matchedRows, "aggregate.matchedRows"), unresolvedRows: integer(row.unresolvedRows, "aggregate.unresolvedRows") };
}

function validateCoverage(value: unknown): MedicalDeviceCoverage {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object") throw new Error("Copertura non valida");
  const result = { rows: integer(row.rows, "coverage.rows"), spending: money(row.spending, "coverage.spending"),
    negativeRows: integer(row.negativeRows, "coverage.negativeRows"), zeroRows: integer(row.zeroRows, "coverage.zeroRows"),
    matchedRows: integer(row.matchedRows, "coverage.matchedRows"), matchedSpending: money(row.matchedSpending, "coverage.matchedSpending"),
    unresolvedRows: integer(row.unresolvedRows, "coverage.unresolvedRows"), unresolvedSpending: money(row.unresolvedSpending, "coverage.unresolvedSpending") };
  if (result.matchedRows + result.unresolvedRows !== result.rows) throw new Error("Copertura non riconciliata");
  return result;
}

function loadAggregate(meta: Meta, selected: Scope): ScopePayload {
  const cached = aggregateCache.get(selected.key);
  if (cached) return cached;
  const raw = readBlock(meta.aggregates.path, meta.aggregates.bytes, selected);
  const value = record(JSON.parse(raw.toString("utf8")), "aggregate block");
  if (value.schemaVersion !== 1 || record(value.scope, "aggregate scope").key !== selected.key) throw new Error("Perimetro aggregato non valido");
  if (!Array.isArray(value.territories) || !Array.isArray(value.classifications) || !Array.isArray(value.manufacturers)) {
    throw new Error("Righe aggregate non valide");
  }
  const result: ScopePayload = { schemaVersion: 1, scope: selected, coverage: validateCoverage(value.coverage),
    territories: value.territories.map(validateAggregate),
    classifications: value.classifications.map(validateAggregate),
    manufacturers: value.manufacturers.map(validateAggregate) };
  for (const rows of [result.classifications, result.manufacturers, ...(result.territories.length ? [result.territories] : [])]) {
    if (rows.reduce((sum, row) => sum + row.rows, 0) !== result.coverage.rows) throw new Error("Aggregati non riconciliati");
  }
  if (aggregateCache.size >= CACHE_BLOCKS) aggregateCache.delete(aggregateCache.keys().next().value!);
  aggregateCache.set(selected.key, result);
  return result;
}

export async function aggregateMedicalDeviceSpending(input: Readonly<{
  year: unknown; region?: unknown; company?: unknown; dimension?: unknown;
  limit?: unknown; cursor?: unknown; signal?: AbortSignal;
}>) {
  const meta = loadMeta();
  const yearText = optionalString(input.year, "anno", /^20\d{2}$/);
  if (yearText === null) throw new MedicalDeviceQueryError("anno è obbligatorio.");
  const region = optionalString(input.region, "regione", /^\d+$/);
  const company = optionalString(input.company, "azienda", /^\d+$/);
  if (company !== null && region === null) throw new MedicalDeviceQueryError("azienda richiede regione.");
  const dimension = optionalString(input.dimension, "dimensione") ?? "territory";
  if (!["territory", "classification", "manufacturer"].includes(dimension)) throw new MedicalDeviceQueryError("dimensione non valida.");
  const selected = scope(meta, Number(yearText), region, company);
  assertSignal(input.signal);
  const payload = loadAggregate(meta, selected);
  assertSignal(input.signal);
  const rows = dimension === "territory" ? payload.territories : dimension === "classification" ? payload.classifications : payload.manufacturers;
  const filter = { dimension, scope: selected.key };
  const hash = filterHash(filter);
  const start = pageStart(input.cursor, hash, meta);
  if (start > rows.length) throw new MedicalDeviceQueryError("cursor oltre i risultati disponibili.");
  const size = limit(input.limit);
  const page = rows.slice(start, start + size).map((row) => ({ ...row,
    drilldown: { dimension, role: dimension === "manufacturer" ? row.role : null,
      scope: selected.key, value: dimension === "manufacturer" ? row.label : row.code } }));
  return { scope: selected, dimension, coverage: payload.coverage, rows: page, matched: rows.length,
    pagination: { limit: size, returned: page.length, nextCursor: nextCursor(start + page.length, rows.length, hash, meta), exhausted: start + page.length >= rows.length },
    interpretation: { denominator: "tutte le righe osservate nel perimetro, incluse rettifiche negative e zeri",
      joinCoverage: "misura il collegamento alla BD/RDM, non la completezza nazionale del flusso",
      manufacturerSnapshot: meta.registrySnapshotDate } } as const;
}

export async function listMedicalDeviceAggregateFacts(input: Readonly<{
  year: unknown; region?: unknown; company?: unknown; dimension: unknown; value?: unknown; role?: unknown;
  limit?: unknown; cursor?: unknown; signal?: AbortSignal;
}>) {
  const meta = loadMeta();
  const yearText = optionalString(input.year, "anno", /^20\d{2}$/);
  if (yearText === null) throw new MedicalDeviceQueryError("anno è obbligatorio.");
  const region = optionalString(input.region, "regione", /^\d+$/);
  const company = optionalString(input.company, "azienda", /^\d+$/);
  if (company !== null && region === null) throw new MedicalDeviceQueryError("azienda richiede regione.");
  const dimension = optionalString(input.dimension, "dimensione");
  if (dimension === null || !["territory", "classification", "manufacturer"].includes(dimension)) {
    throw new MedicalDeviceQueryError("dimensione non valida.");
  }
  const value = input.value === null || input.value === undefined ? null : optionalString(input.value, "valore", undefined, 1000);
  const role = input.role === null || input.role === undefined ? null : optionalString(input.role, "ruolo", /^(fabbricante|assemblatore)$/);
  const selected = scope(meta, Number(yearText), region, company);
  assertSignal(input.signal);
  const aggregate = loadAggregate(meta, selected);
  const groups = dimension === "territory" ? aggregate.territories
    : dimension === "classification" ? aggregate.classifications : aggregate.manufacturers;
  const group = groups.find((row) => (dimension === "manufacturer" ? row.label : row.code) === value
    && (dimension !== "manufacturer" || row.role === role));
  if (!group) throw new MedicalDeviceQueryError("Aggregazione non presente nel perimetro richiesto.");
  const filter = { dimension, role, scope: selected.key, value };
  const hash = filterHash(filter);
  const start = pageStart(input.cursor, hash, meta);
  if (start > meta.coverage.facts) throw new MedicalDeviceQueryError("cursor oltre i fatti disponibili.");
  const size = limit(input.limit);
  const rows: Array<MedicalDeviceFact & Readonly<{
    device: Readonly<{ ref: string; type: "1" | "2"; number: string; name: string | null }>;
    catalog: Readonly<{ datasetId: string; sourceRow: number; href: string }>;
  }>> = [];
  let ordinal = 0;
  let scanned = 0;
  let exhausted = true;
  outer: for (const block of meta.details.blocks) {
    if (ordinal + block.facts <= start) {
      ordinal += block.facts;
      continue;
    }
    for (const device of loadDetails(meta, block.key)) {
      for (const fact of device.facts) {
        if (ordinal++ < start) continue;
        if ((scanned++ & 4095) === 0) {
          await setImmediate();
          assertSignal(input.signal);
        }
        const inScope = fact.year === Number(yearText)
          && (region === null || fact.region === region)
          && (company === null || fact.company === company);
        const inGroup = dimension === "territory"
          ? (region === null ? fact.region : fact.company) === value
          : dimension === "classification" ? fact.sourceClassification === (value ?? "")
          : (device.manufacturer || null) === value && device.role === role;
        if (inScope && inGroup) {
          rows.push({ ...fact, device: { ref: device.ref, type: device.type, number: device.number, name: device.name },
            catalog: { datasetId: fact.datasetId, sourceRow: fact.sourceRow, href: catalogHref(fact.datasetId, device.number) } });
          if (rows.length === size) {
            exhausted = ordinal >= meta.coverage.facts;
            break outer;
          }
        }
        if (scanned >= MAX_FACT_SCAN) {
          exhausted = ordinal >= meta.coverage.facts;
          break outer;
        }
      }
    }
  }
  const cursor = exhausted ? null : nextCursor(ordinal, meta.coverage.facts, hash, meta);
  return { scope: selected, dimension, value, role, rows, matched: group.rows,
    pagination: { limit: size, returned: rows.length, scannedFacts: scanned, nextCursor: cursor, exhausted },
    provenance: { registrySnapshotDate: meta.registrySnapshotDate, sourceSpecSha256: meta.sourceSpecSha256 } } as const;
}

function validateFact(value: unknown): MedicalDeviceFact {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || !["matched", "not_found"].includes(String(row.joinStatus))) throw new Error("Fatto dispositivo non valido");
  return { datasetId: text(row.datasetId, "fact.datasetId", 100)!, sourceRow: integer(row.sourceRow, "fact.sourceRow"),
    year: integer(row.year, "fact.year"), region: text(row.region, "fact.region", 20)!, company: text(row.company, "fact.company", 40)!,
    companyName: text(row.companyName, "fact.companyName", 500)!, sourceClassification: text(row.sourceClassification, "fact.sourceClassification", 100)!,
    spending: money(row.spending, "fact.spending"), joinStatus: row.joinStatus as "matched" | "not_found" };
}

function loadDetails(meta: Meta, prefix: string): readonly Detail[] {
  const cached = detailCache.get(prefix);
  if (cached) return cached;
  const block = meta.details.blocks[Number.parseInt(prefix, 16)];
  const raw = readBlock(meta.details.path, meta.details.bytes, block);
  const rows = raw.toString("utf8").trimEnd().split("\n").filter(Boolean).map((line) => {
    const value = record(JSON.parse(line), "detail");
    const base = validateSearchCandidate({ ...value, searchKey: "", scopes: [], years: {} });
    const role = value.role === null ? null : value.role === "fabbricante" || value.role === "assemblatore" ? value.role : (() => { throw new Error("Ruolo non valido"); })();
    return { schemaVersion: 1, ref: base.ref, type: base.type, number: base.number,
      registryRecordId: text(value.registryRecordId, "registryRecordId", 64, true), name: text(value.name, "name", 2000, true),
      catalog: text(value.catalog, "catalog", 1000, true), manufacturer: text(value.manufacturer, "manufacturer", 1000, true), role,
      classification: text(value.classification, "classification", 100, true), classificationLabel: text(value.classificationLabel, "classificationLabel", 2000, true),
      facts: Array.isArray(value.facts) ? value.facts.map(validateFact) : (() => { throw new Error("Fatti dettaglio non validi"); })() } satisfies Detail;
  });
  if (rows.length !== block.records || rows.reduce((sum, row) => sum + row.facts.length, 0) !== block.facts) {
    throw new Error("Conteggio del blocco di dettaglio divergente");
  }
  if (detailCache.size >= CACHE_BLOCKS) detailCache.delete(detailCache.keys().next().value!);
  detailCache.set(prefix, rows);
  return rows;
}

export async function listMedicalDeviceFacts(input: Readonly<{
  type: unknown; number: unknown; year?: unknown; region?: unknown; company?: unknown;
  limit?: unknown; cursor?: unknown; signal?: AbortSignal;
}>) {
  const meta = loadMeta();
  const type = optionalString(input.type, "tipo", /^[12]$/) as "1" | "2" | null;
  const number = optionalString(input.number, "numero", DEVICE_NUMBER);
  if (type === null || number === null) throw new MedicalDeviceQueryError("tipo e numero sono obbligatori.");
  const yearText = optionalString(input.year, "anno", /^20\d{2}$/);
  const year = yearText === null ? null : Number(yearText);
  const region = optionalString(input.region, "regione", /^\d+$/);
  const company = optionalString(input.company, "azienda", /^\d+$/);
  if (region !== null && year === null) throw new MedicalDeviceQueryError("regione richiede anno.");
  if (company !== null && region === null) throw new MedicalDeviceQueryError("azienda richiede regione.");
  const ref = "dm-" + createHash("sha256").update(`${type}\0${number}`).digest("hex").slice(0, 20);
  assertSignal(input.signal);
  const device = loadDetails(meta, ref.slice(3, 5)).find((candidate) => candidate.ref === ref);
  if (!device) throw new MedicalDeviceQueryError("Dispositivo non presente nei dati di spesa pubblicati.");
  const facts = device.facts.filter((fact) => (year === null || fact.year === year)
    && (region === null || fact.region === region) && (company === null || fact.company === company));
  const filter = { company, number, region, type, year };
  const hash = filterHash(filter);
  const start = pageStart(input.cursor, hash, meta);
  if (start > facts.length) throw new MedicalDeviceQueryError("cursor oltre i risultati disponibili.");
  const size = limit(input.limit);
  const rows = facts.slice(start, start + size).map((fact) => ({ ...fact,
    catalog: { datasetId: fact.datasetId, sourceRow: fact.sourceRow, href: catalogHref(fact.datasetId, number) } }));
  const deviceSummary = {
    schemaVersion: device.schemaVersion,
    ref: device.ref,
    type: device.type,
    number: device.number,
    registryRecordId: device.registryRecordId,
    name: device.name,
    catalog: device.catalog,
    manufacturer: device.manufacturer,
    role: device.role,
    classification: device.classification,
    classificationLabel: device.classificationLabel,
  } as const;
  return { device: deviceSummary, filters: filter, rows, matched: facts.length,
    pagination: { limit: size, returned: rows.length, nextCursor: nextCursor(start + rows.length, facts.length, hash, meta), exhausted: start + rows.length >= facts.length },
    provenance: { registrySnapshotDate: meta.registrySnapshotDate, sourceSpecSha256: meta.sourceSpecSha256 } } as const;
}
