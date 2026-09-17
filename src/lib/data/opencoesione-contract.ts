export type OpenCoesioneTotals = {
  publicCostCents: number;
  cohesionPublicCostCents: number;
  paymentsCents: number;
  cohesionPaymentsCents: number;
  projects: number;
};

export type OpenCoesioneDimension = OpenCoesioneTotals & {
  slug: string;
  label: string;
  sourceUrl: string | null;
};

export type OpenCoesioneAnnualPoint = {
  year: number;
  commitmentsCents: number;
  paymentsCents: number;
};

export type OpenCoesioneSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  referenceDate: string;
  scope: "national-overview";
  totals: OpenCoesioneTotals;
  statuses: OpenCoesioneDimension[];
  themes: OpenCoesioneDimension[];
  natures: OpenCoesioneDimension[];
  annualSeries: OpenCoesioneAnnualPoint[];
  reconciliation: {
    statuses: ReconciliationResult;
    themes: ReconciliationResult;
    natures: ReconciliationResult;
  };
  source: {
    owner: string;
    dataset: string;
    endpoint: string;
    license: string;
    declaredCadence: string;
    platformCheckCadence: string;
    observedAt: string;
  };
  methodology: {
    paymentCostRatioMeaning: string;
    territorialWarning: string;
    roundingToleranceCents: number;
  };
};

export type ReconciliationResult = {
  publicCostDeltaCents: number;
  cohesionPublicCostDeltaCents: number;
  paymentsDeltaCents: number;
  cohesionPaymentsDeltaCents: number;
  projectsDelta: number;
};

const OFFICIAL_HOSTS = new Set(["opencoesione.gov.it", "www.opencoesione.gov.it"]);
const MAX_MONEY_CENTS = Number.MAX_SAFE_INTEGER;

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field}: stringa non vuota attesa`);
  }
  return value;
}

function integer(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${field}: intero sicuro non negativo atteso`);
  }
  return value as number;
}

function signedInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${field}: intero sicuro atteso`);
  return value as number;
}

function isoTimestamp(value: unknown, field: string): string {
  const result = string(value, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field}: timestamp ISO non valido`);
  return result;
}

function dateOnly(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error(`${field}: data YYYY-MM-DD non valida`);
  }
  return result;
}

function officialUrl(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  const result = string(value, field);
  const url = new URL(result);
  if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname)) {
    throw new Error(`${field}: URL OpenCoesione ufficiale atteso`);
  }
  return result;
}

function totals(value: unknown, field: string): OpenCoesioneTotals {
  const record = object(value, field);
  return {
    publicCostCents: integer(record.publicCostCents, `${field}.publicCostCents`, MAX_MONEY_CENTS),
    cohesionPublicCostCents: integer(
      record.cohesionPublicCostCents,
      `${field}.cohesionPublicCostCents`,
      MAX_MONEY_CENTS,
    ),
    paymentsCents: integer(record.paymentsCents, `${field}.paymentsCents`, MAX_MONEY_CENTS),
    cohesionPaymentsCents: integer(
      record.cohesionPaymentsCents,
      `${field}.cohesionPaymentsCents`,
      MAX_MONEY_CENTS,
    ),
    projects: integer(record.projects, `${field}.projects`),
  };
}

function dimensions(value: unknown, field: string): OpenCoesioneDimension[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field}: elenco non vuoto atteso`);
  return value.map((item, index) => {
    const record = object(item, `${field}[${index}]`);
    return {
      slug: string(record.slug, `${field}[${index}].slug`),
      label: string(record.label, `${field}[${index}].label`),
      sourceUrl: officialUrl(record.sourceUrl, `${field}[${index}].sourceUrl`, true),
      ...totals(record, `${field}[${index}]`),
    };
  });
}

function reconciliation(value: unknown, field: string): ReconciliationResult {
  const record = object(value, field);
  return {
    publicCostDeltaCents: signedInteger(record.publicCostDeltaCents, `${field}.publicCostDeltaCents`),
    cohesionPublicCostDeltaCents: signedInteger(
      record.cohesionPublicCostDeltaCents,
      `${field}.cohesionPublicCostDeltaCents`,
    ),
    paymentsDeltaCents: signedInteger(record.paymentsDeltaCents, `${field}.paymentsDeltaCents`),
    cohesionPaymentsDeltaCents: signedInteger(
      record.cohesionPaymentsDeltaCents,
      `${field}.cohesionPaymentsDeltaCents`,
    ),
    projectsDelta: signedInteger(record.projectsDelta, `${field}.projectsDelta`),
  };
}

function calculateReconciliation(
  items: OpenCoesioneDimension[],
  national: OpenCoesioneTotals,
): ReconciliationResult {
  return {
    publicCostDeltaCents:
      items.reduce((sum, item) => sum + item.publicCostCents, 0) - national.publicCostCents,
    cohesionPublicCostDeltaCents:
      items.reduce((sum, item) => sum + item.cohesionPublicCostCents, 0) -
      national.cohesionPublicCostCents,
    paymentsDeltaCents:
      items.reduce((sum, item) => sum + item.paymentsCents, 0) - national.paymentsCents,
    cohesionPaymentsDeltaCents:
      items.reduce((sum, item) => sum + item.cohesionPaymentsCents, 0) -
      national.cohesionPaymentsCents,
    projectsDelta: items.reduce((sum, item) => sum + item.projects, 0) - national.projects,
  };
}

export function assertOpenCoesioneSnapshot(value: unknown): OpenCoesioneSnapshot {
  const record = object(value, "snapshot");
  if (record.schemaVersion !== 1) throw new Error("snapshot.schemaVersion: versione 1 attesa");
  if (record.scope !== "national-overview") throw new Error("snapshot.scope non valido");

  const parsedTotals = totals(record.totals, "snapshot.totals");
  const statuses = dimensions(record.statuses, "snapshot.statuses");
  const themes = dimensions(record.themes, "snapshot.themes");
  const natures = dimensions(record.natures, "snapshot.natures");
  const reconciliationRecord = object(record.reconciliation, "snapshot.reconciliation");
  const claimedReconciliation = {
    statuses: reconciliation(reconciliationRecord.statuses, "snapshot.reconciliation.statuses"),
    themes: reconciliation(reconciliationRecord.themes, "snapshot.reconciliation.themes"),
    natures: reconciliation(reconciliationRecord.natures, "snapshot.reconciliation.natures"),
  };
  const parsedReconciliation = {
    statuses: calculateReconciliation(statuses, parsedTotals),
    themes: calculateReconciliation(themes, parsedTotals),
    natures: calculateReconciliation(natures, parsedTotals),
  };

  for (const [name, result] of Object.entries(parsedReconciliation)) {
    const claimed = claimedReconciliation[name as keyof typeof claimedReconciliation];
    if (
      claimed.publicCostDeltaCents !== result.publicCostDeltaCents ||
      claimed.cohesionPublicCostDeltaCents !== result.cohesionPublicCostDeltaCents ||
      claimed.paymentsDeltaCents !== result.paymentsDeltaCents ||
      claimed.cohesionPaymentsDeltaCents !== result.cohesionPaymentsDeltaCents ||
      claimed.projectsDelta !== result.projectsDelta
    ) {
      throw new Error(`snapshot.reconciliation.${name}: scarto memorizzato non corrisponde ai dati`);
    }
    if (
      Math.abs(result.publicCostDeltaCents) > 200 ||
      Math.abs(result.cohesionPublicCostDeltaCents) > 200 ||
      Math.abs(result.paymentsDeltaCents) > 200 ||
      Math.abs(result.cohesionPaymentsDeltaCents) > 200
    ) {
      throw new Error(`snapshot.reconciliation.${name}: scarto monetario oltre 2 euro`);
    }
    if (result.projectsDelta !== 0) {
      throw new Error(`snapshot.reconciliation.${name}: conteggio progetti non riconciliato`);
    }
  }

  if (!Array.isArray(record.annualSeries) || record.annualSeries.length === 0) {
    throw new Error("snapshot.annualSeries: serie non vuota attesa");
  }
  const annualSeries = record.annualSeries.map((item, index) => {
    const point = object(item, `snapshot.annualSeries[${index}]`);
    return {
      year: integer(point.year, `snapshot.annualSeries[${index}].year`, 2200),
      commitmentsCents: integer(
        point.commitmentsCents,
        `snapshot.annualSeries[${index}].commitmentsCents`,
        MAX_MONEY_CENTS,
      ),
      paymentsCents: integer(
        point.paymentsCents,
        `snapshot.annualSeries[${index}].paymentsCents`,
        MAX_MONEY_CENTS,
      ),
    };
  });
  for (let index = 1; index < annualSeries.length; index += 1) {
    if (annualSeries[index].year <= annualSeries[index - 1].year) {
      throw new Error("snapshot.annualSeries: anni non strettamente crescenti");
    }
  }

  const sourceRecord = object(record.source, "snapshot.source");
  const methodologyRecord = object(record.methodology, "snapshot.methodology");

  return {
    schemaVersion: 1,
    generatedAt: isoTimestamp(record.generatedAt, "snapshot.generatedAt"),
    referenceDate: dateOnly(record.referenceDate, "snapshot.referenceDate"),
    scope: "national-overview",
    totals: parsedTotals,
    statuses,
    themes,
    natures,
    annualSeries,
    reconciliation: parsedReconciliation,
    source: {
      owner: string(sourceRecord.owner, "snapshot.source.owner"),
      dataset: string(sourceRecord.dataset, "snapshot.source.dataset"),
      endpoint: officialUrl(sourceRecord.endpoint, "snapshot.source.endpoint") as string,
      license: string(sourceRecord.license, "snapshot.source.license"),
      declaredCadence: string(sourceRecord.declaredCadence, "snapshot.source.declaredCadence"),
      platformCheckCadence: string(
        sourceRecord.platformCheckCadence,
        "snapshot.source.platformCheckCadence",
      ),
      observedAt: isoTimestamp(sourceRecord.observedAt, "snapshot.source.observedAt"),
    },
    methodology: {
      paymentCostRatioMeaning: string(
        methodologyRecord.paymentCostRatioMeaning,
        "snapshot.methodology.paymentCostRatioMeaning",
      ),
      territorialWarning: string(
        methodologyRecord.territorialWarning,
        "snapshot.methodology.territorialWarning",
      ),
      roundingToleranceCents: integer(
        methodologyRecord.roundingToleranceCents,
        "snapshot.methodology.roundingToleranceCents",
        200,
      ),
    },
  };
}

export function paymentCostRatio(data: OpenCoesioneSnapshot): number {
  return data.totals.publicCostCents === 0
    ? 0
    : data.totals.paymentsCents / data.totals.publicCostCents;
}
