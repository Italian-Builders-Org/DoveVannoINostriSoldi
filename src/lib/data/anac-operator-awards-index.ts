import "server-only";

import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const DATASET = "anac-operator-awards-index" as const;
const SOURCE_SPEC_PATH = "scripts/etl/specs/anac-operator-awards-index.source.json";
const PARENT_SPEC_PATH = "scripts/etl/specs/anac-awardees.source.json";
const ARTIFACT_DIR = "src/data/generated/anac-operator-awards-index";
const SHA256 = /^[a-f0-9]{64}$/;
const PREFIX = /^[a-f0-9]{2}$/;
const OPERATOR_REF = /^op-[0-9]{8}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CIG = /^[A-Z0-9]{10}$/;
const AWARD_ID = /^[0-9]+$/;
const MAX_META_BYTES = 2_000_000;
const MAX_SEARCH_BYTES = 64 * 1024 * 1024;
const MAX_SHARD_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_SEARCH_RECORDS = 1_000_000;
const MAX_AWARDS_PUBLISHED = 15;
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 120;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

const AMOUNT_STATUSES = new Set([
  "positive-exact-cent",
  "positive-subcent",
  "zero",
  "negative",
  "missing",
  "invalid",
  "conflicting",
]);

const ATTRIBUTION = new Set(["single-operator", "multipart"]);

export type AnacOperatorAmountStatus =
  | "positive-exact-cent"
  | "positive-subcent"
  | "zero"
  | "negative"
  | "missing"
  | "invalid"
  | "conflicting";

export type AnacOperatorAwardAttribution = "single-operator" | "multipart";

export type AnacOperatorSearchHit = Readonly<{
  schemaVersion: 1;
  ref: string;
  name: string;
  searchKey: string;
  awardCount: number;
  attributedAwardCount: number;
  attributedValue: string;
  yearMin: number | null;
  yearMax: number | null;
}>;

export type AnacOperatorAwardProcedure = Readonly<{
  oggetto: string | null;
  cpvCode: string | null;
  cpvLabel: string | null;
  contractingAuthority: string | null;
  cigYear: number | null;
  matched: boolean;
}>;

export type AnacOperatorAward = Readonly<{
  cig: string;
  awardId: string;
  awardedAt: string | null;
  amount: string | null;
  amountStatus: AnacOperatorAmountStatus;
  attribution: AnacOperatorAwardAttribution;
  procedure?: AnacOperatorAwardProcedure;
}>;

export type AnacOperatorNamedCount = Readonly<{
  label: string;
  count: number;
}>;

export type AnacOperatorCpvCount = Readonly<{
  label: string;
  code: string | null;
  count: number;
}>;

export type AnacOperatorSummaryHit = Readonly<{
  ref: string;
  name: string;
  awardCount: number;
  attributedAwardCount: number;
  attributedValue: string;
  yearMin: number | null;
  yearMax: number | null;
}>;

export type AnacOperatorNationalSummaries = Readonly<{
  schemaVersion: 1;
  dataset: typeof DATASET;
  generatedAt: string;
  basis: Readonly<{
    operators: string;
    procedures: string;
    limit: number;
    moneyNature: string;
    note: string;
  }>;
  coverage: Readonly<{
    operators: number;
    uniqueMatchedCigsCounted: number;
    distinctCpvLabels: number;
    distinctContractingAuthorities: number;
    distinctProcedureObjects: number;
    skippedNonInformativeOggetto?: number;
    skippedNonInformativeCpv?: number;
  }>;
  topOperatorsByAwardCount: readonly AnacOperatorSummaryHit[];
  topOperatorsByAttributedValue: readonly AnacOperatorSummaryHit[];
  topCpv: readonly AnacOperatorCpvCount[];
  topContractingAuthorities: readonly AnacOperatorNamedCount[];
  topProcedureObjects: readonly AnacOperatorNamedCount[];
}>;

export type AnacOperatorRecord = Readonly<{
  schemaVersion: 1;
  ref: string;
  name: string;
  searchKey: string;
  nameVariants: number;
  awardCount: number;
  attributedAwardCount: number;
  attributedValue: string;
  yearMin: number | null;
  yearMax: number | null;
  awardsPublished: number;
  awardsTruncated: boolean;
  awards: readonly AnacOperatorAward[];
  procedureMatchedAwards?: number;
  topCpv?: readonly AnacOperatorNamedCount[];
  topContractingAuthorities?: readonly AnacOperatorNamedCount[];
}>;

export type AnacOperatorIndexMeta = Readonly<{
  schemaVersion: 1;
  dataset: typeof DATASET;
  distributionKind: "sharded-public-operator-index";
  observedAt: string;
  generatedAt: string;
  scope: Readonly<Record<string, unknown>>;
  contract: Readonly<Record<string, unknown>>;
  privacy: Readonly<Record<string, unknown>>;
  limitations: readonly string[];
  provenance: Readonly<Record<string, unknown>>;
  coverage: Readonly<Record<string, unknown>>;
  totals: Readonly<{
    operators: number;
    awardRelations: number;
    attributedAwards: number;
    attributedValue: string;
    awardsPublished: number;
    awardsTruncatedOperators: number;
  }>;
  search: Readonly<{
    path: string;
    bytes: number;
    sha256: string;
    operators: number;
  }>;
  shards: readonly Readonly<{
    id: string;
    path: string;
    bytes: number;
    sha256: string;
    operators: number;
  }>[];
  sourceSpecSha256: string;
  cigEnrichment?: Readonly<Record<string, unknown>>;
  summaries?: Readonly<{
    path: string;
    bytes: number;
    sha256: string;
    limit: number;
    coverage: Readonly<Record<string, unknown>>;
  }>;
}>;

export type AnacOperatorSearchResult = Readonly<{
  query: string;
  normalizedQuery: string;
  hits: readonly AnacOperatorSearchHit[];
  matched: number;
  limit: number;
  meta: AnacOperatorIndexMeta;
}>;

let cachedMeta: AnacOperatorIndexMeta | null = null;
let cachedSearch: readonly AnacOperatorSearchHit[] | null = null;
let cachedSummaries: AnacOperatorNationalSummaries | null = null;
const operatorCache = new Map<string, AnacOperatorRecord | null>();
const MAX_SUMMARIES_BYTES = 2_000_000;
const MAX_SUMMARY_ROWS = 50;

function repoRoot(): string {
  return resolve(process.cwd());
}

function artifactPath(...parts: string[]): string {
  return join(repoRoot(), ARTIFACT_DIR, ...parts);
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function assertInstant(value: unknown, label: string): string {
  if (typeof value !== "string" || !INSTANT.test(value)) {
    throw new Error(`${label}: istante non valido`);
  }
  return value;
}

function assertDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${label}: decimale non valido`);
  }
  return value;
}

function assertNonNegInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}: intero non valido`);
  }
  return value;
}

function assertYear(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1990 || value > 2100) {
    throw new Error(`${label}: anno non valido`);
  }
  return value;
}

function normalizeSearchQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, "");
}

function readGunzipped(path: string, maxBytes: number): string {
  const compressed = readFileSync(path);
  if (compressed.byteLength > maxBytes) {
    throw new Error(`artifacto troppo grande: ${path}`);
  }
  const uncompressed = gunzipSync(compressed);
  if (uncompressed.byteLength > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`artifacto decompresso troppo grande: ${path}`);
  }
  return uncompressed.toString("utf8");
}

function parseJsonl<T>(text: string, validate: (value: unknown) => T, maxRecords: number): T[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length > maxRecords) {
    throw new Error("troppe righe nell'indice");
  }
  return lines.map((line) => validate(JSON.parse(line)));
}

function assertSearchHit(value: unknown): AnacOperatorSearchHit {
  if (!value || typeof value !== "object") throw new Error("hit search non valido");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) throw new Error("schemaVersion search non valido");
  if (typeof row.ref !== "string" || !OPERATOR_REF.test(row.ref)) throw new Error("ref search non valido");
  if (typeof row.name !== "string" || row.name.length === 0 || row.name.length > 500) {
    throw new Error("name search non valido");
  }
  if (typeof row.searchKey !== "string" || row.searchKey.length > 500) {
    throw new Error("searchKey non valido");
  }
  return {
    schemaVersion: 1,
    ref: row.ref,
    name: row.name,
    searchKey: row.searchKey,
    awardCount: assertNonNegInt(row.awardCount, "awardCount"),
    attributedAwardCount: assertNonNegInt(row.attributedAwardCount, "attributedAwardCount"),
    attributedValue: assertDecimal(row.attributedValue, "attributedValue"),
    yearMin: assertYear(row.yearMin, "yearMin"),
    yearMax: assertYear(row.yearMax, "yearMax"),
  };
}

function assertOptionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${label} non valido`);
  if (value.length > max) throw new Error(`${label} troppo lungo`);
  return value;
}

function assertAwardProcedure(value: unknown): AnacOperatorAwardProcedure | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("procedure non valida");
  const row = value as Record<string, unknown>;
  if (typeof row.matched !== "boolean") throw new Error("procedure.matched non valido");
  const cigYear =
    row.cigYear === null || row.cigYear === undefined
      ? null
      : assertYear(row.cigYear, "procedure.cigYear");
  return {
    oggetto: assertOptionalText(row.oggetto, "procedure.oggetto", 2000),
    cpvCode: assertOptionalText(row.cpvCode, "procedure.cpvCode", 40),
    cpvLabel: assertOptionalText(row.cpvLabel, "procedure.cpvLabel", 500),
    contractingAuthority: assertOptionalText(
      row.contractingAuthority,
      "procedure.contractingAuthority",
      600,
    ),
    cigYear,
    matched: row.matched,
  };
}

function assertNamedCounts(value: unknown, label: string): readonly AnacOperatorNamedCount[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) throw new Error(`${label} non validi`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${label}[${index}] non valido`);
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string" || row.label.length === 0 || row.label.length > 300) {
      throw new Error(`${label}[${index}].label non valido`);
    }
    return { label: row.label, count: assertNonNegInt(row.count, `${label}[${index}].count`) };
  });
}

function assertAward(value: unknown): AnacOperatorAward {
  if (!value || typeof value !== "object") throw new Error("award non valido");
  const row = value as Record<string, unknown>;
  if (typeof row.cig !== "string" || !CIG.test(row.cig)) throw new Error("cig non valido");
  if (typeof row.awardId !== "string" || !AWARD_ID.test(row.awardId)) throw new Error("awardId non valido");
  if (row.awardedAt !== null && (typeof row.awardedAt !== "string" || !DATE.test(row.awardedAt))) {
    throw new Error("awardedAt non valido");
  }
  if (
    row.amount !== null &&
    (typeof row.amount !== "string" || !SIGNED_DECIMAL.test(row.amount))
  ) {
    throw new Error("amount non valido");
  }
  if (typeof row.amountStatus !== "string" || !AMOUNT_STATUSES.has(row.amountStatus)) {
    throw new Error("amountStatus non valido");
  }
  if (typeof row.attribution !== "string" || !ATTRIBUTION.has(row.attribution)) {
    throw new Error("attribution non valida");
  }
  return {
    cig: row.cig,
    awardId: row.awardId,
    awardedAt: row.awardedAt,
    amount: row.amount,
    amountStatus: row.amountStatus as AnacOperatorAmountStatus,
    attribution: row.attribution as AnacOperatorAwardAttribution,
    procedure: assertAwardProcedure(row.procedure),
  };
}

function assertOperatorRecord(value: unknown): AnacOperatorRecord {
  if (!value || typeof value !== "object") throw new Error("record operatore non valido");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) throw new Error("schemaVersion operatore non valido");
  if (typeof row.ref !== "string" || !OPERATOR_REF.test(row.ref)) throw new Error("ref operatore non valido");
  if (typeof row.name !== "string" || row.name.length === 0) throw new Error("name operatore non valido");
  if (typeof row.searchKey !== "string") throw new Error("searchKey operatore non valido");
  if (!Array.isArray(row.awards) || row.awards.length > MAX_AWARDS_PUBLISHED) {
    throw new Error("awards operatore non validi");
  }
  const awards = row.awards.map(assertAward);
  return {
    schemaVersion: 1,
    ref: row.ref,
    name: row.name,
    searchKey: row.searchKey,
    nameVariants: assertNonNegInt(row.nameVariants, "nameVariants"),
    awardCount: assertNonNegInt(row.awardCount, "awardCount"),
    attributedAwardCount: assertNonNegInt(row.attributedAwardCount, "attributedAwardCount"),
    attributedValue: assertDecimal(row.attributedValue, "attributedValue"),
    yearMin: assertYear(row.yearMin, "yearMin"),
    yearMax: assertYear(row.yearMax, "yearMax"),
    awardsPublished: assertNonNegInt(row.awardsPublished, "awardsPublished"),
    awardsTruncated: row.awardsTruncated === true,
    awards,
    procedureMatchedAwards:
      row.procedureMatchedAwards === undefined
        ? undefined
        : assertNonNegInt(row.procedureMatchedAwards, "procedureMatchedAwards"),
    topCpv: assertNamedCounts(row.topCpv, "topCpv"),
    topContractingAuthorities: assertNamedCounts(
      row.topContractingAuthorities,
      "topContractingAuthorities",
    ),
  };
}

export function assertAnacOperatorIndexMeta(value: unknown): AnacOperatorIndexMeta {
  if (!value || typeof value !== "object") throw new Error("meta operatore non valido");
  const meta = value as Record<string, unknown>;
  if (meta.schemaVersion !== 1 || meta.dataset !== DATASET) {
    throw new Error("meta dataset inatteso");
  }
  if (meta.distributionKind !== "sharded-public-operator-index") {
    throw new Error("distributionKind inatteso");
  }
  assertInstant(meta.observedAt, "observedAt");
  assertInstant(meta.generatedAt, "generatedAt");
  if (typeof meta.sourceSpecSha256 !== "string" || !SHA256.test(meta.sourceSpecSha256)) {
    throw new Error("sourceSpecSha256 non valido");
  }
  const privacy = meta.privacy as Record<string, unknown> | undefined;
  if (!privacy || privacy.containsOperatorTaxIds !== false || privacy.containsOperatorTaxIdHashes !== false) {
    throw new Error("privacy operatori non fail-closed");
  }
  if (privacy.containsOperatorNames !== true) {
    throw new Error("privacy: nomi operatori attesi");
  }
  const totals = meta.totals as Record<string, unknown> | undefined;
  if (!totals) throw new Error("totals assenti");
  const search = meta.search as Record<string, unknown> | undefined;
  if (!search || typeof search.path !== "string" || !SHA256.test(String(search.sha256))) {
    throw new Error("search meta non valido");
  }
  if (!Array.isArray(meta.shards) || meta.shards.length !== 256) {
    throw new Error("shards meta non validi");
  }
  for (const shard of meta.shards) {
    const row = shard as Record<string, unknown>;
    if (typeof row.id !== "string" || !PREFIX.test(row.id)) throw new Error("shard id non valido");
    if (typeof row.sha256 !== "string" || !SHA256.test(row.sha256)) throw new Error("shard sha non valido");
  }
  if (!Array.isArray(meta.limitations) || meta.limitations.length === 0) {
    throw new Error("limitations assenti");
  }
  if (meta.cigEnrichment && !meta.summaries) {
    throw new Error("summaries nazionali attesi dopo cigEnrichment");
  }
  if (meta.summaries) {
    const summaries = meta.summaries as Record<string, unknown>;
    if (typeof summaries.path !== "string" || !summaries.path.endsWith("summaries.json")) {
      throw new Error("summaries.path non valido");
    }
    if (typeof summaries.sha256 !== "string" || !SHA256.test(summaries.sha256)) {
      throw new Error("summaries.sha256 non valido");
    }
    assertNonNegInt(summaries.bytes, "summaries.bytes");
    assertNonNegInt(summaries.limit, "summaries.limit");
  }
  return meta as AnacOperatorIndexMeta;
}

function assertSummaryHit(value: unknown, label: string): AnacOperatorSummaryHit {
  if (!value || typeof value !== "object") throw new Error(`${label} non valido`);
  const row = value as Record<string, unknown>;
  if (typeof row.ref !== "string" || !OPERATOR_REF.test(row.ref)) {
    throw new Error(`${label}.ref non valido`);
  }
  if (typeof row.name !== "string" || row.name.length === 0 || row.name.length > 500) {
    throw new Error(`${label}.name non valido`);
  }
  return {
    ref: row.ref,
    name: row.name,
    awardCount: assertNonNegInt(row.awardCount, `${label}.awardCount`),
    attributedAwardCount: assertNonNegInt(row.attributedAwardCount, `${label}.attributedAwardCount`),
    attributedValue: assertDecimal(row.attributedValue, `${label}.attributedValue`),
    yearMin: assertYear(row.yearMin, `${label}.yearMin`),
    yearMax: assertYear(row.yearMax, `${label}.yearMax`),
  };
}

function assertSummaryNamed(value: unknown, label: string): AnacOperatorNamedCount {
  if (!value || typeof value !== "object") throw new Error(`${label} non valido`);
  const row = value as Record<string, unknown>;
  if (typeof row.label !== "string" || row.label.length === 0 || row.label.length > 400) {
    throw new Error(`${label}.label non valido`);
  }
  return { label: row.label, count: assertNonNegInt(row.count, `${label}.count`) };
}

function assertSummaryCpv(value: unknown, label: string): AnacOperatorCpvCount {
  const named = assertSummaryNamed(value, label);
  const row = value as Record<string, unknown>;
  const code =
    row.code === null || row.code === undefined
      ? null
      : assertOptionalText(row.code, `${label}.code`, 40);
  return { ...named, code };
}

function assertNationalSummaries(value: unknown): AnacOperatorNationalSummaries {
  if (!value || typeof value !== "object") throw new Error("summaries non validi");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.dataset !== DATASET) {
    throw new Error("summaries dataset inatteso");
  }
  assertInstant(row.generatedAt, "summaries.generatedAt");
  const basis = row.basis as Record<string, unknown> | undefined;
  if (!basis || typeof basis.operators !== "string" || typeof basis.procedures !== "string") {
    throw new Error("summaries.basis non valido");
  }
  const limit = assertNonNegInt(basis.limit, "summaries.basis.limit");
  if (limit < 1 || limit > MAX_SUMMARY_ROWS) throw new Error("summaries.limit fuori range");
  if (typeof basis.moneyNature !== "string" || typeof basis.note !== "string") {
    throw new Error("summaries.basis note/money non validi");
  }
  const coverage = row.coverage as Record<string, unknown> | undefined;
  if (!coverage) throw new Error("summaries.coverage assente");
  const requireRows = assertNonNegInt(coverage.uniqueMatchedCigsCounted, "uniqueMatchedCigs") > 0;
  const readHits = (key: string): AnacOperatorSummaryHit[] => {
    const list = row[key];
    if (!Array.isArray(list) || list.length > limit) throw new Error(`${key} non valido`);
    if (requireRows && list.length === 0) throw new Error(`${key} vuoto`);
    return list.map((item, index) => assertSummaryHit(item, `${key}[${index}]`));
  };
  const readNamed = (key: string): AnacOperatorNamedCount[] => {
    const list = row[key];
    if (!Array.isArray(list) || list.length > limit) throw new Error(`${key} non valido`);
    if (requireRows && list.length === 0) throw new Error(`${key} vuoto`);
    return list.map((item, index) => assertSummaryNamed(item, `${key}[${index}]`));
  };
  const readCpv = (key: string): AnacOperatorCpvCount[] => {
    const list = row[key];
    if (!Array.isArray(list) || list.length > limit) throw new Error(`${key} non valido`);
    if (requireRows && list.length === 0) throw new Error(`${key} vuoto`);
    return list.map((item, index) => assertSummaryCpv(item, `${key}[${index}]`));
  };
  return {
    schemaVersion: 1,
    dataset: DATASET,
    generatedAt: row.generatedAt as string,
    basis: {
      operators: basis.operators,
      procedures: basis.procedures,
      limit,
      moneyNature: basis.moneyNature,
      note: basis.note,
    },
    coverage: {
      operators: assertNonNegInt(coverage.operators, "coverage.operators"),
      uniqueMatchedCigsCounted: assertNonNegInt(
        coverage.uniqueMatchedCigsCounted,
        "coverage.uniqueMatchedCigsCounted",
      ),
      distinctCpvLabels: assertNonNegInt(coverage.distinctCpvLabels, "coverage.distinctCpvLabels"),
      distinctContractingAuthorities: assertNonNegInt(
        coverage.distinctContractingAuthorities,
        "coverage.distinctContractingAuthorities",
      ),
      distinctProcedureObjects: assertNonNegInt(
        coverage.distinctProcedureObjects,
        "coverage.distinctProcedureObjects",
      ),
      skippedNonInformativeOggetto:
        coverage.skippedNonInformativeOggetto === undefined
          ? undefined
          : assertNonNegInt(coverage.skippedNonInformativeOggetto, "skippedOggetto"),
      skippedNonInformativeCpv:
        coverage.skippedNonInformativeCpv === undefined
          ? undefined
          : assertNonNegInt(coverage.skippedNonInformativeCpv, "skippedCpv"),
    },
    topOperatorsByAwardCount: readHits("topOperatorsByAwardCount"),
    topOperatorsByAttributedValue: readHits("topOperatorsByAttributedValue"),
    topCpv: readCpv("topCpv"),
    topContractingAuthorities: readNamed("topContractingAuthorities"),
    topProcedureObjects: readNamed("topProcedureObjects"),
  };
}

function loadSourceSpecSha(): string {
  const raw = readFileSync(join(repoRoot(), SOURCE_SPEC_PATH));
  return sha256Bytes(raw);
}

/** Read a committed artifact under an open fd so size checks cannot race the body. */
function readStableUtf8(path: string, maxBytes: number, label: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`${label} non e un file`);
    if (before.size > maxBytes) throw new Error(`${label} troppo grande`);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`${label} cambiato durante la lettura`);
    }
    return bytes.toString("utf8");
  } catch (error) {
    if (error instanceof Error && /troppo grande|cambiato durante|non e un file/.test(error.message)) {
      throw error;
    }
    throw new Error(`${label} assente`);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function loadAnacOperatorIndexMeta(): AnacOperatorIndexMeta {
  if (cachedMeta) return cachedMeta;
  const path = artifactPath("meta.json");
  const meta = assertAnacOperatorIndexMeta(JSON.parse(readStableUtf8(path, MAX_META_BYTES, "meta operatori")));
  if (meta.sourceSpecSha256 !== loadSourceSpecSha()) {
    throw new Error("sourceSpecSha256 operatori non allineato");
  }
  const searchPath = artifactPath("search.jsonl.gz");
  if (!existsSync(searchPath) || statSync(searchPath).size !== meta.search.bytes) {
    throw new Error("search index operatori non allineato");
  }
  if (sha256File(searchPath) !== meta.search.sha256) {
    throw new Error("SHA-256 search operatori non allineato");
  }
  for (const shard of meta.shards) {
    const shardPath = artifactPath("operators", `${shard.id}.jsonl.gz`);
    if (!existsSync(shardPath) || statSync(shardPath).size !== shard.bytes) {
      throw new Error(`shard operatori ${shard.id} non allineato`);
    }
    if (sha256File(shardPath) !== shard.sha256) {
      throw new Error(`SHA-256 shard operatori ${shard.id} non allineato`);
    }
  }
  if (meta.summaries) {
    const summariesPath = artifactPath("summaries.json");
    if (!existsSync(summariesPath) || statSync(summariesPath).size !== meta.summaries.bytes) {
      throw new Error("summaries.json non allineato");
    }
    if (sha256File(summariesPath) !== meta.summaries.sha256) {
      throw new Error("SHA-256 summaries.json non allineato");
    }
  }
  cachedMeta = meta;
  return meta;
}

/** National ranking tables for the operatori hub (source-locked). */
export function loadAnacOperatorNationalSummaries(): AnacOperatorNationalSummaries {
  if (cachedSummaries) return cachedSummaries;
  const meta = loadAnacOperatorIndexMeta();
  if (!meta.summaries) {
    throw new Error("summaries nazionali assenti");
  }
  const path = artifactPath("summaries.json");
  const summaries = assertNationalSummaries(
    JSON.parse(readStableUtf8(path, MAX_SUMMARIES_BYTES, "summaries.json")),
  );
  if (summaries.coverage.operators !== meta.totals.operators) {
    throw new Error("summaries.operators non riconcilia totals");
  }
  if (summaries.topOperatorsByAwardCount.length > meta.summaries.limit) {
    throw new Error("summaries operatori oltre il limite meta");
  }
  cachedSummaries = summaries;
  return summaries;
}

function loadSearchIndex(): readonly AnacOperatorSearchHit[] {
  if (cachedSearch) return cachedSearch;
  const meta = loadAnacOperatorIndexMeta();
  const text = readGunzipped(artifactPath("search.jsonl.gz"), MAX_SEARCH_BYTES);
  const hits = parseJsonl(text, assertSearchHit, MAX_SEARCH_RECORDS);
  if (hits.length !== meta.totals.operators) {
    throw new Error("conteggio search operatori non allineato");
  }
  cachedSearch = hits;
  return hits;
}

export function searchAnacOperators(options?: {
  q?: string | string[];
  limit?: number;
}): AnacOperatorSearchResult {
  const meta = loadAnacOperatorIndexMeta();
  const raw = Array.isArray(options?.q) ? options?.q[0] ?? "" : options?.q ?? "";
  const trimmed = String(raw).trim().slice(0, MAX_QUERY_LENGTH);
  const normalizedQuery = normalizeSearchQuery(trimmed);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(options?.limit) ? Number(options?.limit) : DEFAULT_LIMIT),
  );
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return { query: trimmed, normalizedQuery, hits: [], matched: 0, limit, meta };
  }
  const index = loadSearchIndex();
  const matchedHits = index
    .filter((hit) => hit.searchKey.includes(normalizedQuery))
    .sort((left, right) => {
      const leftPrefix = left.searchKey.startsWith(normalizedQuery) ? 0 : 1;
      const rightPrefix = right.searchKey.startsWith(normalizedQuery) ? 0 : 1;
      if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;
      if (right.awardCount !== left.awardCount) return right.awardCount - left.awardCount;
      return left.name.localeCompare(right.name, "it");
    });
  return {
    query: trimmed,
    normalizedQuery,
    hits: matchedHits.slice(0, limit),
    matched: matchedHits.length,
    limit,
    meta,
  };
}

export type AnacOperatorRankBy = "awardCount" | "attributedValue";

export type AnacOperatorTopResult = Readonly<{
  rankBy: AnacOperatorRankBy;
  hits: readonly AnacOperatorSearchHit[];
  limit: number;
  meta: AnacOperatorIndexMeta;
}>;

export type AnacOperatorPageResult = Readonly<{
  rankBy: AnacOperatorRankBy;
  hits: readonly AnacOperatorSearchHit[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  meta: AnacOperatorIndexMeta;
}>;

const DEFAULT_TOP_LIMIT = 40;
const MAX_TOP_LIMIT = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function compareAttributedValue(left: string, right: string): number {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
    return right.localeCompare(left, "en");
  }
  return rightValue - leftValue;
}

function parseRankBy(raw: AnacOperatorRankBy | string | string[] | undefined): AnacOperatorRankBy {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "attributedValue" || value === "valore" ? "attributedValue" : "awardCount";
}

let cachedSortedByCount: AnacOperatorSearchHit[] | null = null;
let cachedSortedByValue: AnacOperatorSearchHit[] | null = null;

function sortedOperatorIndex(rankBy: AnacOperatorRankBy): readonly AnacOperatorSearchHit[] {
  if (rankBy === "attributedValue") {
    if (!cachedSortedByValue) {
      cachedSortedByValue = [...loadSearchIndex()].sort((left, right) => {
        const byValue = compareAttributedValue(left.attributedValue, right.attributedValue);
        if (byValue !== 0) return byValue;
        if (right.awardCount !== left.awardCount) return right.awardCount - left.awardCount;
        return left.name.localeCompare(right.name, "it");
      });
    }
    return cachedSortedByValue;
  }
  if (!cachedSortedByCount) {
    cachedSortedByCount = [...loadSearchIndex()].sort((left, right) => {
      if (right.awardCount !== left.awardCount) return right.awardCount - left.awardCount;
      const byValue = compareAttributedValue(left.attributedValue, right.attributedValue);
      if (byValue !== 0) return byValue;
      return left.name.localeCompare(right.name, "it");
    });
  }
  return cachedSortedByCount;
}

/** Top operators by count or attributed award value. Descriptive ranking only. */
export function listTopAnacOperators(options?: {
  by?: AnacOperatorRankBy | string | string[];
  limit?: number;
}): AnacOperatorTopResult {
  const meta = loadAnacOperatorIndexMeta();
  const rankBy = parseRankBy(options?.by);
  const limit = Math.min(
    MAX_TOP_LIMIT,
    Math.max(1, Number.isFinite(options?.limit) ? Number(options?.limit) : DEFAULT_TOP_LIMIT),
  );
  return { rankBy, hits: sortedOperatorIndex(rankBy).slice(0, limit), limit, meta };
}

/** Paginated national operator list (all operators, ranked). */
export function listAnacOperatorsPage(options?: {
  by?: AnacOperatorRankBy | string | string[];
  page?: number | string | string[];
  pageSize?: number;
}): AnacOperatorPageResult {
  const meta = loadAnacOperatorIndexMeta();
  const rankBy = parseRankBy(options?.by);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(options?.pageSize) ? Number(options?.pageSize) : DEFAULT_PAGE_SIZE),
  );
  const rawPage = Array.isArray(options?.page) ? options?.page[0] : options?.page;
  const requested = Number.parseInt(String(rawPage ?? "1"), 10);
  const total = meta.totals.operators;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pageCount) : 1;
  const start = (page - 1) * pageSize;
  return {
    rankBy,
    hits: sortedOperatorIndex(rankBy).slice(start, start + pageSize),
    page,
    pageSize,
    total,
    pageCount,
    meta,
  };
}

/** Load operator details for many refs with one shard read per bucket. */
export function loadAnacOperatorsByRefs(refs: readonly string[]): Map<string, AnacOperatorRecord> {
  loadAnacOperatorIndexMeta();
  const wanted = [...new Set(refs.filter((ref) => OPERATOR_REF.test(ref)))];
  const out = new Map<string, AnacOperatorRecord>();
  const missingByBucket = new Map<string, string[]>();
  for (const ref of wanted) {
    if (operatorCache.has(ref)) {
      const cached = operatorCache.get(ref);
      if (cached) out.set(ref, cached);
      continue;
    }
    const bucket = createHash("sha256").update(ref).digest("hex").slice(0, 2);
    const list = missingByBucket.get(bucket) ?? [];
    list.push(ref);
    missingByBucket.set(bucket, list);
  }
  for (const [bucket, bucketRefs] of missingByBucket) {
    const text = readGunzipped(artifactPath("operators", `${bucket}.jsonl.gz`), MAX_SHARD_BYTES);
    const records = parseJsonl(text, assertOperatorRecord, 50_000);
    const wantedSet = new Set(bucketRefs);
    for (const record of records) {
      operatorCache.set(record.ref, record);
      if (wantedSet.has(record.ref)) out.set(record.ref, record);
    }
    for (const ref of bucketRefs) {
      if (!operatorCache.has(ref)) operatorCache.set(ref, null);
    }
  }
  return out;
}

export function getAnacOperatorByRef(ref: string): AnacOperatorRecord | null {
  if (!OPERATOR_REF.test(ref)) return null;
  if (operatorCache.has(ref)) return operatorCache.get(ref) ?? null;
  loadAnacOperatorIndexMeta();
  const bucket = createHash("sha256").update(ref).digest("hex").slice(0, 2);
  const text = readGunzipped(artifactPath("operators", `${bucket}.jsonl.gz`), MAX_SHARD_BYTES);
  const records = parseJsonl(text, assertOperatorRecord, 50_000);
  let found: AnacOperatorRecord | null = null;
  for (const record of records) {
    operatorCache.set(record.ref, record);
    if (record.ref === ref) found = record;
  }
  if (!found) operatorCache.set(ref, null);
  return found;
}

export function isAnacOperatorRef(value: string): boolean {
  return OPERATOR_REF.test(value);
}

export const ANAC_OPERATOR_INDEX = {
  dataset: DATASET,
  sourceSpecPath: SOURCE_SPEC_PATH,
  parentSpecPath: PARENT_SPEC_PATH,
  minQueryLength: MIN_QUERY_LENGTH,
  maxAwardsPublished: MAX_AWARDS_PUBLISHED,
  defaultTopLimit: DEFAULT_TOP_LIMIT,
  defaultPageSize: DEFAULT_PAGE_SIZE,
} as const;
