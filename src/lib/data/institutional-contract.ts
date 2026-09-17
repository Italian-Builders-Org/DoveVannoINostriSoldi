export type InstitutionalDomain = "parliament" | "presidency" | "ministry" | "region";

export type InstitutionalPeriod =
  | { kind: "financial-year"; year: number }
  | { kind: "monthly-cumulative"; year: number; month: number };

export type AccountingFrame = {
  subject:
    | "own-institution"
    | "state-budget-administration"
    | "regional-institution"
    | "territorialized-consolidated-pa";
  basis: "cash" | "competence" | "economic" | "mixed";
  measure: "budget" | "commitment" | "payment" | "cost" | "revenue";
  statement: "budget" | "final-account" | "administrative-data";
  scope: string;
  classification: string;
};

export type InstitutionalSourceEvidence = {
  id: string;
  sourceId: string;
  sourceRecordId: string | null;
  owner: string;
  officialUrl: string;
  format: "api" | "csv" | "html" | "pdf" | "xls" | "xlsx";
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  publishedAt: string | null;
  acquiredAt: string;
  rawSha256: string | null;
  transformVersion: number;
  transformation: string;
  locator: string | null;
  license: {
    status: "declared" | "not-declared";
    name: string | null;
    url: string | null;
  };
  rightsNote: string;
};

export type InstitutionalCoverage =
  | { kind: "complete"; covered: number; expected: number; note: string }
  | { kind: "partial"; covered: number; expected: number | null; gaps: string[]; note: string }
  | { kind: "metadata-only"; note: string }
  | { kind: "not-integrated"; note: string };

export type InstitutionalQuantity = {
  value: number;
  unit: "euro-cents" | "euro-cents-per-person" | "count" | "basis-points";
};

export type InstitutionalDenominator = {
  kind: "population" | "entities" | "other";
  value: number;
  unit: "people" | "entities";
  period: InstitutionalPeriod;
  evidenceId: string;
  note: string;
};

export type InstitutionalFact = {
  id: string;
  label: string;
  quantity: InstitutionalQuantity;
  period: InstitutionalPeriod;
  frame: AccountingFrame;
  denominator: InstitutionalDenominator | null;
  evidenceId: string;
  explanation: string;
};

export type InstitutionalDossier = {
  schemaVersion: 1;
  domain: InstitutionalDomain;
  subjectId: string;
  title: string;
  coverage: InstitutionalCoverage;
  sources: InstitutionalSourceEvidence[];
  facts: InstitutionalFact[];
};

export type FactComparison =
  | { ok: true }
  | { ok: false; reason: string };

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}: testo non vuoto atteso`);
  }
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function timestamp(value: unknown, field: string): string {
  const parsed = text(value, field);
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`${field}: data non valida`);
  return parsed;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function officialUrl(value: unknown, field: string): string {
  const raw = text(value, field);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error(`${field}: URL HTTPS ufficiale atteso`);
  }
  return raw;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${field}: intero sicuro atteso`);
  }
  return value as number;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (!allowed.includes(value as T)) throw new Error(`${field}: valore non valido`);
  return value as T;
}

function period(value: unknown, field: string): InstitutionalPeriod {
  const item = record(value, field);
  const kind = enumValue(item.kind, ["financial-year", "monthly-cumulative"] as const, `${field}.kind`);
  const year = integer(item.year, `${field}.year`, 1948);
  if (year > 2200) throw new Error(`${field}.year: anno non valido`);
  if (kind === "monthly-cumulative") {
    const month = integer(item.month, `${field}.month`, 1);
    if (month > 12) throw new Error(`${field}.month: mese non valido`);
    return { kind, year, month };
  }
  return { kind, year };
}

function accountingFrame(value: unknown, field: string): AccountingFrame {
  const item = record(value, field);
  return {
    subject: enumValue(item.subject, ["own-institution", "state-budget-administration", "regional-institution", "territorialized-consolidated-pa"] as const, `${field}.subject`),
    basis: enumValue(item.basis, ["cash", "competence", "economic", "mixed"] as const, `${field}.basis`),
    measure: enumValue(item.measure, ["budget", "commitment", "payment", "cost", "revenue"] as const, `${field}.measure`),
    statement: enumValue(item.statement, ["budget", "final-account", "administrative-data"] as const, `${field}.statement`),
    scope: text(item.scope, `${field}.scope`),
    classification: text(item.classification, `${field}.classification`),
  };
}

function sourceEvidence(value: unknown, field: string): InstitutionalSourceEvidence {
  const item = record(value, field);
  const rawSha256 = nullableText(item.rawSha256, `${field}.rawSha256`);
  if (rawSha256 !== null && !/^[a-f0-9]{64}$/.test(rawSha256)) {
    throw new Error(`${field}.rawSha256: SHA-256 non valido`);
  }
  const license = record(item.license, `${field}.license`);
  const licenseStatus = enumValue(license.status, ["declared", "not-declared"] as const, `${field}.license.status`);
  const licenseName = nullableText(license.name, `${field}.license.name`);
  const licenseUrl = license.url === null ? null : officialUrl(license.url, `${field}.license.url`);
  if (licenseStatus === "declared" && (!licenseName || !licenseUrl)) {
    throw new Error(`${field}.license: nome e URL richiesti per una licenza dichiarata`);
  }
  if (licenseStatus === "not-declared" && (licenseName || licenseUrl)) {
    throw new Error(`${field}.license: non attribuire una licenza non dichiarata`);
  }
  return {
    id: text(item.id, `${field}.id`),
    sourceId: text(item.sourceId, `${field}.sourceId`),
    sourceRecordId: nullableText(item.sourceRecordId, `${field}.sourceRecordId`),
    owner: text(item.owner, `${field}.owner`),
    officialUrl: officialUrl(item.officialUrl, `${field}.officialUrl`),
    format: enumValue(item.format, ["api", "csv", "html", "pdf", "xls", "xlsx"] as const, `${field}.format`),
    sourceCreatedAt: nullableTimestamp(item.sourceCreatedAt, `${field}.sourceCreatedAt`),
    sourceUpdatedAt: nullableTimestamp(item.sourceUpdatedAt, `${field}.sourceUpdatedAt`),
    publishedAt: nullableTimestamp(item.publishedAt, `${field}.publishedAt`),
    acquiredAt: timestamp(item.acquiredAt, `${field}.acquiredAt`),
    rawSha256,
    transformVersion: integer(item.transformVersion, `${field}.transformVersion`, 1),
    transformation: text(item.transformation, `${field}.transformation`),
    locator: nullableText(item.locator, `${field}.locator`),
    license: { status: licenseStatus, name: licenseName, url: licenseUrl },
    rightsNote: text(item.rightsNote, `${field}.rightsNote`),
  };
}

function denominator(value: unknown, field: string): InstitutionalDenominator | null {
  if (value === null) return null;
  const item = record(value, field);
  return {
    kind: enumValue(item.kind, ["population", "entities", "other"] as const, `${field}.kind`),
    value: integer(item.value, `${field}.value`, 1),
    unit: enumValue(item.unit, ["people", "entities"] as const, `${field}.unit`),
    period: period(item.period, `${field}.period`),
    evidenceId: text(item.evidenceId, `${field}.evidenceId`),
    note: text(item.note, `${field}.note`),
  };
}

function coverage(value: unknown, field: string): InstitutionalCoverage {
  const item = record(value, field);
  const kind = enumValue(item.kind, ["complete", "partial", "metadata-only", "not-integrated"] as const, `${field}.kind`);
  const note = text(item.note, `${field}.note`);
  if (kind === "complete") {
    const covered = integer(item.covered, `${field}.covered`);
    const expected = integer(item.expected, `${field}.expected`, 1);
    if (covered !== expected) throw new Error(`${field}: copertura completa non riconciliata`);
    return { kind, covered, expected, note };
  }
  if (kind === "partial") {
    const covered = integer(item.covered, `${field}.covered`);
    const expected = item.expected === null ? null : integer(item.expected, `${field}.expected`, 1);
    if (expected !== null && covered >= expected) {
      throw new Error(`${field}: copertura parziale non coerente`);
    }
    if (!Array.isArray(item.gaps) || item.gaps.length === 0) {
      throw new Error(`${field}.gaps: almeno un buco atteso`);
    }
    return { kind, covered, expected, gaps: item.gaps.map((gap, index) => text(gap, `${field}.gaps[${index}]`)), note };
  }
  return { kind, note };
}

function fact(value: unknown, field: string): InstitutionalFact {
  const item = record(value, field);
  const quantity = record(item.quantity, `${field}.quantity`);
  return {
    id: text(item.id, `${field}.id`),
    label: text(item.label, `${field}.label`),
    quantity: {
      value: integer(quantity.value, `${field}.quantity.value`),
      unit: enumValue(quantity.unit, ["euro-cents", "euro-cents-per-person", "count", "basis-points"] as const, `${field}.quantity.unit`),
    },
    period: period(item.period, `${field}.period`),
    frame: accountingFrame(item.frame, `${field}.frame`),
    denominator: denominator(item.denominator, `${field}.denominator`),
    evidenceId: text(item.evidenceId, `${field}.evidenceId`),
    explanation: text(item.explanation, `${field}.explanation`),
  };
}

export function assertInstitutionalDossier(value: unknown): InstitutionalDossier {
  const item = record(value, "dossier");
  if (item.schemaVersion !== 1) throw new Error("dossier.schemaVersion: versione 1 attesa");
  const parsedCoverage = coverage(item.coverage, "dossier.coverage");
  if (!Array.isArray(item.sources) || item.sources.length === 0) {
    throw new Error("dossier.sources: almeno una fonte attesa");
  }
  if (!Array.isArray(item.facts)) throw new Error("dossier.facts: lista attesa");

  const sources = item.sources.map((source, index) => sourceEvidence(source, `dossier.sources[${index}]`));
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) throw new Error("dossier.sources: id duplicato");

  const facts = item.facts.map((entry, index) => fact(entry, `dossier.facts[${index}]`));
  if (new Set(facts.map((entry) => entry.id)).size !== facts.length) {
    throw new Error("dossier.facts: id duplicato");
  }
  if ((parsedCoverage.kind === "metadata-only" || parsedCoverage.kind === "not-integrated") && facts.length > 0) {
    throw new Error(`dossier.facts: vietati con copertura ${parsedCoverage.kind}`);
  }
  if (facts.some((entry) => !sourceIds.has(entry.evidenceId))) {
    throw new Error("dossier.facts: riferimento a fonte inesistente");
  }
  if (facts.some((entry) => entry.denominator && !sourceIds.has(entry.denominator.evidenceId))) {
    throw new Error("dossier.facts: riferimento del denominatore a fonte inesistente");
  }
  if (facts.some((entry) => entry.quantity.unit === "euro-cents-per-person" && entry.denominator === null)) {
    throw new Error("dossier.facts: denominatore richiesto per un valore pro capite");
  }
  return {
    schemaVersion: 1,
    domain: enumValue(item.domain, ["parliament", "presidency", "ministry", "region"] as const, "dossier.domain"),
    subjectId: text(item.subjectId, "dossier.subjectId"),
    title: text(item.title, "dossier.title"),
    coverage: parsedCoverage,
    sources,
    facts,
  };
}

function samePeriod(left: InstitutionalPeriod, right: InstitutionalPeriod): boolean {
  return left.kind === right.kind && left.year === right.year &&
    (left.kind !== "monthly-cumulative" ||
      (right.kind === "monthly-cumulative" && left.month === right.month));
}

export function compareInstitutionalFacts(
  left: InstitutionalFact,
  right: InstitutionalFact,
): FactComparison {
  if (left.quantity.unit !== right.quantity.unit) {
    return { ok: false, reason: "Le unità di misura sono diverse." };
  }
  if (JSON.stringify(left.denominator) !== JSON.stringify(right.denominator)) {
    return { ok: false, reason: "I denominatori non coincidono." };
  }
  if (!samePeriod(left.period, right.period)) {
    return { ok: false, reason: "I periodi di riferimento sono diversi." };
  }
  const frameFields: Array<keyof AccountingFrame> = [
    "subject",
    "basis",
    "measure",
    "statement",
    "scope",
    "classification",
  ];
  if (frameFields.some((field) => left.frame[field] !== right.frame[field])) {
    return { ok: false, reason: "Il perimetro o la base contabile non coincidono." };
  }
  return { ok: true };
}
