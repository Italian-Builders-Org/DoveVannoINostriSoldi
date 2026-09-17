const SHA256 = /^[a-f0-9]{64}$/;
const CRC32 = /^[a-f0-9]{8}$/;
const ANAC_ORIGIN = "https://dati.anticorruzione.it";
const ANAC_LICENSE_URL =
  "https://w3id.org/italia/controlled-vocabulary/licences/A31_CCBYSA40";
const AWARDEE_HEADERS = [
  "cig",
  "ruolo",
  "codice_fiscale",
  "denominazione",
  "tipo_soggetto",
  "id_aggiudicazione",
] as const;
const AWARD_HEADERS = [
  "cig",
  "data_aggiudicazione_definitiva",
  "esito",
  "criterio_aggiudicazione",
  "data_comunicazione_esito",
  "numero_offerte_ammesse",
  "numero_offerte_escluse",
  "importo_aggiudicazione",
  "ribasso_aggiudicazione",
  "num_imprese_offerenti",
  "flag_subappalto",
  "id_aggiudicazione",
  "cod_esito",
  "num_imprese_richiedenti",
  "asta_elettronica",
  "num_imprese_invitate",
  "massimo_ribasso",
  "minimo_ribasso",
  "FLAG_SCOMPUTO",
  "COD_PRESTAZIONI_COMPRESE",
  "PRESTAZIONI_COMPRESE",
  "CIG_PROG_ESTERNA",
  "DATA_INCARICO_PROG",
  "DATA_CONS_PROG",
  "COD_MODO_RIAGGIUDICAZIONE",
  "MODO_RIAGGIUDICAZIONE",
  "FLAG_PROC_ACCELERATA",
  "N_MANIF_INTERESSE",
] as const;
const TAX_CLASSIFICATIONS = [
  "foreign-or-anomalous",
  "italian-shape-11-checksum-invalid",
  "italian-shape-11-checksum-valid",
  "italian-shape-16-checksum-invalid",
  "italian-shape-16-checksum-valid",
  "missing",
  "other-alphanumeric",
  "redacted-or-placeholder",
] as const;
const DATE_STATUSES = ["before-1990", "future", "invalid", "missing", "valid"] as const;

type JsonObject = Record<string, unknown>;

export type AnacAwardeesCoverageManifest = {
  schemaVersion: 1;
  dataset: "anac-awardees-coverage";
  observedAt: string;
  scope: {
    distributionKind: "full-snapshot";
    deltasApplied: [];
    nationalPopulationClaim: "not-asserted";
    temporalAlignment: "cross-snapshot";
    note: string;
    temporalCaveat: string;
  };
  sourceSpecSha256: string;
  license: {
    name: "CC BY-SA 4.0";
    url: typeof ANAC_LICENSE_URL;
  };
  inputs: {
    awardees: AnacInputLock;
    awards: AnacInputLock;
  };
  contract: {
    joinKey: ["cig", "id_aggiudicazione"];
    awardIdRepresentation: "string";
    missingAwardIdSentinel: "-1";
    namesAreIdentifiers: false;
    taxIdNormalization: string;
    awardAmountPolicy: "not-measured-in-this-slice";
    distinctPartyPolicy: string;
  };
  coverage: {
    awardees: JsonObject;
    awards: JsonObject;
  };
  reconciliation: JsonObject & {
    joinKey: ["cig", "id_aggiudicazione"];
  };
  byAwardYear: JsonObject[];
  privacy: {
    containsRawTaxIds: false;
    containsNormalizedTaxIds: false;
    containsCompanyNames: false;
    fixturePolicy: "synthetic-only";
  };
  limitations: string[];
};

type AnacInputLock = {
  archiveBytes: number;
  archiveSha256: string;
  datasetPageUrl: string;
  delimiter: ";";
  encoding: "utf-8-sig";
  headers: string[];
  member: {
    name: string;
    bytes: number;
    sha256: string;
    crc32: string;
  };
  resourceId: string;
  resourcePageUrl: string;
  resourceUrl: string;
  sourceLastModified: string;
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Manifest ANAC aggiudicatari: ${label} non valido.`);
  }
  return value as JsonObject;
}

function integer(value: unknown, label: string, maximum?: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(`Manifest ANAC aggiudicatari: ${label} non valido.`);
  }
  return value;
}

function officialUrl(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Manifest ANAC aggiudicatari: ${label} non valido.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Manifest ANAC aggiudicatari: ${label} non valido.`);
  }
  if (url.origin !== ANAC_ORIGIN || !url.pathname.startsWith("/opendata/")) {
    throw new Error(`Manifest ANAC aggiudicatari: ${label} non ufficiale.`);
  }
  return value;
}

function validateInput(
  value: unknown,
  label: string,
  expectedHeaders: readonly string[],
): AnacInputLock {
  const input = object(value, `input ${label}`);
  integer(input.archiveBytes, `byte archivio ${label}`);
  if (typeof input.archiveSha256 !== "string" || !SHA256.test(input.archiveSha256)) {
    throw new Error(`Manifest ANAC aggiudicatari: SHA-256 archivio ${label} non valido.`);
  }
  officialUrl(input.datasetPageUrl, `pagina dataset ${label}`);
  officialUrl(input.resourcePageUrl, `pagina risorsa ${label}`);
  officialUrl(input.resourceUrl, `URL risorsa ${label}`);
  if (
    input.delimiter !== ";" ||
    input.encoding !== "utf-8-sig" ||
    !Array.isArray(input.headers) ||
    input.headers.join("\u001f") !== expectedHeaders.join("\u001f")
  ) {
    throw new Error(`Manifest ANAC aggiudicatari: formato CSV ${label} non valido.`);
  }
  if (typeof input.resourceId !== "string" || !/^[a-f0-9-]{36}$/.test(input.resourceId)) {
    throw new Error(`Manifest ANAC aggiudicatari: resource ID ${label} non valido.`);
  }
  if (typeof input.sourceLastModified !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.sourceLastModified)) {
    throw new Error(`Manifest ANAC aggiudicatari: data sorgente ${label} non valida.`);
  }
  const member = object(input.member, `membro ZIP ${label}`);
  integer(member.bytes, `byte membro ${label}`);
  if (
    typeof member.name !== "string" ||
    !member.name.endsWith(".csv") ||
    typeof member.sha256 !== "string" ||
    !SHA256.test(member.sha256) ||
    typeof member.crc32 !== "string" ||
    !CRC32.test(member.crc32)
  ) {
    throw new Error(`Manifest ANAC aggiudicatari: membro ZIP ${label} non valido.`);
  }
  return input as AnacInputLock;
}

function validateCoverageSection(value: unknown, label: string): JsonObject {
  const section = object(value, `copertura ${label}`);
  const total = integer(section.rowsTotal, `righe totali ${label}`);
  for (const [key, candidate] of Object.entries(section)) {
    if (key.endsWith("Rows") && key !== "rowsTotal" && typeof candidate === "number") {
      integer(candidate, `${label}.${key}`, total);
    }
  }
  return section;
}

function integerMap(
  value: unknown,
  label: string,
  maximum: number,
  expectedKeys?: readonly string[],
): number {
  const map = object(value, label);
  if (
    expectedKeys &&
    Object.keys(map).sort().join("\u001f") !== [...expectedKeys].sort().join("\u001f")
  ) {
    throw new Error(`Manifest ANAC aggiudicatari: ${label} non valido.`);
  }
  return Object.entries(map).reduce(
    (sum, [key, count]) => sum + integer(count, `${label}.${key}`, maximum),
    0,
  );
}

function sumKeys(value: JsonObject, keys: string[]): number {
  return keys.reduce((sum, key) => sum + integer(value[key], key), 0);
}

export function assertAnacAwardeesCoverageManifest(
  value: unknown,
): AnacAwardeesCoverageManifest {
  const manifest = object(value, "radice");
  if (manifest.schemaVersion !== 1 || manifest.dataset !== "anac-awardees-coverage") {
    throw new Error("Manifest ANAC aggiudicatari: schema inatteso.");
  }
  if (
    typeof manifest.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.observedAt) ||
    typeof manifest.sourceSpecSha256 !== "string" ||
    !SHA256.test(manifest.sourceSpecSha256)
  ) {
    throw new Error("Manifest ANAC aggiudicatari: provenienza non valida.");
  }

  const scope = object(manifest.scope, "perimetro");
  if (
    scope.distributionKind !== "full-snapshot" ||
    !Array.isArray(scope.deltasApplied) ||
    scope.deltasApplied.length !== 0 ||
    scope.nationalPopulationClaim !== "not-asserted" ||
    scope.temporalAlignment !== "cross-snapshot" ||
    typeof scope.temporalCaveat !== "string" ||
    !scope.temporalCaveat.trim()
  ) {
    throw new Error("Manifest ANAC aggiudicatari: perimetro o claim non valido.");
  }

  const license = object(manifest.license, "licenza");
  if (license.name !== "CC BY-SA 4.0" || license.url !== ANAC_LICENSE_URL) {
    throw new Error("Manifest ANAC aggiudicatari: licenza inattesa.");
  }

  const inputs = object(manifest.inputs, "input");
  if (Object.keys(inputs).sort().join(",") !== "awardees,awards") {
    throw new Error("Manifest ANAC aggiudicatari: set degli input inatteso.");
  }
  validateInput(inputs.awardees, "aggiudicatari", AWARDEE_HEADERS);
  validateInput(inputs.awards, "aggiudicazioni", AWARD_HEADERS);

  const contract = object(manifest.contract, "contratto");
  if (
    !Array.isArray(contract.joinKey) ||
    contract.joinKey.join("\u001f") !== "cig\u001fid_aggiudicazione" ||
    contract.awardIdRepresentation !== "string" ||
    contract.missingAwardIdSentinel !== "-1" ||
    contract.namesAreIdentifiers !== false ||
    contract.awardAmountPolicy !== "not-measured-in-this-slice" ||
    typeof contract.distinctPartyPolicy !== "string" ||
    !contract.distinctPartyPolicy.trim()
  ) {
    throw new Error("Manifest ANAC aggiudicatari: contratto di join non valido.");
  }

  const coverage = object(manifest.coverage, "copertura");
  const awardees = validateCoverageSection(coverage.awardees, "aggiudicatari");
  const awards = validateCoverageSection(coverage.awards, "aggiudicazioni");
  const awardeeTotal = integer(awardees.rowsTotal, "totale aggiudicatari");
  const awardTotal = integer(awards.rowsTotal, "totale aggiudicazioni");
  if (
    integerMap(
      awardees.taxIdClassRows,
      "classi del codice fiscale",
      awardeeTotal,
      TAX_CLASSIFICATIONS,
    ) !== awardeeTotal
  ) {
    throw new Error("Manifest ANAC aggiudicatari: classi fiscali non riconciliate.");
  }
  if (integerMap(awardees.roleRows, "ruoli", awardeeTotal) !== awardeeTotal) {
    throw new Error("Manifest ANAC aggiudicatari: ruoli non riconciliati.");
  }
  if (
    integerMap(awards.dateStatusRows, "stati data", awardTotal, DATE_STATUSES) !==
    awardTotal
  ) {
    throw new Error("Manifest ANAC aggiudicatari: stati data non riconciliati.");
  }
  for (const key of [
    "distinctNormalizedTaxIds",
    "exactDuplicateGroups",
    "distinctJoinPairs",
    "awardPairsWithMultipleTaxIds",
    "maxTaxIdsPerAwardPair",
    "taxIdsWithMultipleNames",
    "namesWithMultipleTaxIds",
  ]) {
    integer(awardees[key], `aggiudicatari.${key}`, awardeeTotal);
  }
  for (const key of [
    "distinctJoinPairs",
    "exactDuplicateGroups",
    "awardIdsWithMultipleCigs",
    "cigsWithMultipleAwardIds",
  ]) {
    integer(awards[key], `aggiudicazioni.${key}`, awardTotal);
  }

  const reconciliation = object(manifest.reconciliation, "riconciliazione");
  if (
    !Array.isArray(reconciliation.joinKey) ||
    reconciliation.joinKey.join("\u001f") !== "cig\u001fid_aggiudicazione"
  ) {
    throw new Error("Manifest ANAC aggiudicatari: chiave di riconciliazione non valida.");
  }
  const eligible = integer(reconciliation.eligibleAwardeeRows, "righe eleggibili", awardeeTotal);
  if (
    sumKeys(reconciliation, [
      "matchedAwardeeRows",
      "bothKeysExistButPairDiffersRows",
      "awardIdOnlyMatchRows",
      "cigOnlyMatchRows",
      "neitherKeyMatchesRows",
    ]) !== eligible
  ) {
    throw new Error("Manifest ANAC aggiudicatari: partizione del join incoerente.");
  }
  if (
    integer(reconciliation.ineligibleAwardeeRows, "righe non eleggibili", awardeeTotal) + eligible !== awardeeTotal ||
    integer(reconciliation.matchedAwardeePairs, "coppie abbinate") +
      integer(reconciliation.unmatchedAwardeePairs, "coppie non abbinate") !==
      integer(awardees.distinctJoinPairs, "coppie aggiudicatario") ||
    integer(reconciliation.awardPairsWithAwardees, "aggiudicazioni con soggetti") +
      integer(reconciliation.awardPairsWithoutAwardees, "aggiudicazioni senza soggetti") !==
      integer(awards.distinctJoinPairs, "coppie aggiudicazione")
  ) {
    throw new Error("Manifest ANAC aggiudicatari: cardinalità del join incoerenti.");
  }

  if (!Array.isArray(manifest.byAwardYear) || manifest.byAwardYear.length === 0) {
    throw new Error("Manifest ANAC aggiudicatari: copertura annuale mancante.");
  }
  const years = new Set<string>();
  let matchedRowsByYear = 0;
  for (const rawPeriod of manifest.byAwardYear) {
    const period = object(rawPeriod, "periodo annuale");
    if (typeof period.year !== "string" || years.has(period.year)) {
      throw new Error("Manifest ANAC aggiudicatari: anno duplicato o non valido.");
    }
    years.add(period.year);
    const periodRows = integer(period.matchedAwardeeRows, `righe ${period.year}`, awardeeTotal);
    matchedRowsByYear += periodRows;
    for (const key of [
      "rowsWithTaxId",
      "taxIdShapeValidRows",
      "taxIdChecksumValidRows",
      "redactedOrPlaceholderRows",
      "anomalousTaxIdRows",
      "groupedRelationshipRows",
      "exactDuplicateRows",
    ]) {
      integer(period[key], `${period.year}.${key}`, periodRows);
    }
    const periodPairs = integer(
      period.distinctMatchedAwardPairs,
      `${period.year}.distinctMatchedAwardPairs`,
      periodRows,
    );
    integer(
      period.awardPairsWithMultipleTaxIds,
      `${period.year}.awardPairsWithMultipleTaxIds`,
      periodPairs,
    );
  }
  if (matchedRowsByYear !== integer(reconciliation.matchedAwardeeRows, "righe abbinate")) {
    throw new Error("Manifest ANAC aggiudicatari: anni non riconciliati.");
  }

  const privacy = object(manifest.privacy, "privacy");
  if (
    privacy.containsRawTaxIds !== false ||
    privacy.containsNormalizedTaxIds !== false ||
    privacy.containsCompanyNames !== false ||
    privacy.fixturePolicy !== "synthetic-only"
  ) {
    throw new Error("Manifest ANAC aggiudicatari: privacy contract violato.");
  }
  if (
    !Array.isArray(manifest.limitations) ||
    manifest.limitations.length < 4 ||
    manifest.limitations.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error("Manifest ANAC aggiudicatari: limiti interpretativi mancanti.");
  }

  return manifest as AnacAwardeesCoverageManifest;
}
