import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sourceSpecJson from "../../../scripts/etl/specs/anac-entity-procurement.source.json" with { type: "json" };
import parentSpecJson from "../../../scripts/etl/specs/anac-awardees.source.json" with { type: "json" };

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CIG_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const AMOUNT_STATUSES = [
  "missing",
  "invalid",
  "negative",
  "zero",
  "positive-exact-cent",
  "positive-subcent",
  "conflicting",
] as const;
const PROCEDURE_DATE_STATUSES = [
  "missing",
  "invalid",
  "before-1990",
  "future",
  "valid",
] as const;
const SOURCE_SPEC_PATH = "scripts/etl/specs/anac-entity-procurement.source.json" as const;
const PARENT_SPEC_PATH = "scripts/etl/specs/anac-awardees.source.json" as const;
const SOURCE_SPEC_FILE = new URL("../../../scripts/etl/specs/anac-entity-procurement.source.json", import.meta.url);
const PARENT_SPEC_FILE = new URL("../../../scripts/etl/specs/anac-awardees.source.json", import.meta.url);
const ANAC_LICENSE = {
  name: "CC BY-SA 4.0",
  url: "https://w3id.org/italia/controlled-vocabulary/licences/A31_CCBYSA40",
} as const;
const STATIONS_LICENSE = {
  name: "CC BY 4.0",
  url: "https://w3id.org/italia/controlled-vocabulary/licences/A21_CCBY40",
} as const;

type JsonObject = Record<string, unknown>;
type AmountStatus = (typeof AMOUNT_STATUSES)[number];
type Counter = Record<string, number>;

const SOURCE_SPEC = sourceSpecJson as unknown as JsonObject;
const PARENT_SPEC = parentSpecJson as unknown as JsonObject;

const REGISTRY_COUNTER_KEYS = new Set([
  "rowsTotal", "rowsWithAusa", "rowsWithCf", "rowsWithEntityCf", "rowsWithNonstandardCf",
  "distinctAusa", "distinctCf", "cfWithMultipleAusa", "status:ATTIVO",
  "status:CESSATO", "status:(other)", "status:(missing)",
]);
const PROCEDURE_COUNTER_KEYS = new Set([
  "rawRows", "primaryRows", "nonPrimaryRows", "distinctRawCigs", "cigsWithExactlyOnePrimary",
  "cigsWithoutPrimary", "cigsWithMultiplePrimary", "distinctCigs",
  ...PROCEDURE_DATE_STATUSES.map((status) => `publicationDate:${status}`),
  ...AMOUNT_STATUSES.map((status) => `lotAmount:${status}`),
  "identity:resolved", "identity:unresolved", "identity:conflict",
]);
const IDENTITY_COUNTER_KEYS = new Set([
  "resolved", "unresolved", "conflict",
  "via:ausa-and-cf", "via:ausa-only", "via:cf-fallback", "via:missing-both",
  "via:ausa-invalid", "via:ausa-not-in-registry", "via:ausa-cf-conflict", "via:cf-invalid",
  "via:cf-placeholder", "via:cf-not-in-registry", "via:ambiguous-cf", "via:registry-cf-nonstandard",
  "via:ausa-without-entity-cf", "via:publication-date-unusable", "via:ausa-outside-registry-interval",
  "via:cf-no-active-station",
]);
const AWARD_COUNTER_KEYS = new Set([
  "rawRows", "knownKeyRows", "ineligibleKeyRows", "distinctAwards", "duplicateKeyRows", "duplicateKeyGroups",
  "amountConflictGroups", "awardDateConflictGroups", "criticalConflictGroups",
  "conflictingAwardKeys",
  "exactDuplicateRows", "nonIdenticalDuplicateRows",
  ...["missing", "missing-sentinel", "invalid", "known"].map((status) => `id:${status}`),
  ...AMOUNT_STATUSES.map((status) => `amount:${status}`),
  ...PROCEDURE_DATE_STATUSES.map((status) => `awardDate:${status}`),
]);
const AWARDEE_COUNTER_KEYS = new Set([
  "rawRows", "knownKeyRows", "ineligibleKeyRows", "distinctJoinPairs",
  "exactDuplicateRows", "pairsWithMultipleAwardeeRows",
  "id:missing", "id:missing-sentinel", "id:invalid", "id:known",
]);
const LIMITATIONS = [
  "full-snapshot cross-temporal: CIG, aggiudicazioni e aggiudicatari non sono una fotografia sincronizzata",
  "nationalPopulationClaim non-asserted: il risultato non è una copertura nazionale corrente",
  "nessuna inferenza di spreco, illecito, ranking o HHI in questo slice",
  "denominazioni e deleghe sono conservate nella sorgente ma non sono chiavi dell'identita",
] as const;

export type AnacAmountStatusRows = Record<AmountStatus, number>;

export type AnacCigInputLock = {
  month: number;
  fileName: string;
  datasetPageUrl: string;
  resourcePageUrl: string;
  resourceId: string;
  resourceUrl: string;
  sourceLastModified: string;
  assetObservedAt: string;
  archiveBytes: number;
  archiveSha256: string;
  member: {
    name: string;
    bytes: number;
    sha256: string;
    crc32: string;
  };
  license: {
    name: "CC BY-SA 4.0";
    url: typeof ANAC_LICENSE.url;
  };
};

export type AnacStationsInputLock = {
  datasetPageUrl: string;
  datasetLegacyUuid: string;
  resourceName: "stazioni-appaltanti_csv";
  resourceUrl: string;
  sourceLastModified: string;
  catalogMetadataModifiedAt: string;
  assetObservedAt: string;
  archiveBytes: number;
  archiveSha256: string;
  member: {
    name: string;
    bytes: number;
    sha256: string;
    crc32: string;
  };
  license: {
    name: "CC BY 4.0";
    url: typeof STATIONS_LICENSE.url;
  };
};

export type AnacParentInputLock = {
  datasetPageUrl: string;
  resourcePageUrl: string;
  resourceUrl: string;
  resourceId: string;
  sourceLastModified: string;
  archiveBytes: number;
  archiveSha256: string;
  member: {
    name: string;
    bytes: number;
    sha256: string;
    crc32: string;
  };
  delimiter: ";";
  encoding: "utf-8-sig";
  headers: string[];
  parentSpecPath: "scripts/etl/specs/anac-awardees.source.json";
  parentSpecSha256: string;
  parentInputKey: "awards" | "awardees";
  license: {
    name: "CC BY-SA 4.0";
    url: typeof ANAC_LICENSE.url;
  };
};

export type AnacProvenance = {
  catalogObservedAt: string;
  catalogMetadataModifiedAt: string | null;
  assetObservedAt: {
    cig: string[];
    stations: string;
  };
  sourceSpec: {
    path: "scripts/etl/specs/anac-entity-procurement.source.json";
    sha256: string;
  };
  parentSpec: {
    path: "scripts/etl/specs/anac-awardees.source.json";
    sha256: string;
    catalogObservedAt: string;
    catalogMetadataModifiedAt: string | null;
  };
};

export type AnacAmountCoverage = {
  distinctRows: number;
  statusRows: AnacAmountStatusRows;
  "positive-exact-centSum": string;
  "positive-subcentSum": string;
  positiveRows: number;
  positiveSum: string;
};

export type AnacEntityProcurementCoverageManifest = {
  schemaVersion: 1;
  dataset: "anac-entity-procurement-coverage";
  distributionKind: "full-snapshot";
  observedAt: string;
  generatedAt: string;
  scope: {
    cohort: "cig-2025-full";
    publicationMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    nationalPopulationClaim: "not-asserted";
    temporalAlignment: "cross-snapshot";
  };
  contract: {
    stationIdentity: "codice_ausa";
    entityIdentity: "cf_amministrazione_appaltante";
    stationKey: "ausa:<CODICE_AUSA>";
    entityKey: "cf:<CF_AMMINISTRAZIONE_APPALTANTE>";
    procedureKey: ["cig"];
    awardKey: ["cig", "id_aggiudicazione"];
    procedurePeriod: "data_pubblicazione";
    awardPeriod: "data_aggiudicazione_definitiva";
    procedureAmount: "importo_lotto";
    awardAmount: "importo_aggiudicazione";
    amountRepresentation: "exact-decimal";
    awardAmountAggregation: "once-per-distinct-award-pair";
    awardeeMultipartyPolicy: "awardee-rows-never-multiply-award-amount";
  };
  privacy: {
    aggregateOnly: true;
    containsRawRows: false;
    containsRawTaxIds: false;
    containsNames: false;
  };
  provenance: AnacProvenance;
  inputs: {
    cig: AnacCigInputLock[];
    stations: AnacStationsInputLock;
    awards: AnacParentInputLock;
    awardees: AnacParentInputLock;
  };
  coverage: {
    registry: Counter;
    procedures: Counter;
    identity: Counter;
    awards: Counter;
    awardees: Counter;
  };
  amounts: {
    procedureLot: AnacAmountCoverage;
    awardRows: AnacAmountCoverage;
    awardContributionInCohort: AnacAmountCoverage;
    awardeeMultiplication: false;
    lotAndAwardAmountsAreDistinctFields: true;
  };
  reconciliation: {
    awardPairsTotal: number;
    awardPairsInCohort: number;
    awardPairsOutOfCohort: number;
    awardPairsWithAwardees: number;
    awardPairsWithoutAwardees: number;
    awardeePairsTotal: number;
    awardeePairsInCohort: number;
    awardeePairsOutOfCohort: number;
    awardeePairsWithoutAward: number;
  };
  sourceSpecSha256: string;
  limitations: string[];
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Manifest ANAC readiness: ${label} non valido.`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join("\u001f") !== [...expected].sort().join("\u001f")) {
    throw new Error(`Manifest ANAC readiness: campi inattesi in ${label}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Manifest ANAC readiness: ${label} non valido.`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Manifest ANAC readiness: ${label} non valido.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!SHA256.test(candidate)) {
    throw new Error(`Manifest ANAC readiness: SHA-256 ${label} non valido.`);
  }
  return candidate;
}

function instant(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(candidate)) {
    throw new Error(`Manifest ANAC readiness: ${label} non valido.`);
  }
  return candidate;
}

function dateOrInstant(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(candidate)) {
    throw new Error(`Manifest ANAC readiness: ${label} non valido.`);
  }
  return candidate;
}

function nullableDateOrInstant(value: unknown, label: string): string | null {
  if (value === null) return null;
  return dateOrInstant(value, label);
}

function fileSha256(file: URL): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const CURRENT_SOURCE_SPEC_SHA256 = fileSha256(SOURCE_SPEC_FILE);
const CURRENT_PARENT_SPEC_SHA256 = fileSha256(PARENT_SPEC_FILE);

function deepEqual(actual: unknown, expected: unknown, label: string, path = label): void {
  if (Object.is(actual, expected)) return;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      throw new Error(`Manifest ANAC readiness: ${path} diverso dal source spec.`);
    }
    for (let index = 0; index < expected.length; index += 1) {
      deepEqual(actual[index], expected[index], label, `${path}[${index}]`);
    }
    return;
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const actualObject = actual as JsonObject;
    const expectedObject = expected as JsonObject;
    const actualKeys = Object.keys(actualObject).sort();
    const expectedKeys = Object.keys(expectedObject).sort();
    if (actualKeys.join("\u001f") !== expectedKeys.join("\u001f")) {
      throw new Error(`Manifest ANAC readiness: campi inattesi in ${path} rispetto al source spec.`);
    }
    for (const key of expectedKeys) deepEqual(actualObject[key], expectedObject[key], label, `${path}.${key}`);
    return;
  }
  throw new Error(`Manifest ANAC readiness: ${path} diverso dal source spec.`);
}

function sourceSpecObject(value: unknown, label: string): JsonObject {
  return object(value, `source spec ${label}`);
}

function repositoryParentSpecPath(): string {
  const dependencies = sourceSpecObject(SOURCE_SPEC.parentDependencies, "parentDependencies");
  const dependencyPath = text(dependencies.parentSpecPath, "parentDependencies.parentSpecPath");
  const parentBasename = PARENT_SPEC_PATH.slice(PARENT_SPEC_PATH.lastIndexOf("/") + 1);
  if (dependencyPath !== parentBasename) {
    throw new Error("Manifest ANAC readiness: parent source spec inatteso nel source spec.");
  }
  return PARENT_SPEC_PATH;
}

function expectedInputs(): JsonObject {
  const sourceInputs = sourceSpecObject(SOURCE_SPEC.inputs, "inputs");
  const cig = sourceInputs.cig;
  if (!Array.isArray(cig)) throw new Error("Manifest ANAC readiness: source spec CIG non valido.");
  const stations = sourceSpecObject(sourceInputs.stations, "inputs.stations");
  const parentInputs = sourceSpecObject(PARENT_SPEC.inputs, "inputs");
  const dependencies = sourceSpecObject(SOURCE_SPEC.parentDependencies, "parentDependencies");
  if (dependencies.parentSpecSha256 !== CURRENT_PARENT_SPEC_SHA256) {
    throw new Error("Manifest ANAC readiness: hash parent source spec diverso dal source spec.");
  }
  const parentPath = repositoryParentSpecPath();
  const dependencyPath = text(dependencies.parentSpecPath, "parentDependencies.parentSpecPath");
  const result: JsonObject = { cig, stations };
  for (const key of ["awards", "awardees"] as const) {
    const childReference = sourceSpecObject(sourceInputs[key], `inputs.${key}`);
    const parentInput = sourceSpecObject(parentInputs[key], `parent.inputs.${key}`);
    if (childReference.parentSpecPath !== dependencyPath) {
      throw new Error(`Manifest ANAC readiness: parent source spec ${key} diverso dal source spec.`);
    }
    const parentInputKey = text(childReference.parentInputKey, `inputs.${key}.parentInputKey`);
    if (parentInputKey !== key) throw new Error(`Manifest ANAC readiness: parent input key ${key} inattesa.`);
    result[key] = {
      ...parentInput,
      parentSpecPath: parentPath,
      parentSpecSha256: CURRENT_PARENT_SPEC_SHA256,
      parentInputKey,
      license: childReference.license,
    };
  }
  return result;
}

function expectedProvenance(): JsonObject {
  const sourceInputs = sourceSpecObject(SOURCE_SPEC.inputs, "inputs");
  const cig = sourceInputs.cig;
  if (!Array.isArray(cig)) throw new Error("Manifest ANAC readiness: source spec CIG non valido.");
  const stations = sourceSpecObject(sourceInputs.stations, "inputs.stations");
  const parentPath = repositoryParentSpecPath();
  return {
    catalogObservedAt: SOURCE_SPEC.catalogObservedAt,
    catalogMetadataModifiedAt: SOURCE_SPEC.catalogMetadataModifiedAt,
    assetObservedAt: {
      cig: cig.map((entry, index) => sourceSpecObject(entry, `inputs.cig[${index}]`).assetObservedAt),
      stations: stations.assetObservedAt,
    },
    sourceSpec: { path: SOURCE_SPEC_PATH, sha256: CURRENT_SOURCE_SPEC_SHA256 },
    parentSpec: {
      path: parentPath,
      sha256: CURRENT_PARENT_SPEC_SHA256,
      catalogObservedAt: PARENT_SPEC.catalogObservedAt,
      catalogMetadataModifiedAt: PARENT_SPEC.catalogMetadataModifiedAt,
    },
  };
}

function officialAnacUrl(value: unknown, label: string): string {
  const candidate = text(value, label);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Manifest ANAC readiness: ${label} non valido.`);
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== "https://dati.anticorruzione.it" ||
    !url.pathname.startsWith("/opendata/")
  ) {
    throw new Error(`Manifest ANAC readiness: ${label} non ufficiale.`);
  }
  return candidate;
}

function counter(value: unknown, label: string, allowedKeys: ReadonlySet<string>): Counter {
  const candidate = object(value, label);
  exactKeys(candidate, [...allowedKeys], label);
  const result: Counter = {};
  for (const [key, item] of Object.entries(candidate)) {
    if (!key.trim()) {
      throw new Error(`Manifest ANAC readiness: chiave counter ${label} non valida.`);
    }
    if (!allowedKeys.has(key)) {
      throw new Error(
        `Manifest ANAC readiness: chiave counter ${label}.${key} non allowlisted.`,
      );
    }
    result[key] = integer(item, `${label}.${key}`);
  }
  return result;
}

function sumKeys(values: Counter, keys: readonly string[], label: string): number {
  return keys.reduce(
    (sum, key) => sum + (key in values ? integer(values[key], `${label}.${key}`) : 0),
    0,
  );
}

function sumPrefix(values: Counter, prefix: string): number {
  return Object.entries(values).reduce(
    (sum, [key, value]) => sum + (key.startsWith(prefix) ? value : 0),
    0,
  );
}

function validateMember(value: unknown, label: string): AnacCigInputLock["member"] {
  const member = object(value, label);
  exactKeys(member, ["name", "bytes", "sha256", "crc32"], label);
  const name = text(member.name, `${label}.name`);
  if (!name.endsWith(".csv")) throw new Error(`Manifest ANAC readiness: membro ${label} non CSV.`);
  integer(member.bytes, `${label}.bytes`);
  sha256(member.sha256, `${label}.sha256`);
  const crc32 = text(member.crc32, `${label}.crc32`);
  if (!/^[a-f0-9]{8}$/i.test(crc32)) throw new Error(`Manifest ANAC readiness: CRC32 ${label} non valido.`);
  return member as AnacCigInputLock["member"];
}

function validateLicense(
  value: unknown,
  expected: typeof ANAC_LICENSE | typeof STATIONS_LICENSE,
  label: string,
): void {
  const license = object(value, label);
  exactKeys(license, ["name", "url"], label);
  if (license.name !== expected.name || license.url !== expected.url) {
    throw new Error(`Manifest ANAC readiness: licenza ${label} inattesa.`);
  }
}

function validateCigInput(value: unknown, expected: JsonObject, month: number): AnacCigInputLock {
  const input = object(value, `input CIG ${month}`);
  exactKeys(input, Object.keys(expected), `input CIG ${month}`);
  if (input.month !== month) throw new Error(`Manifest ANAC readiness: mese CIG ${month} inatteso.`);
  const fileName = text(input.fileName, `fileName CIG ${month}`);
  if (fileName !== text(expected.fileName, `source spec fileName CIG ${month}`)) {
    throw new Error(`Manifest ANAC readiness: file CIG ${month} inatteso.`);
  }
  officialAnacUrl(input.datasetPageUrl, `pagina CIG ${month}`);
  officialAnacUrl(input.resourcePageUrl, `pagina risorsa CIG ${month}`);
  const resourceId = text(input.resourceId, `resourceId CIG ${month}`);
  if (!UUID.test(resourceId)) {
    throw new Error(`Manifest ANAC readiness: resourceId CIG ${month} non valido.`);
  }
  if (!(input.resourcePageUrl as string).endsWith(`/resource/${resourceId}`)) {
    throw new Error(`Manifest ANAC readiness: resourceId e pagina CIG ${month} non riconciliati.`);
  }
  officialAnacUrl(input.resourceUrl, `URL CIG ${month}`);
  dateOrInstant(input.sourceLastModified, `ultima modifica CIG ${month}`);
  instant(input.assetObservedAt, `osservazione asset CIG ${month}`);
  integer(input.archiveBytes, `byte archivio CIG ${month}`);
  sha256(input.archiveSha256, `SHA archivio CIG ${month}`);
  validateMember(input.member, `membro CIG ${month}`);
  validateLicense(input.license, ANAC_LICENSE, `CIG ${month}`);
  return input as AnacCigInputLock;
}

function validateStationsInput(value: unknown, expected: JsonObject): AnacStationsInputLock {
  const input = object(value, "input stazioni");
  exactKeys(input, Object.keys(expected), "input stazioni");
  officialAnacUrl(input.datasetPageUrl, "pagina stazioni");
  const datasetLegacyUuid = text(input.datasetLegacyUuid, "datasetLegacyUuid stazioni");
  if (!UUID.test(datasetLegacyUuid)) {
    throw new Error("Manifest ANAC readiness: datasetLegacyUuid stazioni non valido.");
  }
  if (input.resourceName !== text(expected.resourceName, "source spec resourceName stazioni")) {
    throw new Error("Manifest ANAC readiness: resource stazioni inattesa.");
  }
  officialAnacUrl(input.resourceUrl, "URL stazioni");
  dateOrInstant(input.sourceLastModified, "ultima modifica stazioni");
  instant(input.assetObservedAt, "osservazione asset stazioni");
  dateOrInstant(input.catalogMetadataModifiedAt, "metadata catalogo stazioni");
  integer(input.archiveBytes, "byte archivio stazioni");
  sha256(input.archiveSha256, "SHA archivio stazioni");
  validateMember(input.member, "membro stazioni");
  validateLicense(input.license, STATIONS_LICENSE, "stazioni");
  return input as AnacStationsInputLock;
}

function validateParent(
  value: unknown,
  expected: JsonObject,
  expectedKey: "awards" | "awardees",
  label: string,
): AnacParentInputLock {
  const parent = object(value, label);
  exactKeys(parent, Object.keys(expected), label);
  officialAnacUrl(parent.datasetPageUrl, `${label}.datasetPageUrl`);
  officialAnacUrl(parent.resourcePageUrl, `${label}.resourcePageUrl`);
  officialAnacUrl(parent.resourceUrl, `${label}.resourceUrl`);
  const resourceId = text(parent.resourceId, `${label}.resourceId`);
  if (!UUID.test(resourceId)) throw new Error(`Manifest ANAC readiness: resourceId ${label} non valido.`);
  if (!(parent.resourcePageUrl as string).endsWith(`/resource/${resourceId}`)) {
    throw new Error(`Manifest ANAC readiness: resourceId e pagina ${label} non riconciliati.`);
  }
  dateOrInstant(parent.sourceLastModified, `${label}.sourceLastModified`);
  integer(parent.archiveBytes, `${label}.archiveBytes`);
  sha256(parent.archiveSha256, `${label}.archiveSha256`);
  validateMember(parent.member, `${label}.member`);
  if (parent.delimiter !== ";" || parent.encoding !== "utf-8-sig") {
    throw new Error(`Manifest ANAC readiness: wire format ${label} inatteso.`);
  }
  if (
    !Array.isArray(parent.headers) ||
    parent.headers.some((header) => typeof header !== "string" || !header.trim())
  ) {
    throw new Error(`Manifest ANAC readiness: header ${label} inatteso.`);
  }
  if (
    parent.parentSpecPath !== text(expected.parentSpecPath, `${label}.parentSpecPath`) ||
    parent.parentInputKey !== expectedKey
  ) {
    throw new Error(`Manifest ANAC readiness: parent ${label} inatteso.`);
  }
  sha256(parent.parentSpecSha256, `${label}.parentSpecSha256`);
  validateLicense(parent.license, ANAC_LICENSE, `${label}.license`);
  return parent as AnacParentInputLock;
}

function validateProvenance(value: unknown, expected: JsonObject, sourceSpecHash: string): AnacProvenance {
  const provenance = object(value, "provenance");
  exactKeys(provenance, Object.keys(expected), "provenance");
  const catalogObservedAt = instant(provenance.catalogObservedAt, "provenance.catalogObservedAt");
  const catalogMetadataModifiedAt = nullableDateOrInstant(
    provenance.catalogMetadataModifiedAt,
    "provenance.catalogMetadataModifiedAt",
  );

  const assetObservedAt = object(provenance.assetObservedAt, "provenance.assetObservedAt");
  exactKeys(assetObservedAt, ["cig", "stations"], "provenance.assetObservedAt");
  if (!Array.isArray(assetObservedAt.cig) || assetObservedAt.cig.length !== CIG_MONTHS.length) {
    throw new Error("Manifest ANAC readiness: provenance asset CIG incompleta.");
  }
  const cigAssetObservedAt = assetObservedAt.cig.map((item, index) =>
    instant(item, `provenance.assetObservedAt.cig[${index}]`),
  );
  const stationsAssetObservedAt = instant(assetObservedAt.stations, "provenance.assetObservedAt.stations");

  const sourceSpec = object(provenance.sourceSpec, "provenance.sourceSpec");
  exactKeys(sourceSpec, ["path", "sha256"], "provenance.sourceSpec");
  if (sourceSpec.path !== "scripts/etl/specs/anac-entity-procurement.source.json") {
    throw new Error("Manifest ANAC readiness: path source spec inatteso.");
  }
  const sourceSpecSha256 = sha256(sourceSpec.sha256, "provenance.sourceSpec.sha256");
  if (sourceSpecSha256 !== sourceSpecHash) {
    throw new Error("Manifest ANAC readiness: hash source spec non riconciliato.");
  }

  const parentSpec = object(provenance.parentSpec, "provenance.parentSpec");
  exactKeys(
    parentSpec,
    ["path", "sha256", "catalogObservedAt", "catalogMetadataModifiedAt"],
    "provenance.parentSpec",
  );
  if (parentSpec.path !== "scripts/etl/specs/anac-awardees.source.json") {
    throw new Error("Manifest ANAC readiness: path parent spec inatteso.");
  }
  const parentSpecSha256 = sha256(parentSpec.sha256, "provenance.parentSpec.sha256");
  const parentCatalogObservedAt = instant(
    parentSpec.catalogObservedAt,
    "provenance.parentSpec.catalogObservedAt",
  );
  const parentCatalogMetadataModifiedAt = nullableDateOrInstant(
    parentSpec.catalogMetadataModifiedAt,
    "provenance.parentSpec.catalogMetadataModifiedAt",
  );

  deepEqual(provenance, expected, "provenance");

  return {
    catalogObservedAt,
    catalogMetadataModifiedAt,
    assetObservedAt: { cig: cigAssetObservedAt, stations: stationsAssetObservedAt },
    sourceSpec: {
      path: sourceSpec.path as AnacProvenance["sourceSpec"]["path"],
      sha256: sourceSpecSha256,
    },
    parentSpec: {
      path: parentSpec.path as AnacProvenance["parentSpec"]["path"],
      sha256: parentSpecSha256,
      catalogObservedAt: parentCatalogObservedAt,
      catalogMetadataModifiedAt: parentCatalogMetadataModifiedAt,
    },
  };
}

function amountStatusRows(value: unknown, label: string): AnacAmountStatusRows {
  const statuses = object(value, label);
  exactKeys(statuses, AMOUNT_STATUSES, label);
  const result = {} as AnacAmountStatusRows;
  for (const status of AMOUNT_STATUSES) {
    result[status] = integer(statuses[status], `${label}.${status}`);
  }
  return result;
}

function decimalString(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(candidate)) {
    throw new Error(`Manifest ANAC readiness: decimale ${label} non valido.`);
  }
  return candidate;
}

type DecimalValue = { coefficient: bigint; scale: number };

function decimalValue(value: unknown, label: string): DecimalValue {
  const candidate = decimalString(value, label);
  const [whole, fraction = ""] = candidate.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function scaledCoefficient(value: DecimalValue, scale: number): bigint {
  return value.coefficient * (BigInt(10) ** BigInt(scale - value.scale));
}

function decimalSumEquals(left: DecimalValue, right: DecimalValue, total: DecimalValue): boolean {
  const scale = Math.max(left.scale, right.scale, total.scale);
  return (
    scaledCoefficient(left, scale) + scaledCoefficient(right, scale) ===
    scaledCoefficient(total, scale)
  );
}

function validateAmountCoverage(value: unknown, label: string): AnacAmountCoverage {
  const coverage = object(value, label);
  exactKeys(
    coverage,
    [
      "distinctRows",
      "statusRows",
      "positive-exact-centSum",
      "positive-subcentSum",
      "positiveRows",
      "positiveSum",
    ],
    label,
  );
  const statuses = amountStatusRows(coverage.statusRows, `${label}.statusRows`);
  const distinctRows = integer(coverage.distinctRows, `${label}.distinctRows`);
  if (AMOUNT_STATUSES.reduce((sum, status) => sum + statuses[status], 0) !== distinctRows) {
    throw new Error(`Manifest ANAC readiness: partizione importi non riconciliata in ${label}.`);
  }
  const positiveRows = integer(coverage.positiveRows, `${label}.positiveRows`);
  if (positiveRows !== statuses["positive-exact-cent"] + statuses["positive-subcent"]) {
    throw new Error(`Manifest ANAC readiness: righe positive non riconciliate in ${label}.`);
  }
  const exactSum = decimalValue(coverage["positive-exact-centSum"], `${label}.positive-exact-centSum`);
  const subcentSum = decimalValue(coverage["positive-subcentSum"], `${label}.positive-subcentSum`);
  const positiveSum = decimalValue(coverage.positiveSum, `${label}.positiveSum`);
  if (!decimalSumEquals(exactSum, subcentSum, positiveSum)) {
    throw new Error(`Manifest ANAC readiness: somma positive non riconciliata in ${label}.`);
  }
  return {
    distinctRows,
    statusRows: statuses,
    "positive-exact-centSum": coverage["positive-exact-centSum"] as string,
    "positive-subcentSum": coverage["positive-subcentSum"] as string,
    positiveRows,
    positiveSum: coverage.positiveSum as string,
  };
}

function validateCoverage(value: unknown): AnacEntityProcurementCoverageManifest["coverage"] {
  const coverage = object(value, "coverage");
  exactKeys(coverage, ["registry", "procedures", "identity", "awards", "awardees"], "coverage");

  const registry = counter(coverage.registry, "coverage.registry", REGISTRY_COUNTER_KEYS);
  const classifiedRegistryRows =
    registry.rowsWithEntityCf + registry.rowsWithNonstandardCf;
  const registryReconciles =
    registry.rowsTotal === registry.rowsWithAusa &&
    registry.rowsTotal === registry.distinctAusa &&
    registry.rowsWithCf <= registry.rowsTotal &&
    registry.distinctCf <= registry.rowsWithCf &&
    registry.cfWithMultipleAusa <= registry.distinctCf &&
    classifiedRegistryRows === registry.rowsWithCf;
  if (!registryReconciles) {
    throw new Error("Manifest ANAC readiness: registry non riconciliato.");
  }

  const procedures = counter(coverage.procedures, "coverage.procedures", PROCEDURE_COUNTER_KEYS);
  const classifiedRawCigs = sumKeys(
    procedures,
    ["cigsWithExactlyOnePrimary", "cigsWithoutPrimary", "cigsWithMultiplePrimary"],
    "coverage.procedures",
  );
  const proceduresReconcile =
    procedures.rawRows === procedures.nonPrimaryRows + procedures.primaryRows &&
    procedures.primaryRows === procedures.distinctCigs &&
    procedures.distinctRawCigs === classifiedRawCigs;
  if (!proceduresReconcile) {
    throw new Error("Manifest ANAC readiness: procedure non riconciliate.");
  }
  const publicationDateRows = sumKeys(
    procedures,
    PROCEDURE_DATE_STATUSES.map((status) => `publicationDate:${status}`),
    "coverage.procedures",
  );
  const lotAmountRows = sumKeys(
    procedures,
    AMOUNT_STATUSES.map((status) => `lotAmount:${status}`),
    "coverage.procedures",
  );
  if (
    publicationDateRows !== procedures.primaryRows ||
    lotAmountRows !== procedures.primaryRows
  ) {
    throw new Error("Manifest ANAC readiness: stati procedure non riconciliati.");
  }

  const identity = counter(coverage.identity, "coverage.identity", IDENTITY_COUNTER_KEYS);
  const classifiedIdentities = identity.resolved + identity.unresolved + identity.conflict;
  if (
    classifiedIdentities !== procedures.primaryRows ||
    sumPrefix(identity, "via:") !== procedures.primaryRows
  ) {
    throw new Error("Manifest ANAC readiness: identità non riconciliata.");
  }

  const awards = counter(coverage.awards, "coverage.awards", AWARD_COUNTER_KEYS);
  const awardRowsReconcile =
    sumPrefix(awards, "id:") === awards.rawRows &&
    awards.knownKeyRows + awards.ineligibleKeyRows === awards.rawRows &&
    sumPrefix(awards, "amount:") === awards.rawRows &&
    sumPrefix(awards, "awardDate:") === awards.rawRows;
  const awardKeysReconcile =
    awards.distinctAwards <= awards.knownKeyRows &&
    awards.duplicateKeyRows === awards.knownKeyRows - awards.distinctAwards &&
    awards.duplicateKeyGroups <= awards.distinctAwards &&
    awards.exactDuplicateRows <= awards.duplicateKeyRows &&
    awards.nonIdenticalDuplicateRows ===
      awards.duplicateKeyRows - awards.exactDuplicateRows;
  const awardConflictsReconcile =
    awards.amountConflictGroups <= awards.duplicateKeyGroups &&
    awards.awardDateConflictGroups <= awards.duplicateKeyGroups &&
    awards.criticalConflictGroups >=
      Math.max(awards.amountConflictGroups, awards.awardDateConflictGroups) &&
    awards.criticalConflictGroups <=
      awards.amountConflictGroups + awards.awardDateConflictGroups &&
    awards.conflictingAwardKeys === awards.criticalConflictGroups;
  if (!awardRowsReconcile || !awardKeysReconcile || !awardConflictsReconcile) {
    throw new Error("Manifest ANAC readiness: aggiudicazioni non riconciliate.");
  }

  const awardees = counter(coverage.awardees, "coverage.awardees", AWARDEE_COUNTER_KEYS);
  const awardeesReconcile =
    sumPrefix(awardees, "id:") === awardees.rawRows &&
    awardees.knownKeyRows + awardees.ineligibleKeyRows === awardees.rawRows &&
    awardees.distinctJoinPairs <= awardees.knownKeyRows &&
    awardees.exactDuplicateRows <= awardees.knownKeyRows &&
    awardees.pairsWithMultipleAwardeeRows <= awardees.distinctJoinPairs;
  if (!awardeesReconcile) {
    throw new Error("Manifest ANAC readiness: aggiudicatari non riconciliati.");
  }

  return { registry, procedures, identity, awards, awardees };
}

function validateReconciliation(value: unknown): AnacEntityProcurementCoverageManifest["reconciliation"] {
  const reconciliation = object(value, "reconciliation");
  exactKeys(
    reconciliation,
    [
      "awardPairsTotal",
      "awardPairsInCohort",
      "awardPairsOutOfCohort",
      "awardPairsWithAwardees",
      "awardPairsWithoutAwardees",
      "awardeePairsTotal",
      "awardeePairsInCohort",
      "awardeePairsOutOfCohort",
      "awardeePairsWithoutAward",
    ],
    "reconciliation",
  );
  const result = {
    awardPairsTotal: integer(reconciliation.awardPairsTotal, "reconciliation.awardPairsTotal"),
    awardPairsInCohort: integer(reconciliation.awardPairsInCohort, "reconciliation.awardPairsInCohort"),
    awardPairsOutOfCohort: integer(reconciliation.awardPairsOutOfCohort, "reconciliation.awardPairsOutOfCohort"),
    awardPairsWithAwardees: integer(reconciliation.awardPairsWithAwardees, "reconciliation.awardPairsWithAwardees"),
    awardPairsWithoutAwardees: integer(
      reconciliation.awardPairsWithoutAwardees,
      "reconciliation.awardPairsWithoutAwardees",
    ),
    awardeePairsTotal: integer(reconciliation.awardeePairsTotal, "reconciliation.awardeePairsTotal"),
    awardeePairsInCohort: integer(reconciliation.awardeePairsInCohort, "reconciliation.awardeePairsInCohort"),
    awardeePairsOutOfCohort: integer(reconciliation.awardeePairsOutOfCohort, "reconciliation.awardeePairsOutOfCohort"),
    awardeePairsWithoutAward: integer(
      reconciliation.awardeePairsWithoutAward,
      "reconciliation.awardeePairsWithoutAward",
    ),
  };
  const reconciles =
    result.awardPairsTotal ===
      result.awardPairsInCohort + result.awardPairsOutOfCohort &&
    result.awardeePairsTotal ===
      result.awardeePairsInCohort + result.awardeePairsOutOfCohort &&
    result.awardPairsWithAwardees + result.awardPairsWithoutAwardees ===
      result.awardPairsInCohort &&
    result.awardeePairsWithoutAward <= result.awardeePairsInCohort;
  if (!reconciles) {
    throw new Error("Manifest ANAC readiness: reconciliation non riconciliata.");
  }
  return result;
}

export function assertAnacEntityProcurementCoverageManifest(
  value: unknown,
): AnacEntityProcurementCoverageManifest {
  const manifest = object(value, "radice");
  exactKeys(
    manifest,
    [
      "schemaVersion", "dataset", "distributionKind", "observedAt", "generatedAt",
      "scope", "contract", "privacy", "inputs", "provenance", "coverage", "amounts",
      "reconciliation", "sourceSpecSha256", "limitations",
    ],
    "radice",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.dataset !== "anac-entity-procurement-coverage" ||
    manifest.distributionKind !== "full-snapshot"
  ) {
    throw new Error("Manifest ANAC readiness: schema inatteso.");
  }
  const observedAt = instant(manifest.observedAt, "observedAt");
  const generatedAt = instant(manifest.generatedAt, "generatedAt");
  const manifestSourceSpecSha256 = sha256(manifest.sourceSpecSha256, "sourceSpecSha256");
  if (manifestSourceSpecSha256 !== CURRENT_SOURCE_SPEC_SHA256) {
    throw new Error("Manifest ANAC readiness: source spec hash diverso dal file corrente.");
  }
  const expectedManifestProvenance = expectedProvenance();
  const provenance = validateProvenance(
    manifest.provenance,
    expectedManifestProvenance,
    manifestSourceSpecSha256,
  );
  if (
    observedAt !== provenance.catalogObservedAt ||
    Date.parse(generatedAt) < Date.parse(observedAt)
  ) {
    throw new Error("Manifest ANAC readiness: cronologia di osservazione/generazione non riconciliata.");
  }

  const scope = object(manifest.scope, "scope");
  const expectedScope = sourceSpecObject(SOURCE_SPEC.scope, "scope");
  exactKeys(scope, Object.keys(expectedScope), "scope");
  deepEqual(scope, expectedScope, "scope");

  const contract = object(manifest.contract, "contract");
  const sourceContract = sourceSpecObject(SOURCE_SPEC.contract, "contract");
  const expectedContract = {
    stationIdentity: sourceContract.stationIdentity,
    entityIdentity: sourceContract.entityIdentity,
    stationKey: "ausa:<CODICE_AUSA>",
    entityKey: "cf:<CF_AMMINISTRAZIONE_APPALTANTE>",
    procedureKey: sourceContract.procedureKey,
    awardKey: sourceContract.awardKey,
    procedurePeriod: sourceContract.procedurePeriod,
    awardPeriod: sourceContract.awardPeriod,
    procedureAmount: sourceContract.procedureAmount,
    awardAmount: sourceContract.awardAmount,
    amountRepresentation: sourceContract.amountRepresentation,
    awardAmountAggregation: sourceContract.awardAmountAggregation,
    awardeeMultipartyPolicy: "awardee-rows-never-multiply-award-amount",
  };
  deepEqual(contract, expectedContract, "contract");

  const privacy = object(manifest.privacy, "privacy");
  deepEqual(
    privacy,
    {
      aggregateOnly: true,
      containsRawRows: false,
      containsRawTaxIds: false,
      containsNames: false,
    },
    "privacy",
  );

  const inputs = object(manifest.inputs, "inputs");
  const expectedManifestInputs = expectedInputs();
  const expectedCigInputs = expectedManifestInputs.cig;
  const expectedStationsInput = sourceSpecObject(
    expectedManifestInputs.stations,
    "expected inputs.stations",
  );
  if (!Array.isArray(expectedCigInputs)) {
    throw new Error("Manifest ANAC readiness: source spec CIG non valido.");
  }
  exactKeys(inputs, ["cig", "stations", "awards", "awardees"], "inputs");
  if (!Array.isArray(inputs.cig) || inputs.cig.length !== 12) {
    throw new Error("Manifest ANAC readiness: servono dodici lock CIG.");
  }
  const cigInputs = inputs.cig as unknown[];
  const cig = CIG_MONTHS.map((month) =>
    validateCigInput(
      cigInputs[month - 1],
      sourceSpecObject(expectedCigInputs[month - 1], `expected inputs.cig[${month - 1}]`),
      month,
    ),
  );
  const stations = validateStationsInput(inputs.stations, expectedStationsInput);
  const awardsExpected = sourceSpecObject(
    expectedManifestInputs.awards,
    "expected inputs.awards",
  );
  const awardeesExpected = sourceSpecObject(
    expectedManifestInputs.awardees,
    "expected inputs.awardees",
  );
  const awards = validateParent(inputs.awards, awardsExpected, "awards", "inputs.awards");
  const awardees = validateParent(
    inputs.awardees,
    awardeesExpected,
    "awardees",
    "inputs.awardees",
  );
  deepEqual(inputs, expectedManifestInputs, "inputs");
  const parentsReconcile =
    awards.parentSpecSha256 === provenance.parentSpec.sha256 &&
    awardees.parentSpecSha256 === provenance.parentSpec.sha256 &&
    awards.parentSpecPath === provenance.parentSpec.path &&
    awardees.parentSpecPath === provenance.parentSpec.path;
  if (!parentsReconcile) {
    throw new Error("Manifest ANAC readiness: parent input e provenance non riconciliati.");
  }
  const assetTimesReconcile =
    cig.every(
      (input, index) => input.assetObservedAt === provenance.assetObservedAt.cig[index],
    ) && stations.assetObservedAt === provenance.assetObservedAt.stations;
  if (!assetTimesReconcile) {
    throw new Error("Manifest ANAC readiness: osservazione asset non riconciliata.");
  }

  const coverage = validateCoverage(manifest.coverage);
  const amounts = object(manifest.amounts, "amounts");
  exactKeys(
    amounts,
    [
      "procedureLot",
      "awardRows",
      "awardContributionInCohort",
      "awardeeMultiplication",
      "lotAndAwardAmountsAreDistinctFields",
    ],
    "amounts",
  );
  const procedureLot = validateAmountCoverage(amounts.procedureLot, "amounts.procedureLot");
  const awardRows = validateAmountCoverage(amounts.awardRows, "amounts.awardRows");
  const awardContributionInCohort = validateAmountCoverage(
    amounts.awardContributionInCohort,
    "amounts.awardContributionInCohort",
  );
  const amountsReconcile =
    amounts.awardeeMultiplication === false &&
    amounts.lotAndAwardAmountsAreDistinctFields === true &&
    procedureLot.distinctRows === coverage.procedures.primaryRows &&
    awardRows.distinctRows === coverage.awards.distinctAwards &&
    awardContributionInCohort.distinctRows <= awardRows.distinctRows &&
    awardRows.statusRows.conflicting === coverage.awards.amountConflictGroups &&
    awardContributionInCohort.statusRows.conflicting <= awardRows.statusRows.conflicting;
  if (!amountsReconcile) {
    throw new Error("Manifest ANAC readiness: amounts non riconciliati.");
  }

  const reconciliation = validateReconciliation(manifest.reconciliation);
  const cohortReconciles =
    reconciliation.awardPairsTotal === awardRows.distinctRows &&
    reconciliation.awardeePairsTotal === coverage.awardees.distinctJoinPairs &&
    reconciliation.awardPairsInCohort === awardContributionInCohort.distinctRows &&
    reconciliation.awardPairsWithAwardees + reconciliation.awardPairsWithoutAwardees ===
      reconciliation.awardPairsInCohort;
  if (!cohortReconciles) {
    throw new Error("Manifest ANAC readiness: cohort award non riconciliata.");
  }
  deepEqual(manifest.limitations, LIMITATIONS, "limitations");

  return {
    ...manifest,
    scope: scope as AnacEntityProcurementCoverageManifest["scope"],
    contract: contract as AnacEntityProcurementCoverageManifest["contract"],
    privacy: privacy as AnacEntityProcurementCoverageManifest["privacy"],
    inputs: { cig, stations, awards, awardees },
    provenance,
    coverage,
    amounts: {
      procedureLot,
      awardRows,
      awardContributionInCohort,
      awardeeMultiplication: false,
      lotAndAwardAmountsAreDistinctFields: true,
    },
    reconciliation,
    sourceSpecSha256: manifest.sourceSpecSha256 as string,
    limitations: manifest.limitations as string[],
  } as AnacEntityProcurementCoverageManifest;
}
