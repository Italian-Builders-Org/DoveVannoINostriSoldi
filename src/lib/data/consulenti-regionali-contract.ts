const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NATIONAL_ENDPOINT =
  "https://adp-api.perlapa.gov.it/api/public/incarichi/StatisticheIncarichi";
const REGIONAL_ENDPOINT =
  "https://adp-api.perlapa.gov.it/api/public/Incarichi/StatisticheIncarichi/Regione";
const LANDING_URL = "https://consulentipubblici.dfp.gov.it/dati-aggregati";
const PROJECT_URL = "https://consulentipubblici.dfp.gov.it/progetto";
const SCOPE = "territorial-external-appointments";

export type ConsulentiTerritorio = {
  territoryLabel: string;
  assignments: number;
  paidCents: number;
  completedAssignments: number;
  individualRecipients: number;
  organizationRecipients: number;
};

export type ConsulentiRegionaliYear = {
  year: number;
  territoryCount: number;
  assignments: number;
  paidCents: number;
  territoryPaidCentsSum: number;
  roundingResidualCents: number;
  territories: ConsulentiTerritorio[];
};

export type ConsulentiRegionaliSnapshot = {
  schemaVersion: 1;
  transformVersion: 1;
  scope: typeof SCOPE;
  generatedAt: string;
  latestYear: number;
  appointmentKind: "external";
  years: ConsulentiRegionaliYear[];
  soldi: {
    metric: "ammontareErogato";
    unit: "EUR-cents";
    meaning: string;
  };
  periodo: {
    grain: "calendar-year";
    field: "annoConferimento";
    from: number;
    to: number;
    partialLatestYear: true;
  };
  provenance: {
    owner: string;
    dataset: string;
    landingUrl: string;
    projectUrl: string;
    nationalEndpoint: string;
    regionalEndpoint: string;
    licenseUrl: string;
    reuseTerms: string;
    observedAt: string;
    declaredCadence: string;
    platformCheckCadence: string;
  };
  methodology: {
    territoryMeaning: string;
    amountMeaning: string;
    currentYearWarning: string;
    responsibilityWarning: string;
    rgsSeparation: string;
    labelDuplicates: string;
  };
};

function object(value: unknown, field: string): Record<string, unknown> {
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

function integer(value: unknown, field: string, maximum = MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${field}: intero non negativo sicuro atteso`);
  }
  return value as number;
}

function signedInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field}: intero sicuro atteso`);
  }
  return value as number;
}

function isoTimestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(new Date(result).getTime())) {
    throw new Error(`${field}: timestamp ISO non valido`);
  }
  return result;
}

function exactUrl(value: unknown, field: string, expected: string): string {
  const result = text(value, field);
  if (result !== expected) throw new Error(`${field}: URL ufficiale inatteso`);
  return result;
}

function territory(value: unknown, field: string): ConsulentiTerritorio {
  const record = object(value, field);
  const assignments = integer(record.assignments, `${field}.assignments`);
  const completedAssignments = integer(
    record.completedAssignments,
    `${field}.completedAssignments`,
    assignments,
  );
  return {
    territoryLabel: text(record.territoryLabel, `${field}.territoryLabel`),
    assignments,
    paidCents: integer(record.paidCents, `${field}.paidCents`),
    completedAssignments,
    individualRecipients: integer(
      record.individualRecipients,
      `${field}.individualRecipients`,
    ),
    organizationRecipients: integer(
      record.organizationRecipients,
      `${field}.organizationRecipients`,
    ),
  };
}

function year(value: unknown, index: number): ConsulentiRegionaliYear {
  const field = `snapshot.years[${index}]`;
  const record = object(value, field);
  if (!Array.isArray(record.territories) || record.territories.length === 0) {
    throw new Error(`${field}.territories: serie non vuota attesa`);
  }
  const territories = record.territories.map((item, territoryIndex) =>
    territory(item, `${field}.territories[${territoryIndex}]`),
  );
  const labels = territories.map((item) => item.territoryLabel);
  if (labels.length !== new Set(labels).size) {
    throw new Error(`${field}: etichette territorio duplicate`);
  }
  const territoryCount = integer(record.territoryCount, `${field}.territoryCount`);
  if (territoryCount !== territories.length) {
    throw new Error(`${field}.territoryCount non coincide con le righe`);
  }
  const assignments = integer(record.assignments, `${field}.assignments`);
  const paidCents = integer(record.paidCents, `${field}.paidCents`);
  const territoryPaidCentsSum = integer(
    record.territoryPaidCentsSum,
    `${field}.territoryPaidCentsSum`,
  );
  const roundingResidualCents = signedInteger(
    record.roundingResidualCents,
    `${field}.roundingResidualCents`,
  );
  if (roundingResidualCents !== territoryPaidCentsSum - paidCents) {
    throw new Error(`${field}: residuo di arrotondamento incoerente`);
  }
  if (Math.abs(roundingResidualCents) > territoryCount) {
    throw new Error(`${field}: residuo di arrotondamento fuori soglia`);
  }
  if (territories.reduce((sum, item) => sum + item.assignments, 0) !== assignments) {
    throw new Error(`${field}: somma incarichi non riconcilia`);
  }
  if (territories.reduce((sum, item) => sum + item.paidCents, 0) !== territoryPaidCentsSum) {
    throw new Error(`${field}: somma centesimi territorio non riconcilia`);
  }
  const expectedOrder = [...territories].sort((left, right) => {
    if (right.paidCents !== left.paidCents) return right.paidCents - left.paidCents;
    if (left.territoryLabel < right.territoryLabel) return -1;
    if (left.territoryLabel > right.territoryLabel) return 1;
    return 0;
  });
  for (let i = 0; i < territories.length; i += 1) {
    const actual = territories[i]!;
    const expected = expectedOrder[i]!;
    if (
      actual.territoryLabel !== expected.territoryLabel
      || actual.paidCents !== expected.paidCents
      || actual.assignments !== expected.assignments
    ) {
      throw new Error(`${field}: ordinamento territori non valido`);
    }
  }
  return {
    year: integer(record.year, `${field}.year`, 2200),
    territoryCount,
    assignments,
    paidCents,
    territoryPaidCentsSum,
    roundingResidualCents,
    territories,
  };
}

export function assertConsulentiRegionaliSnapshot(
  value: unknown,
): ConsulentiRegionaliSnapshot {
  const root = object(value, "snapshot");
  if (root.schemaVersion !== 1 || root.transformVersion !== 1) {
    throw new Error("snapshot: versione non supportata");
  }
  if (root.scope !== SCOPE) throw new Error("snapshot.scope non valido");
  if (root.appointmentKind !== "external") {
    throw new Error("snapshot.appointmentKind non valido");
  }
  if (!Array.isArray(root.years) || root.years.length === 0) {
    throw new Error("snapshot.years: serie non vuota attesa");
  }
  const years = root.years.map((item, index) => year(item, index));
  const yearNumbers = years.map((item) => item.year);
  if (yearNumbers.length !== new Set(yearNumbers).size) {
    throw new Error("snapshot.years: anni duplicati");
  }
  if (yearNumbers.join(",") !== [...yearNumbers].sort((a, b) => a - b).join(",")) {
    throw new Error("snapshot.years: anni non ordinati");
  }
  const latestYear = integer(root.latestYear, "snapshot.latestYear", 2200);
  if (latestYear !== years[years.length - 1]!.year) {
    throw new Error("snapshot.latestYear non corrisponde alla serie");
  }
  const soldi = object(root.soldi, "snapshot.soldi");
  const periodo = object(root.periodo, "snapshot.periodo");
  const provenance = object(root.provenance, "snapshot.provenance");
  const methodology = object(root.methodology, "snapshot.methodology");
  if (soldi.metric !== "ammontareErogato" || soldi.unit !== "EUR-cents") {
    throw new Error("snapshot.soldi non valido");
  }
  if (periodo.grain !== "calendar-year" || periodo.field !== "annoConferimento") {
    throw new Error("snapshot.periodo non valido");
  }
  if (periodo.partialLatestYear !== true) {
    throw new Error("snapshot.periodo.partialLatestYear atteso");
  }
  if (periodo.from !== years[0]!.year || periodo.to !== latestYear) {
    throw new Error("snapshot.periodo non coerente con gli anni");
  }
  return {
    schemaVersion: 1,
    transformVersion: 1,
    scope: SCOPE,
    generatedAt: isoTimestamp(root.generatedAt, "snapshot.generatedAt"),
    latestYear,
    appointmentKind: "external",
    years,
    soldi: {
      metric: "ammontareErogato",
      unit: "EUR-cents",
      meaning: text(soldi.meaning, "snapshot.soldi.meaning"),
    },
    periodo: {
      grain: "calendar-year",
      field: "annoConferimento",
      from: integer(periodo.from, "snapshot.periodo.from", 2200),
      to: integer(periodo.to, "snapshot.periodo.to", 2200),
      partialLatestYear: true,
    },
    provenance: {
      owner: text(provenance.owner, "snapshot.provenance.owner"),
      dataset: text(provenance.dataset, "snapshot.provenance.dataset"),
      landingUrl: exactUrl(provenance.landingUrl, "snapshot.provenance.landingUrl", LANDING_URL),
      projectUrl: exactUrl(provenance.projectUrl, "snapshot.provenance.projectUrl", PROJECT_URL),
      nationalEndpoint: exactUrl(
        provenance.nationalEndpoint,
        "snapshot.provenance.nationalEndpoint",
        NATIONAL_ENDPOINT,
      ),
      regionalEndpoint: exactUrl(
        provenance.regionalEndpoint,
        "snapshot.provenance.regionalEndpoint",
        REGIONAL_ENDPOINT,
      ),
      licenseUrl: text(provenance.licenseUrl, "snapshot.provenance.licenseUrl"),
      reuseTerms: text(provenance.reuseTerms, "snapshot.provenance.reuseTerms"),
      observedAt: isoTimestamp(provenance.observedAt, "snapshot.provenance.observedAt"),
      declaredCadence: text(provenance.declaredCadence, "snapshot.provenance.declaredCadence"),
      platformCheckCadence: text(
        provenance.platformCheckCadence,
        "snapshot.provenance.platformCheckCadence",
      ),
    },
    methodology: {
      territoryMeaning: text(methodology.territoryMeaning, "snapshot.methodology.territoryMeaning"),
      amountMeaning: text(methodology.amountMeaning, "snapshot.methodology.amountMeaning"),
      currentYearWarning: text(
        methodology.currentYearWarning,
        "snapshot.methodology.currentYearWarning",
      ),
      responsibilityWarning: text(
        methodology.responsibilityWarning,
        "snapshot.methodology.responsibilityWarning",
      ),
      rgsSeparation: text(methodology.rgsSeparation, "snapshot.methodology.rgsSeparation"),
      labelDuplicates: text(methodology.labelDuplicates, "snapshot.methodology.labelDuplicates"),
    },
  };
}

export function queryConsulentiRegionali(
  snapshot: ConsulentiRegionaliSnapshot,
  year?: number,
): ConsulentiRegionaliYear {
  if (year === undefined) {
    return snapshot.years[snapshot.years.length - 1]!;
  }
  const match = snapshot.years.find((item) => item.year === year);
  if (!match) {
    throw new Error(`Anno ${year} assente dallo snapshot territoriale Consulenti Pubblici`);
  }
  return match;
}
