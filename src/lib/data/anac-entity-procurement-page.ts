import "server-only";

import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { IpaEntity } from "@/lib/ipa";

const DATASET = "anac-entity-procurement-page" as const;
const COHORT = "cig-2025-full" as const;
const SOURCE_SPEC_PATH = "scripts/etl/specs/anac-entity-procurement-page.source.json";
const PARENT_SPEC_PATH = "scripts/etl/specs/anac-entity-procurement.source.json";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const PREFIX = /^[a-f0-9]{2}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CIG = /^[A-Z0-9]{10}$/;
const AWARD_ID = /^[0-9]+$/;
const OPERATOR_REF = /^op-[0-9]{6}$/;
const ENTITY_PLACEHOLDERS = new Set([
  "", "-", "*", "N/A", "NA", "N.D.", "ND", "NULL", "NONE",
  "00000000000", "XXXXXXXXXXX", "XXXXXXXXXXXXXXXX",
]);
const CF_ODD_VALUES: Record<string, number> = {
  ...Object.fromEntries("0123456789".split("").map((char, index) => [char, [1, 0, 5, 7, 9, 13, 15, 17, 19, 21][index]])),
  ...Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((char, index) => [char, [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23][index]])),
};
const CF_EVEN_VALUES: Record<string, number> = Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((char, index) => [char, index]));
const MAX_META_BYTES = 1_000_000;
const MAX_SHARD_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_RECORDS_PER_SHARD = 20_000;
const MAX_OPERATORS = 10_000;
const MAX_PROCEDURES = 100_000;
const MAX_AWARDS = 250_000;
const MAX_CACHE_ENTRIES = 8;
const LIMITATIONS = [
  "CIG, aggiudicazioni, aggiudicatari, stazioni e IPA sono snapshot cross-temporali",
  "la copertura nazionale corrente non e dichiarata",
  "il valore e importo di aggiudicazione dichiarato, non pagamento",
  "gli award multi-operatore o con identita irrisolte restano nel totale ente ma non nel ranking per valore",
  "ranking e drill-down sono descrittivi e non indicano illeciti",
] as const;

export type AnacAmountStatus =
  | "positive-exact-cent"
  | "positive-subcent"
  | "zero"
  | "negative"
  | "missing"
  | "invalid"
  | "conflicting";

export type AnacAwardAttribution =
  | "single-operator"
  | "multipart"
  | "ambiguous"
  | "no-awardee";

export type AnacEntityProcurementPageRecord = Readonly<{
  schemaVersion: 1;
  codiceIpa: string;
  codiceFiscaleEnte: string;
  summary: Readonly<{
    procedureCount: number;
    awardCount: number;
    awardValue: string;
    positiveAwardCount: number;
    awardeeCount: number;
    awardsWithStableAwardees: number;
    awardsWithoutStableAwardees: number;
    singleOperatorAwards: number;
    multipartOrAmbiguousAwards: number;
    attributedAwardValue: string;
    unattributedAwardValue: string;
  }>;
  operators: readonly Readonly<{
    ref: string;
    name: string;
    nameVariants: number;
    awardCount: number;
    attributedAwardCount: number;
    attributedValue: string;
    rankByCount: number;
    rankByValue: number | null;
  }>[];
  procedures: readonly Readonly<{
    cig: string;
    publishedAt: string | null;
  }>[];
  awards: readonly Readonly<{
    cig: string;
    awardId: string;
    awardedAt: string | null;
    amount: string | null;
    amountStatus: AnacAmountStatus;
    operatorRefs: readonly string[];
    attribution: AnacAwardAttribution;
  }>[];
}>;

export type AnacPageShardMeta = Readonly<{
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  entities: number;
}>;

export type AnacEntityProcurementPageScope = Readonly<{
  cohort: typeof COHORT;
  publicationMonths: readonly number[];
  temporalAlignment: "cross-snapshot";
  nationalPopulationClaim: "not-asserted";
}>;

export type AnacEntityProcurementPageMeta = Readonly<{
  schemaVersion: 1;
  dataset: typeof DATASET;
  distributionKind: string;
  observedAt: string;
  generatedAt: string;
  scope: AnacEntityProcurementPageScope;
  contract: Readonly<Record<string, unknown>>;
  privacy: Readonly<Record<string, unknown>>;
  provenance: Readonly<Record<string, unknown>>;
  coverage: Readonly<Record<string, unknown>>;
  totals: Readonly<Record<string, unknown>>;
  shards: readonly AnacPageShardMeta[];
  sourceSpecSha256: string;
  limitations: readonly string[];
}>;

export type AnacEntityProcurementPageView = Readonly<{
  codiceIpa: string;
  summary: AnacEntityProcurementPageRecord["summary"];
  operators: AnacEntityProcurementPageRecord["operators"];
  procedures: AnacEntityProcurementPageRecord["procedures"];
  awards: AnacEntityProcurementPageRecord["awards"];
  meta: AnacEntityProcurementPageMeta;
}>;

export type AnacEntityProcurementPageState =
  | Readonly<{ status: "available"; profile: AnacEntityProcurementPageView }>
  | Readonly<{
      status: "not_found";
      reason: "entity-not-in-profile" | "no-published-profile";
      message: string;
    }>
  | Readonly<{
      status: "identity_drift";
      message: string;
    }>
  | Readonly<{
      status: "unavailable";
      reason: "artifact-missing" | "artifact-invalid";
      message: string;
    }>;

/** Decode a dynamic entity route without allowing malformed URL escapes to escape the 404 boundary. */
export function decodeEntityProcurementRouteCode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

/** Clamp a requested table page to the pages that actually exist. */
export function clampEntityProcurementPage(value: string, totalRows: number, pageSize: 25 | 50): number {
  const parsed = Number.parseInt(value, 10);
  const requested = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  const rows = Number.isSafeInteger(totalRows) && totalRows > 0 ? totalRows : 0;
  const pages = Math.max(1, Math.ceil(rows / pageSize));
  return Math.min(requested, pages);
}

export type AnacAwardAttributionCounts = Readonly<{
  singleOperator: number;
  multipart: number;
  ambiguous: number;
  noAwardee: number;
  notAttributed: number;
}>;

/** Derive the public attribution caveat from the records, not copied summary counters. */
export function countAnacAwardAttributions(
  awards: readonly Pick<AnacEntityProcurementPageRecord["awards"][number], "attribution">[],
): AnacAwardAttributionCounts {
  const counts = { singleOperator: 0, multipart: 0, ambiguous: 0, noAwardee: 0 };
  for (const award of awards) {
    if (award.attribution === "single-operator") counts.singleOperator += 1;
    else if (award.attribution === "multipart") counts.multipart += 1;
    else if (award.attribution === "ambiguous") counts.ambiguous += 1;
    else if (award.attribution === "no-awardee") counts.noAwardee += 1;
  }
  return { ...counts, notAttributed: counts.multipart + counts.ambiguous + counts.noAwardee };
}

type JsonObject = Record<string, unknown>;

const EXPECTED_META_KEYS = [
  "schemaVersion",
  "dataset",
  "distributionKind",
  "observedAt",
  "generatedAt",
  "scope",
  "contract",
  "privacy",
  "provenance",
  "coverage",
  "totals",
  "shards",
  "sourceSpecSha256",
  "limitations",
] as const;
const EXPECTED_SCOPE_KEYS = [
  "cohort",
  "publicationMonths",
  "temporalAlignment",
  "nationalPopulationClaim",
] as const;
const EXPECTED_SHARD_KEYS = ["id", "path", "bytes", "sha256", "entities"] as const;
const EXPECTED_RECORD_KEYS = [
  "schemaVersion",
  "codiceIpa",
  "codiceFiscaleEnte",
  "summary",
  "operators",
  "procedures",
  "awards",
] as const;
const EXPECTED_SUMMARY_KEYS = [
  "procedureCount",
  "awardCount",
  "awardValue",
  "positiveAwardCount",
  "awardeeCount",
  "awardsWithStableAwardees",
  "awardsWithoutStableAwardees",
  "singleOperatorAwards",
  "multipartOrAmbiguousAwards",
  "attributedAwardValue",
  "unattributedAwardValue",
] as const;
const EXPECTED_OPERATOR_KEYS = [
  "ref",
  "name",
  "nameVariants",
  "awardCount",
  "attributedAwardCount",
  "attributedValue",
  "rankByCount",
  "rankByValue",
] as const;
const EXPECTED_PROCEDURE_KEYS = ["cig", "publishedAt"] as const;
const EXPECTED_AWARD_KEYS = [
  "cig",
  "awardId",
  "awardedAt",
  "amount",
  "amountStatus",
  "operatorRefs",
  "attribution",
] as const;
const EXPECTED_IPA_PROVENANCE_KEYS = [
  "datasetPageUrl", "resourcePageUrl", "resourceId", "downloadUrl", "sourceLastModified",
  "metadataModifiedAt", "assetObservedAt", "bytes", "sha256", "rows", "headers", "delimiter", "encoding", "license",
] as const;
const EXPECTED_PARENT_PROVENANCE_KEYS = [
  "datasetPageUrl", "resourcePageUrl", "resourceUrl", "resourceId", "sourceLastModified",
  "assetObservedAt", "archiveBytes", "archiveSha256", "member", "delimiter", "encoding", "headers",
  "parentSpecPath", "parentSpecSha256", "parentInputKey", "license",
] as const;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ANAC entity page: ${label} non valido.`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort().join("\u001f");
  const wanted = [...expected].sort().join("\u001f");
  if (actual !== wanted) throw new Error(`ANAC entity page: chiavi inattese in ${label}.`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ANAC entity page: ${label} non valido.`);
  }
  return value;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

function validNumericTaxChecksum(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const oddIndexes = [0, 2, 4, 6, 8, 10];
  const evenIndexes = [1, 3, 5, 7, 9];
  const odd = oddIndexes.reduce((sum, index) => sum + Number(value[index]), 0);
  const even = evenIndexes.reduce((sum, index) => {
    const doubled = Number(value[index]) * 2;
    return sum + (doubled < 10 ? doubled : doubled - 9);
  }, 0);
  return (odd + even) % 10 === 0;
}

function validPersonTaxChecksum(value: string): boolean {
  if (!/^[A-Z0-9]{16}$/.test(value)) return false;
  let total = 0;
  for (let index = 0; index < 15; index += 1) {
    const character = value[index];
    if (!character) return false;
    if (index % 2 === 0) {
      total += CF_ODD_VALUES[character] ?? -100;
    } else {
      total += CF_EVEN_VALUES[character] ?? (Number.isInteger(Number(character)) ? Number(character) : -100);
    }
  }
  return total >= 0 && String.fromCharCode("A".charCodeAt(0) + (total % 26)) === value[15];
}

function validEntityCf(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizedText(value);
  if (normalized !== value || ENTITY_PLACEHOLDERS.has(normalized)) return false;
  return validNumericTaxChecksum(normalized) || validPersonTaxChecksum(normalized);
}

function validCig(value: unknown): value is string {
  return typeof value === "string" && value === normalizedText(value) && CIG.test(value);
}

function validAwardId(value: unknown): value is string {
  return typeof value === "string" && value === normalizedText(value) && AWARD_ID.test(value) && /[1-9]/.test(value);
}

function nonNegativeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`ANAC entity page: ${label} non valido.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed < 1) throw new Error(`ANAC entity page: ${label} non valido.`);
  return parsed;
}

function sha256(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!SHA256.test(candidate)) throw new Error(`ANAC entity page: SHA-256 ${label} non valido.`);
  return candidate;
}

function instant(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!INSTANT.test(candidate)) throw new Error(`ANAC entity page: ${label} non valido.`);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed) || `${new Date(parsed).toISOString().slice(0, 19)}Z` !== candidate) {
    throw new Error(`ANAC entity page: ${label} non valido.`);
  }
  return candidate;
}

function date(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!DATE.test(candidate)) throw new Error(`ANAC entity page: ${label} non valido.`);
  const parsed = Date.parse(`${candidate}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== candidate) {
    throw new Error(`ANAC entity page: ${label} non valido.`);
  }
  return candidate;
}

function nullableDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  return date(value, label);
}

function decimal(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!DECIMAL.test(candidate)) throw new Error(`ANAC entity page: decimale ${label} non valido.`);
  if (addDecimals(candidate, "0") !== candidate) throw new Error(`ANAC entity page: decimale ${label} non canonico.`);
  return candidate;
}

function signedDecimal(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!SIGNED_DECIMAL.test(candidate)) throw new Error(`ANAC entity page: decimale ${label} non valido.`);
  const unsigned = candidate.startsWith("-") ? candidate.slice(1) : candidate;
  const canonical = addDecimals(unsigned, "0");
  if (candidate.startsWith("-") ? canonical === "0" || `-${canonical}` !== candidate : canonical !== candidate) {
    throw new Error(`ANAC entity page: decimale ${label} non canonico.`);
  }
  return candidate;
}

function decimalParts(value: string): [bigint, number] {
  const [whole, fraction = ""] = value.split(".");
  return [BigInt(`${whole}${fraction}`), fraction.length];
}

function addDecimals(left: string, right: string): string {
  const [leftInteger, leftScale] = decimalParts(left);
  const [rightInteger, rightScale] = decimalParts(right);
  const scale = Math.max(leftScale, rightScale);
  const total = leftInteger * BigInt(10) ** BigInt(scale - leftScale) + rightInteger * BigInt(10) ** BigInt(scale - rightScale);
  if (scale === 0) return total.toString();
  const digits = total.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function sumDecimals(values: readonly string[]): string {
  return values.reduce((sum, value) => addDecimals(sum, value), "0");
}

function compareDecimals(left: string, right: string): number {
  const [leftInteger, leftScale] = decimalParts(left);
  const [rightInteger, rightScale] = decimalParts(right);
  const scale = Math.max(leftScale, rightScale);
  const scaledLeft = leftInteger * BigInt(10) ** BigInt(scale - leftScale);
  const scaledRight = rightInteger * BigInt(10) ** BigInt(scale - rightScale);
  return scaledLeft < scaledRight ? -1 : scaledLeft > scaledRight ? 1 : 0;
}

function isPositiveAmountStatus(status: AnacAmountStatus): boolean {
  return status === "positive-exact-cent" || status === "positive-subcent";
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftObject = left as JsonObject;
    const rightObject = right as JsonObject;
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftObject[key], rightObject[key]));
  }
  return false;
}

function hasCompleteInputLock(value: JsonObject): boolean {
  return "archiveBytes" in value && "archiveSha256" in value && "member" in value && "headers" in value;
}

function completeParentInputProvenance(
  sourceSpec: JsonObject,
  parentSpec: JsonObject,
  key: "awards" | "awardees",
): JsonObject | null {
  const sourceInputs = sourceSpec.inputs && typeof sourceSpec.inputs === "object" && !Array.isArray(sourceSpec.inputs)
    ? sourceSpec.inputs as JsonObject
    : null;
  const sourceCandidate = sourceInputs && sourceInputs[key] && typeof sourceInputs[key] === "object" && !Array.isArray(sourceInputs[key])
    ? sourceInputs[key] as JsonObject
    : sourceSpec[key] && typeof sourceSpec[key] === "object" && !Array.isArray(sourceSpec[key])
      ? sourceSpec[key] as JsonObject
      : null;
  const parentInputs = object(parentSpec.inputs, "parent source spec.inputs");
  const parentCandidate = parentInputs[key] && typeof parentInputs[key] === "object" && !Array.isArray(parentInputs[key])
    ? parentInputs[key] as JsonObject
    : null;
  const direct = sourceCandidate && hasCompleteInputLock(sourceCandidate)
    ? sourceCandidate
    : parentCandidate && hasCompleteInputLock(parentCandidate)
      ? parentCandidate
      : null;
  if (direct) return direct;

  // The page parent normally stores only the parent reference. Resolve the
  // referenced source spec to compare a complete lock when the producer emits
  // it, while keeping the older compact artifact readable during transition.
  const reference = parentCandidate;
  const parentSpecPath = reference && typeof reference.parentSpecPath === "string" ? reference.parentSpecPath : null;
  if (!reference || !parentSpecPath) return null;
  const detailPath = resolve(process.cwd(), "scripts/etl/specs", parentSpecPath);
  if (!existsSync(detailPath)) return null;
  const detailBytes = readFileSync(detailPath);
  const detailSpec = object(JSON.parse(detailBytes.toString("utf8")) as unknown, `${key} parent source spec`);
  const detailInputs = object(detailSpec.inputs, `${key} parent source spec.inputs`);
  const detailCandidate = object(detailInputs[key], `${key} parent source spec input`);
  if (!hasCompleteInputLock(detailCandidate)) return null;
  const detailHash = createHash("sha256").update(detailBytes).digest("hex");
  return {
    ...detailCandidate,
    assetObservedAt: detailCandidate.assetObservedAt ?? null,
    parentSpecPath: "scripts/etl/specs/" + parentSpecPath,
    parentSpecSha256: detailHash,
    parentInputKey: key,
    license: reference.license ?? detailCandidate.license ?? detailSpec.license,
  };
}

function validateUrl(value: unknown, label: string): string {
  const candidate = text(value, label);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") throw new Error("protocol");
  } catch {
    throw new Error(`ANAC entity page: ${label} non valido.`);
  }
  return candidate;
}

function validateLicense(value: unknown, label: string): void {
  const license = object(value, label);
  exactKeys(license, ["name", "url"], label);
  text(license.name, `${label}.name`);
  validateUrl(license.url, `${label}.url`);
}

function validateMember(value: unknown, label: string): void {
  const member = object(value, label);
  exactKeys(member, ["name", "bytes", "sha256", "crc32"], label);
  text(member.name, `${label}.name`);
  nonNegativeInteger(member.bytes, `${label}.bytes`);
  sha256(member.sha256, `${label}.sha256`);
  text(member.crc32, `${label}.crc32`);
}

function validateParentInputProvenance(value: unknown, label: string, key: "awards" | "awardees"): void {
  const input = object(value, label);
  exactKeys(input, EXPECTED_PARENT_PROVENANCE_KEYS, label);
  validateUrl(input.datasetPageUrl, `${label}.datasetPageUrl`);
  validateUrl(input.resourcePageUrl, `${label}.resourcePageUrl`);
  validateUrl(input.resourceUrl, `${label}.resourceUrl`);
  text(input.resourceId, `${label}.resourceId`);
  if (!(input.resourcePageUrl as string).includes(input.resourceId as string)) {
    throw new Error(`ANAC entity page: resourceId ${label} non riconciliato.`);
  }
  text(input.sourceLastModified, `${label}.sourceLastModified`);
  if (input.assetObservedAt !== null) instant(input.assetObservedAt, `${label}.assetObservedAt`);
  nonNegativeInteger(input.archiveBytes, `${label}.archiveBytes`);
  sha256(input.archiveSha256, `${label}.archiveSha256`);
  validateMember(input.member, `${label}.member`);
  if (input.delimiter !== ";" || input.encoding !== "utf-8-sig") {
    throw new Error(`ANAC entity page: formato ${label} inatteso.`);
  }
  if (!Array.isArray(input.headers) || input.headers.some((header) => typeof header !== "string" || header.length === 0)) {
    throw new Error(`ANAC entity page: headers ${label} inattesi.`);
  }
  if (input.parentSpecPath !== "scripts/etl/specs/anac-awardees.source.json") {
    throw new Error(`ANAC entity page: parentSpecPath ${label} inatteso.`);
  }
  sha256(input.parentSpecSha256, `${label}.parentSpecSha256`);
  if (input.parentInputKey !== key) throw new Error(`ANAC entity page: parentInputKey ${label} inatteso.`);
  validateLicense(input.license, `${label}.license`);
}

function validateIpaProvenance(value: unknown, label: string): void {
  const ipa = object(value, label);
  exactKeys(ipa, EXPECTED_IPA_PROVENANCE_KEYS, label);
  validateUrl(ipa.datasetPageUrl, `${label}.datasetPageUrl`);
  validateUrl(ipa.resourcePageUrl, `${label}.resourcePageUrl`);
  validateUrl(ipa.downloadUrl, `${label}.downloadUrl`);
  text(ipa.resourceId, `${label}.resourceId`);
  text(ipa.sourceLastModified, `${label}.sourceLastModified`);
  text(ipa.metadataModifiedAt, `${label}.metadataModifiedAt`);
  instant(ipa.assetObservedAt, `${label}.assetObservedAt`);
  nonNegativeInteger(ipa.bytes, `${label}.bytes`);
  nonNegativeInteger(ipa.rows, `${label}.rows`);
  sha256(ipa.sha256, `${label}.sha256`);
  if (!Array.isArray(ipa.headers) || ipa.headers.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`ANAC entity page: headers ${label} non validi.`);
  }
  validateLicense(ipa.license, `${label}.license`);
  if (ipa.delimiter !== "," || ipa.encoding !== "utf-8-sig") {
    throw new Error(`ANAC entity page: formato ${label} inatteso.`);
  }
}

function validateSourceSpecProvenance(meta: AnacEntityProcurementPageMeta): void {
  const sourceSpecFile = resolve(process.cwd(), SOURCE_SPEC_PATH);
  const parentSpecFile = resolve(process.cwd(), PARENT_SPEC_PATH);
  const sourceSpecBytes = readFileSync(sourceSpecFile);
  const parentSpecBytes = readFileSync(parentSpecFile);
  const sourceSpec = object(JSON.parse(sourceSpecBytes.toString("utf8")) as unknown, "source spec");
  const parentSpec = object(JSON.parse(parentSpecBytes.toString("utf8")) as unknown, "parent source spec");
  const sourceSpecKeys = ["schemaVersion", "dataset", "distributionKind", "observedAt", "scope", "parent", "ipa", "contract", "privacy"];
  if ("inputs" in sourceSpec) sourceSpecKeys.push("inputs");
  if ("awards" in sourceSpec) sourceSpecKeys.push("awards");
  if ("awardees" in sourceSpec) sourceSpecKeys.push("awardees");
  exactKeys(sourceSpec, sourceSpecKeys, "source spec");
  if (sourceSpec.schemaVersion !== 1 || sourceSpec.dataset !== DATASET || sourceSpec.distributionKind !== meta.distributionKind) {
    throw new Error("ANAC entity page: intestazione source spec inattesa.");
  }
  const sourceHash = createHash("sha256").update(sourceSpecBytes).digest("hex");
  const parentHash = createHash("sha256").update(parentSpecBytes).digest("hex");
  const parentRef = object(sourceSpec.parent, "source spec.parent");
  exactKeys(parentRef, ["path", "sha256"], "source spec.parent");
  if (parentRef.path !== PARENT_SPEC_PATH || parentRef.sha256 !== parentHash) throw new Error("ANAC entity page: parent source spec drift.");
  if (meta.observedAt !== sourceSpec.observedAt || meta.sourceSpecSha256 !== sourceHash) throw new Error("ANAC entity page: source spec drift.");
  if (!deepEqual(meta.scope, sourceSpec.scope) || !deepEqual(meta.contract, sourceSpec.contract) || !deepEqual(meta.privacy, sourceSpec.privacy)) {
    throw new Error("ANAC entity page: contratto meta diverso dal source spec.");
  }
  validateIpaProvenance(sourceSpec.ipa, "source spec.ipa");
  const parentInputs = object(parentSpec.inputs, "parent source spec.inputs");
  const cigInputs = parentInputs.cig;
  const stations = object(parentInputs.stations, "parent source spec.inputs.stations");
  if (!Array.isArray(cigInputs) || cigInputs.length !== 12) throw new Error("ANAC entity page: input CIG nel source spec non valido.");
  const expectedProvenance: JsonObject = {
    sourceSpec: { path: SOURCE_SPEC_PATH, sha256: sourceHash },
    parentSourceSpec: { path: PARENT_SPEC_PATH, sha256: parentHash },
    anacCatalogObservedAt: parentSpec.catalogObservedAt ?? null,
    anacCatalogMetadataModifiedAt: parentSpec.catalogMetadataModifiedAt ?? null,
    anacAssetObservedAt: {
      cig: cigInputs.map((entry) => object(entry, "source spec input CIG").assetObservedAt),
      stations: stations.assetObservedAt,
    },
    ipa: sourceSpec.ipa,
  };
  const awardProvenance = completeParentInputProvenance(sourceSpec, parentSpec, "awards");
  const awardeeProvenance = completeParentInputProvenance(sourceSpec, parentSpec, "awardees");
  if (!awardProvenance || !awardeeProvenance) throw new Error("ANAC entity page: provenance awards/awardees incompleta.");
  expectedProvenance.awards = awardProvenance;
  expectedProvenance.awardees = awardeeProvenance;
  if (!deepEqual(meta.provenance, expectedProvenance)) throw new Error("ANAC entity page: provenance source drift.");
}

function shardPrefix(shard: AnacPageShardMeta): string {
  const match = /^src\/data\/generated\/anac-entity-procurement-page\/entities\/([a-f0-9]{2})\.jsonl\.gz$/.exec(shard.path);
  if (!match) throw new Error("ANAC entity page: path shard inatteso.");
  return match[1] ?? "";
}

function validateMeta(value: unknown): AnacEntityProcurementPageMeta {
  const meta = object(value, "meta");
  exactKeys(meta, EXPECTED_META_KEYS, "meta");
  if (meta.schemaVersion !== 1 || meta.dataset !== DATASET) {
    throw new Error("ANAC entity page: schema meta inatteso.");
  }
  if (meta.distributionKind !== "sharded-public-profile") {
    throw new Error("ANAC entity page: distributionKind inatteso.");
  }
  const observedAt = instant(meta.observedAt, "meta.observedAt");
  const generatedAt = instant(meta.generatedAt, "meta.generatedAt");
  if (generatedAt < observedAt) throw new Error("ANAC entity page: generatedAt precede observedAt.");
  const scope = object(meta.scope, "meta.scope");
  exactKeys(scope, EXPECTED_SCOPE_KEYS, "meta.scope");
  if (
    scope.cohort !== COHORT ||
    scope.temporalAlignment !== "cross-snapshot" ||
    scope.nationalPopulationClaim !== "not-asserted" ||
    !Array.isArray(scope.publicationMonths) ||
    scope.publicationMonths.length !== MONTHS.length ||
    scope.publicationMonths.some((month, index) => month !== MONTHS[index])
  ) {
    throw new Error("ANAC entity page: scope non valido.");
  }
  scope.publicationMonths.forEach((month, index) => nonNegativeInteger(month, `scope.publicationMonths[${index}]`, 12));
  const contract = object(meta.contract, "meta.contract");
  exactKeys(contract, [
    "entityJoin", "procedureKey", "awardKey", "awardAmountAggregation", "countRanking",
    "valueRanking", "operatorDisplayName", "shards", "shardRule", "compression",
  ], "meta.contract");
  if (
    contract.entityJoin !== "exact-checksum-valid-tax-code-to-unique-codice-ipa" ||
    JSON.stringify(contract.procedureKey) !== JSON.stringify(["cig"]) ||
    JSON.stringify(contract.awardKey) !== JSON.stringify(["cig", "id_aggiudicazione"]) ||
    contract.awardAmountAggregation !== "once-per-distinct-award-pair" ||
    contract.countRanking !== "distinct-operator-award-pair" ||
    contract.valueRanking !== "single-resolved-operator-awards-only" ||
    contract.operatorDisplayName !== "most-frequent-normalized-denomination-then-lexical" ||
    contract.shards !== 256 ||
    contract.shardRule !== "first-two-hex-sha256-of-codice-ipa" ||
    contract.compression !== "deterministic-gzip-mtime-zero"
  ) throw new Error("ANAC entity page: contratto di pubblicazione non valido.");
  const privacy = object(meta.privacy, "meta.privacy");
  exactKeys(privacy, [
    "containsEntityTaxIds", "containsOperatorTaxIds", "containsOperatorTaxIdHashes",
    "containsOperatorNames", "operatorNamesUsedAsKeys", "containsAusa", "containsRawRows",
  ], "meta.privacy");
  if (
    privacy.containsEntityTaxIds !== true ||
    privacy.containsOperatorTaxIds !== false ||
    privacy.containsOperatorTaxIdHashes !== false ||
    privacy.containsOperatorNames !== true ||
    privacy.operatorNamesUsedAsKeys !== false ||
    privacy.containsAusa !== false ||
    privacy.containsRawRows !== false
  ) throw new Error("ANAC entity page: contratto privacy non valido.");
  const provenance = object(meta.provenance, "meta.provenance");
  const provenanceKeys = [
    "sourceSpec", "parentSourceSpec", "anacCatalogObservedAt", "anacCatalogMetadataModifiedAt",
    "anacAssetObservedAt", "ipa",
  ];
  const hasAwards = "awards" in provenance;
  const hasAwardees = "awardees" in provenance;
  if (!hasAwards || !hasAwardees) throw new Error("ANAC entity page: provenance awards/awardees incompleta.");
  provenanceKeys.push("awards", "awardees");
  exactKeys(provenance, provenanceKeys, "meta.provenance");
  const sourceSpec = object(provenance.sourceSpec, "meta.provenance.sourceSpec");
  exactKeys(sourceSpec, ["path", "sha256"], "meta.provenance.sourceSpec");
  if (sourceSpec.path !== SOURCE_SPEC_PATH) throw new Error("ANAC entity page: source spec path inatteso.");
  sha256(sourceSpec.sha256, "meta.provenance.sourceSpec.sha256");
  if (meta.sourceSpecSha256 !== sourceSpec.sha256) throw new Error("ANAC entity page: sourceSpecSha256 non riconciliato.");
  const parentSourceSpec = object(provenance.parentSourceSpec, "meta.provenance.parentSourceSpec");
  exactKeys(parentSourceSpec, ["path", "sha256"], "meta.provenance.parentSourceSpec");
  if (parentSourceSpec.path !== PARENT_SPEC_PATH) throw new Error("ANAC entity page: parent source spec path inatteso.");
  sha256(parentSourceSpec.sha256, "meta.provenance.parentSourceSpec.sha256");
  if (provenance.anacCatalogObservedAt !== null) instant(provenance.anacCatalogObservedAt, "meta.provenance.anacCatalogObservedAt");
  if (provenance.anacCatalogMetadataModifiedAt !== null) {
    text(provenance.anacCatalogMetadataModifiedAt, "meta.provenance.anacCatalogMetadataModifiedAt");
  }
  const observed = object(provenance.anacAssetObservedAt, "meta.provenance.anacAssetObservedAt");
  exactKeys(observed, ["cig", "stations"], "meta.provenance.anacAssetObservedAt");
  if (!Array.isArray(observed.cig) || observed.cig.length !== 12) throw new Error("ANAC entity page: provenance CIG non valido.");
  observed.cig.forEach((item, index) => instant(item, `meta.provenance.anacAssetObservedAt.cig[${index}]`));
  instant(observed.stations, "meta.provenance.anacAssetObservedAt.stations");
  validateIpaProvenance(provenance.ipa, "meta.provenance.ipa");
  validateParentInputProvenance(provenance.awards, "meta.provenance.awards", "awards");
  validateParentInputProvenance(provenance.awardees, "meta.provenance.awardees", "awardees");
  const coverage = object(meta.coverage, "meta.coverage");
  exactKeys(coverage, [
    "ipaRows", "ipaRowsWithUniqueValidTaxCode", "ipaAmbiguousTaxCodes", "ipaCodes",
    "ipaRowsWithMissingOrInvalidTaxCode", "resolvedAnacEntityTaxCodes", "linkedEntityProfiles",
    "resolvedAnacEntityTaxCodesWithoutIpa", "awardeeRows",
  ], "meta.coverage");
  for (const key of [
    "ipaRows", "ipaRowsWithUniqueValidTaxCode", "ipaAmbiguousTaxCodes", "ipaCodes",
    "ipaRowsWithMissingOrInvalidTaxCode", "resolvedAnacEntityTaxCodes", "linkedEntityProfiles",
    "resolvedAnacEntityTaxCodesWithoutIpa",
  ]) nonNegativeInteger(coverage[key], `meta.coverage.${key}`);
  if ((coverage.ipaRows as number) !==
      (coverage.ipaRowsWithUniqueValidTaxCode as number) + (coverage.ipaRowsWithMissingOrInvalidTaxCode as number)) {
    throw new Error("ANAC entity page: partizione IPA non riconciliata.");
  }
  if (
    coverage.ipaCodes !== coverage.ipaRows ||
    coverage.ipaAmbiguousTaxCodes !== 0 ||
    coverage.linkedEntityProfiles !== coverage.ipaRowsWithUniqueValidTaxCode
  ) {
    throw new Error("ANAC entity page: crosswalk IPA non riconciliato.");
  }
  if ((coverage.resolvedAnacEntityTaxCodesWithoutIpa as number) > (coverage.resolvedAnacEntityTaxCodes as number)) {
    throw new Error("ANAC entity page: differenza CF ANAC/IPA non valida.");
  }
  const awardeeRows = object(coverage.awardeeRows, "meta.coverage.awardeeRows");
  exactKeys(awardeeRows, [
    "rawRows", "ineligibleKeyRows", "knownKeyRows", "eligibleKeyRows", "outOfCohortRows",
    "resolvedRows", "unresolvedRows",
  ], "meta.coverage.awardeeRows");
  for (const key of [
    "rawRows", "ineligibleKeyRows", "knownKeyRows", "eligibleKeyRows", "outOfCohortRows",
    "resolvedRows", "unresolvedRows",
  ]) {
    nonNegativeInteger(awardeeRows[key], `meta.coverage.awardeeRows.${key}`);
  }
  if ((awardeeRows.rawRows as number) !==
      (awardeeRows.ineligibleKeyRows as number) + (awardeeRows.knownKeyRows as number) ||
      (awardeeRows.knownKeyRows as number) !==
      (awardeeRows.eligibleKeyRows as number) + (awardeeRows.outOfCohortRows as number) ||
      (awardeeRows.eligibleKeyRows as number) !==
      (awardeeRows.resolvedRows as number) + (awardeeRows.unresolvedRows as number)) {
    throw new Error("ANAC entity page: partizione awardee non riconciliata.");
  }
  const totals = object(meta.totals, "meta.totals");
  exactKeys(totals, [
    "entities", "procedures", "awards", "operators", "awardeeRelations", "positiveAwards",
    "awardValue", "attributedAwardValue", "unattributedAwardValue",
  ], "meta.totals");
  for (const key of ["entities", "procedures", "awards", "operators", "awardeeRelations", "positiveAwards"]) {
    nonNegativeInteger(totals[key], `meta.totals.${key}`);
  }
  decimal(totals.awardValue, "meta.totals.awardValue");
  decimal(totals.attributedAwardValue, "meta.totals.attributedAwardValue");
  decimal(totals.unattributedAwardValue, "meta.totals.unattributedAwardValue");
  if (coverage.linkedEntityProfiles !== totals.entities) {
    throw new Error("ANAC entity page: linkedEntityProfiles non riconciliato con totals.entities.");
  }
  sha256(meta.sourceSpecSha256, "meta.sourceSpecSha256");
  if (!Array.isArray(meta.limitations) || !deepEqual(meta.limitations, LIMITATIONS)) throw new Error("ANAC entity page: limitations non valide.");
  if (!Array.isArray(meta.shards) || meta.shards.length === 0 || meta.shards.length > 256) {
    throw new Error("ANAC entity page: shards non validi.");
  }
  const paths = new Set<string>();
  const ids = new Set<string>();
  let shardEntities = 0;
  for (const [index, rawShard] of meta.shards.entries()) {
    const shard = object(rawShard, `meta.shards[${index}]`);
    exactKeys(shard, EXPECTED_SHARD_KEYS, `meta.shards[${index}]`);
    const id = text(shard.id, `meta.shards[${index}].id`);
    if (!PREFIX.test(id)) throw new Error("ANAC entity page: id shard non valido.");
    if (ids.has(id)) throw new Error("ANAC entity page: id shard duplicato.");
    ids.add(id);
    const path = text(shard.path, `meta.shards[${index}].path`);
    if (!/^src\/data\/generated\/anac-entity-procurement-page\/entities\/[a-f0-9]{2}\.jsonl\.gz$/.test(path) || paths.has(path)) {
      throw new Error("ANAC entity page: path shard duplicato o inatteso.");
    }
    paths.add(path);
    if (id !== path.match(/([a-f0-9]{2})\.jsonl\.gz$/)?.[1]) throw new Error("ANAC entity page: id shard non riconciliato.");
    nonNegativeInteger(shard.bytes, `meta.shards[${index}].bytes`, MAX_SHARD_BYTES);
    sha256(shard.sha256, `meta.shards[${index}].sha256`);
    const entities = nonNegativeInteger(shard.entities, `meta.shards[${index}].entities`, MAX_RECORDS_PER_SHARD);
    shardEntities += entities;
  }
  if (meta.shards.length !== 256 || ids.size !== 256 || [...Array(256).keys()].some((index) => !ids.has(index.toString(16).padStart(2, "0")))) {
    throw new Error("ANAC entity page: servono esattamente 256 shard.");
  }
  if (totals.entities !== shardEntities) throw new Error("ANAC entity page: totals.entities non riconciliato.");
  validateSourceSpecProvenance(meta as AnacEntityProcurementPageMeta);
  return meta as AnacEntityProcurementPageMeta;
}

function validateRecord(value: unknown, prefix: string): AnacEntityProcurementPageRecord {
  const record = object(value, "record");
  exactKeys(record, EXPECTED_RECORD_KEYS, "record");
  if (record.schemaVersion !== 1) throw new Error("ANAC entity page: schema record inatteso.");
  const codiceIpa = text(record.codiceIpa, "record.codiceIpa");
  if (!CODE.test(codiceIpa) || createHash("sha256").update(codiceIpa).digest("hex").slice(0, 2) !== prefix) {
    throw new Error("ANAC entity page: codice IPA o shard non valido.");
  }
  const cf = text(record.codiceFiscaleEnte, "record.codiceFiscaleEnte");
  if (!validEntityCf(cf)) throw new Error("ANAC entity page: codice fiscale ente non valido.");
  const summary = object(record.summary, "record.summary");
  exactKeys(summary, EXPECTED_SUMMARY_KEYS, "record.summary");
  const summaryNumbers = [
    "procedureCount", "awardCount", "positiveAwardCount", "awardeeCount",
    "awardsWithStableAwardees", "awardsWithoutStableAwardees", "singleOperatorAwards",
    "multipartOrAmbiguousAwards",
  ] as const;
  for (const key of summaryNumbers) nonNegativeInteger(summary[key], `summary.${key}`);
  decimal(summary.awardValue, "summary.awardValue");
  decimal(summary.attributedAwardValue, "summary.attributedAwardValue");
  decimal(summary.unattributedAwardValue, "summary.unattributedAwardValue");
  if ((summary.awardsWithStableAwardees as number) + (summary.awardsWithoutStableAwardees as number) !== summary.awardCount) {
    throw new Error("ANAC entity page: awardee coverage non riconciliata.");
  }
  if (summary.attributedAwardValue === "0" && summary.unattributedAwardValue === "0" && summary.awardValue !== "0") {
    throw new Error("ANAC entity page: importi non riconciliati.");
  }
  if (addDecimals(summary.attributedAwardValue as string, summary.unattributedAwardValue as string) !== summary.awardValue) {
    throw new Error("ANAC entity page: somma importi non riconciliata.");
  }

  if (!Array.isArray(record.operators) || record.operators.length > MAX_OPERATORS) throw new Error("ANAC entity page: operators non validi.");
  const refs = new Set<string>();
  for (const [index, rawOperator] of record.operators.entries()) {
    const operator = object(rawOperator, `operators[${index}]`);
    exactKeys(operator, EXPECTED_OPERATOR_KEYS, `operators[${index}]`);
    const ref = text(operator.ref, `operators[${index}].ref`);
    if (!OPERATOR_REF.test(ref) || refs.has(ref)) throw new Error("ANAC entity page: ref operatore duplicato o non valido.");
    refs.add(ref);
    text(operator.name, `operators[${index}].name`);
    nonNegativeInteger(operator.nameVariants, `operators[${index}].nameVariants`);
    nonNegativeInteger(operator.awardCount, `operators[${index}].awardCount`);
    nonNegativeInteger(operator.attributedAwardCount, `operators[${index}].attributedAwardCount`);
    decimal(operator.attributedValue, `operators[${index}].attributedValue`);
    positiveInteger(operator.rankByCount, `operators[${index}].rankByCount`);
    if (operator.rankByValue !== null) positiveInteger(operator.rankByValue, `operators[${index}].rankByValue`);
  }
  if ((summary.awardeeCount as number) !== record.operators.length) throw new Error("ANAC entity page: awardeeCount non riconciliato.");
  const operatorNames = new Map<string, string>();
  for (const rawOperator of record.operators) {
    const operator = object(rawOperator, "operator");
    operatorNames.set(operator.ref as string, operator.name as string);
  }

  if (!Array.isArray(record.procedures) || record.procedures.length > MAX_PROCEDURES) throw new Error("ANAC entity page: procedures non valide.");
  const cigs = new Set<string>();
  for (const [index, rawProcedure] of record.procedures.entries()) {
    const procedure = object(rawProcedure, `procedures[${index}]`);
    exactKeys(procedure, EXPECTED_PROCEDURE_KEYS, `procedures[${index}]`);
    const cig = text(procedure.cig, `procedures[${index}].cig`);
    if (!validCig(cig)) throw new Error("ANAC entity page: CIG non valido.");
    if (cigs.has(cig)) throw new Error("ANAC entity page: CIG duplicato.");
    cigs.add(cig);
    nullableDate(procedure.publishedAt, `procedures[${index}].publishedAt`);
  }
  if ((summary.procedureCount as number) !== record.procedures.length) throw new Error("ANAC entity page: procedureCount non riconciliato.");

  if (!Array.isArray(record.awards) || record.awards.length > MAX_AWARDS) throw new Error("ANAC entity page: awards non validi.");
  const awardKeys = new Set<string>();
  const positiveAmounts: string[] = [];
  const attributionValues = new Set<AnacAwardAttribution>([
    "single-operator", "multipart", "ambiguous", "no-awardee",
  ]);
  const attributionCounts: Record<AnacAwardAttribution, number> = {
    "single-operator": 0,
    multipart: 0,
    ambiguous: 0,
    "no-awardee": 0,
  };
  const relationCounts = new Map<string, number>([...refs].map((ref) => [ref, 0]));
  const attributedCounts = new Map<string, number>([...refs].map((ref) => [ref, 0]));
  const attributedValues = new Map<string, string>([...refs].map((ref) => [ref, "0"]));
  let computedAttributedValue = "0";
  let computedUnattributedValue = "0";
  for (const [index, rawAward] of record.awards.entries()) {
    const award = object(rawAward, `awards[${index}]`);
    exactKeys(award, EXPECTED_AWARD_KEYS, `awards[${index}]`);
    const cig = text(award.cig, `awards[${index}].cig`);
    if (!validCig(cig)) throw new Error("ANAC entity page: CIG non valido.");
    if (!cigs.has(cig)) throw new Error("ANAC entity page: award CIG senza procedura.");
    const awardId = text(award.awardId, `awards[${index}].awardId`);
    if (!validAwardId(awardId)) throw new Error("ANAC entity page: awardId non valido.");
    const key = `${cig}\u001f${awardId}`;
    if (awardKeys.has(key)) throw new Error("ANAC entity page: award duplicato.");
    awardKeys.add(key);
    nullableDate(award.awardedAt, `awards[${index}].awardedAt`);
    if (award.amount !== null) signedDecimal(award.amount, `awards[${index}].amount`);
    if (![
      "positive-exact-cent", "positive-subcent", "zero", "negative", "missing", "invalid", "conflicting",
    ].includes(award.amountStatus as string)) throw new Error("ANAC entity page: amountStatus non valido.");
    if (!Array.isArray(award.operatorRefs) || award.operatorRefs.length > 100) throw new Error("ANAC entity page: operatorRefs non validi.");
    const awardRefs = new Set<string>();
    for (const ref of award.operatorRefs) {
      if (typeof ref !== "string" || !refs.has(ref) || awardRefs.has(ref)) throw new Error("ANAC entity page: operatorRef non valido.");
      awardRefs.add(ref);
      relationCounts.set(ref, (relationCounts.get(ref) ?? 0) + 1);
    }
    if (!attributionValues.has(award.attribution as AnacAwardAttribution)) throw new Error("ANAC entity page: attribution non valido.");
    if (
      (award.attribution === "single-operator" && award.operatorRefs.length !== 1) ||
      (award.attribution === "multipart" && award.operatorRefs.length < 2)
    ) throw new Error("ANAC entity page: attribution non riconciliata.");
    if (award.attribution === "no-awardee" && award.operatorRefs.length !== 0) {
      throw new Error("ANAC entity page: no-awardee con operatori non riconciliato.");
    }
    attributionCounts[award.attribution as AnacAwardAttribution] += 1;
    const amountStatus = award.amountStatus as AnacAmountStatus;
    const amount = award.amount as string | null;
    if (isPositiveAmountStatus(amountStatus)) {
      if (amount === null || !DECIMAL.test(amount) || compareDecimals(amount, "0") <= 0) {
        throw new Error("ANAC entity page: stato positivo senza importo positivo.");
      }
      const fractionLength = amount.split(".")[1]?.length ?? 0;
      const exactCent = fractionLength <= 2;
      if ((amountStatus === "positive-exact-cent") !== exactCent) {
        throw new Error("ANAC entity page: stato centesimi incoerente.");
      }
      positiveAmounts.push(amount);
    } else if (amountStatus === "zero") {
      if (amount !== "0") throw new Error("ANAC entity page: zero senza importo zero canonico.");
    } else if (amountStatus === "negative") {
      if (amount === null || !amount.startsWith("-") || compareDecimals(amount, "0") >= 0) {
        throw new Error("ANAC entity page: negative senza importo negativo.");
      }
    } else if (amount !== null) {
      throw new Error("ANAC entity page: stato importo senza valore nullo.");
    }
    if (isPositiveAmountStatus(amountStatus) && award.attribution === "single-operator") {
      const ref = (award.operatorRefs as string[])[0];
      if (!ref || amount === null) throw new Error("ANAC entity page: award singolo senza relazione.");
      attributedCounts.set(ref, (attributedCounts.get(ref) ?? 0) + 1);
      attributedValues.set(ref, addDecimals(attributedValues.get(ref) ?? "0", amount));
      computedAttributedValue = addDecimals(computedAttributedValue, amount);
    } else if (isPositiveAmountStatus(amountStatus) && amount !== null) {
      computedUnattributedValue = addDecimals(computedUnattributedValue, amount);
    }
  }
  const countOrder = [...refs].sort((left, right) => {
    const difference = (relationCounts.get(right) ?? 0) - (relationCounts.get(left) ?? 0);
    return difference || (operatorNames.get(left) ?? "").localeCompare(operatorNames.get(right) ?? "", "it") || left.localeCompare(right);
  });
  const valueRefs = [...refs].filter((ref) => (attributedValues.get(ref) ?? "0") !== "0");
  const valueOrder = valueRefs.sort((left, right) => {
    const difference = compareDecimals(attributedValues.get(right) ?? "0", attributedValues.get(left) ?? "0");
    return difference || (operatorNames.get(left) ?? "").localeCompare(operatorNames.get(right) ?? "", "it") || left.localeCompare(right);
  });
  const countRanks = new Map<string, number>();
  let previousCount: number | null = null;
  let countRank = 0;
  countOrder.forEach((ref, index) => {
    const count = relationCounts.get(ref) ?? 0;
    if (previousCount === null || count !== previousCount) {
      previousCount = count;
      countRank = index + 1;
    }
    countRanks.set(ref, countRank);
  });
  const valueRanks = new Map<string, number>();
  let previousValue: string | null = null;
  let valueRank = 0;
  valueOrder.forEach((ref, index) => {
    const value = attributedValues.get(ref) ?? "0";
    if (previousValue === null || compareDecimals(value, previousValue) !== 0) {
      previousValue = value;
      valueRank = index + 1;
    }
    valueRanks.set(ref, valueRank);
  });
  for (const rawOperator of record.operators) {
    const operator = object(rawOperator, "operator");
    const ref = operator.ref as string;
    if ((relationCounts.get(ref) ?? 0) < 1) throw new Error("ANAC entity page: operatore senza relazione award.");
    if (
      operator.awardCount !== (relationCounts.get(ref) ?? 0) ||
      operator.attributedAwardCount !== (attributedCounts.get(ref) ?? 0) ||
      operator.attributedValue !== (attributedValues.get(ref) ?? "0") ||
      operator.rankByCount !== countRanks.get(ref) ||
      operator.rankByValue !== (valueRanks.get(ref) ?? null)
    ) throw new Error("ANAC entity page: metriche operatore non riconciliate.");
  }
  if ((summary.awardCount as number) !== record.awards.length) throw new Error("ANAC entity page: awardCount non riconciliato.");
  if ((summary.positiveAwardCount as number) !== positiveAmounts.length) throw new Error("ANAC entity page: positiveAwardCount non riconciliato.");
  if (sumDecimals(positiveAmounts) !== summary.awardValue) {
    throw new Error("ANAC entity page: awardValue non riconciliato.");
  }
  if (computedAttributedValue !== summary.attributedAwardValue || computedUnattributedValue !== summary.unattributedAwardValue) {
    throw new Error("ANAC entity page: attribuzione valore non riconciliata.");
  }
  if (summary.singleOperatorAwards !== attributionCounts["single-operator"] ||
      summary.multipartOrAmbiguousAwards !== attributionCounts.multipart + attributionCounts.ambiguous ||
      summary.awardsWithStableAwardees !== attributionCounts["single-operator"] + attributionCounts.multipart ||
      summary.awardsWithoutStableAwardees !== attributionCounts.ambiguous + attributionCounts["no-awardee"]) {
    throw new Error("ANAC entity page: attribution coverage non riconciliata.");
  }
  return record as AnacEntityProcurementPageRecord;
}

function artifactRoot(rootDirectory?: string): string {
  return resolve(rootDirectory ?? process.cwd(), "src/data/generated/anac-entity-procurement-page");
}

function projectRootFromArtifact(root: string): string {
  return resolve(root, "../../../..");
}

type ShardFingerprint = Readonly<{ size: number; mtimeMs: number; ctimeMs: number; ino: number }>;

function fingerprintFromStat(stat: { size: number; mtimeMs: number; ctimeMs: number; ino: number }): ShardFingerprint {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
}

function readStableFile(
  path: string,
  label: string,
  maxBytes: number,
): Readonly<{ bytes: Buffer; fingerprint: ShardFingerprint }> {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) throw new Error(`ANAC entity page: ${label} oltre il limite.`);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const beforeFingerprint = fingerprintFromStat(before);
    const afterFingerprint = fingerprintFromStat(after);
    if (
      !sameShardFingerprint(beforeFingerprint, afterFingerprint) ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`ANAC entity page: ${label} cambiato durante la lettura.`);
    }
    return { bytes, fingerprint: afterFingerprint };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ANAC entity page:")) throw error;
    throw new Error(`ANAC entity page: ${label} assente.`);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function readJson(path: string, label: string): unknown {
  const { bytes } = readStableFile(path, label, MAX_META_BYTES);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`ANAC entity page: ${label} non è JSON valido.`);
  }
}

function shardFilePath(root: string, shardMeta: AnacPageShardMeta): string {
  const path = join(projectRootFromArtifact(root), shardMeta.path);
  const entitiesRoot = join(projectRootFromArtifact(root), "src/data/generated/anac-entity-procurement-page/entities");
  if (!path.startsWith(entitiesRoot + "/")) throw new Error("ANAC entity page: path shard fuori directory.");
  return path;
}

function shardFingerprint(path: string): ShardFingerprint {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("ANAC entity page: shard non è un file.");
    return fingerprintFromStat(stat);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ANAC entity page:")) throw error;
    throw new Error("ANAC entity page: shard assente.");
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function sameShardFingerprint(left: ShardFingerprint, right: ShardFingerprint): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.ino === right.ino;
}

type LoadedShard = Readonly<{ records: AnacEntityProcurementPageRecord[]; fingerprint: ShardFingerprint }>;

function readShard(root: string, shardMeta: AnacPageShardMeta): LoadedShard {
  const prefix = shardPrefix(shardMeta);
  const path = shardFilePath(root, shardMeta);
  const { bytes: compressed, fingerprint } = readStableFile(path, `shard ${prefix}`, MAX_SHARD_BYTES);
  if (compressed.byteLength !== shardMeta.bytes) {
    throw new Error(`ANAC entity page: bytes shard ${prefix} divergenti.`);
  }
  const digest = createHash("sha256").update(compressed).digest("hex");
  if (digest !== shardMeta.sha256) throw new Error(`ANAC entity page: SHA shard ${prefix} divergente.`);
  let uncompressed: Buffer;
  try {
    uncompressed = gunzipSync(compressed);
  } catch {
    throw new Error(`ANAC entity page: gzip shard ${prefix} non valido.`);
  }
  if (uncompressed.byteLength > MAX_UNCOMPRESSED_BYTES) throw new Error("ANAC entity page: decompressione oltre il limite.");
  const content = uncompressed.toString("utf8");
  if (!content.endsWith("\n")) throw new Error(`ANAC entity page: newline shard ${prefix} mancante.`);
  const lines = content.slice(0, -1).split("\n");
  if (lines.length !== shardMeta.entities || lines.length > MAX_RECORDS_PER_SHARD) {
    throw new Error(`ANAC entity page: record shard ${prefix} divergenti.`);
  }
  const records = lines.map((line, index) => {
    if (!line) throw new Error(`ANAC entity page: riga vuota nello shard ${prefix}.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`ANAC entity page: JSON riga ${index + 1} non valido.`);
    }
    return validateRecord(parsed, prefix);
  });
  return { records, fingerprint };
}

type CachedShard = Readonly<{ records: readonly AnacEntityProcurementPageRecord[]; fingerprint: ShardFingerprint }>;
const shardCache = new Map<string, CachedShard>();
function cachedShard(root: string, shard: AnacPageShardMeta): readonly AnacEntityProcurementPageRecord[] {
  const key = `${root}\u001f${shard.path}\u001f${shard.sha256}`;
  const path = shardFilePath(root, shard);
  const fingerprint = shardFingerprint(path);
  const cached = shardCache.get(key);
  if (cached && sameShardFingerprint(cached.fingerprint, fingerprint)) return cached.records;
  const loaded = readShard(root, shard);
  if (shardCache.size >= MAX_CACHE_ENTRIES) shardCache.delete(shardCache.keys().next().value as string);
  shardCache.set(key, loaded);
  return loaded.records;
}

export function assertAnacEntityProcurementPageMeta(value: unknown): AnacEntityProcurementPageMeta {
  return validateMeta(value);
}

export function assertAnacEntityProcurementPageRecord(value: unknown, prefix = "00"): AnacEntityProcurementPageRecord {
  if (!PREFIX.test(prefix)) throw new Error("ANAC entity page: prefisso non valido.");
  return validateRecord(value, prefix);
}

export function safeEntityProcurementPageProfile(
  record: AnacEntityProcurementPageRecord,
  meta: AnacEntityProcurementPageMeta,
): AnacEntityProcurementPageView {
  // codiceFiscaleEnte is intentionally discarded at the public/domain boundary.
  const { codiceIpa, summary, operators, procedures, awards } = record;
  return { codiceIpa, summary, operators, procedures, awards, meta };
}

export async function loadAnacEntityProcurementPage(
  args: Readonly<{ codiceIpa: string; currentEntityCf: string | null; rootDirectory?: string }>,
): Promise<AnacEntityProcurementPageState> {
  const codiceIpa = args.codiceIpa.trim();
  if (!CODE.test(codiceIpa)) {
    return { status: "not_found", reason: "entity-not-in-profile", message: "Codice IPA non valido." };
  }
  const root = artifactRoot(args.rootDirectory);
  try {
    const meta = validateMeta(readJson(join(root, "meta.json"), "meta"));
    const prefix = createHash("sha256").update(codiceIpa).digest("hex").slice(0, 2);
    const shard = meta.shards.find((candidate) => shardPrefix(candidate) === prefix);
    if (!shard) return { status: "not_found", reason: "entity-not-in-profile", message: "Nessun profilo ANAC pubblicato per questo ente." };
    const record = cachedShard(root, shard).find((candidate) => candidate.codiceIpa === codiceIpa);
    if (!record) return { status: "not_found", reason: "entity-not-in-profile", message: "Nessun profilo ANAC pubblicato per questo ente." };
    if (!validEntityCf(args.currentEntityCf) || record.codiceFiscaleEnte !== normalizedText(args.currentEntityCf)) {
      return { status: "identity_drift", message: "Il codice fiscale IPA corrente non coincide con il profilo ANAC bloccato." };
    }
    return { status: "available", profile: safeEntityProcurementPageProfile(record, meta) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Artifact ANAC non disponibile.";
    const reason = message.includes("assente") ? "artifact-missing" : "artifact-invalid";
    return { status: "unavailable", reason, message };
  }
}

export async function getEntityProcurementPage(
  entity: Pick<IpaEntity, "codiceIpa" | "codiceFiscale">,
  options: Readonly<{ rootDirectory?: string }> = {},
): Promise<AnacEntityProcurementPageState> {
  return loadAnacEntityProcurementPage({
    codiceIpa: entity.codiceIpa,
    currentEntityCf: entity.codiceFiscale,
    rootDirectory: options.rootDirectory,
  });
}

export const ANAC_ENTITY_PROCUREMENT_PAGE_SCOPE = {
  cohort: COHORT,
  publicationMonths: MONTHS,
  temporalAlignment: "cross-snapshot",
  nationalPopulationClaim: "not-asserted",
} as const;
