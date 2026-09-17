const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const ENDPOINT = "https://adp-api.perlapa.gov.it/api/public/incarichi/StatisticheIncarichi";
const LANDING_URL = "https://consulentipubblici.dfp.gov.it/progetto";

export type ExternalAppointmentYear = {
  year: number;
  assignments: number;
  paidCents: number;
  completedAssignments: number;
  individualRecipients: number;
  organizationRecipients: number;
};

export type EmployeeAppointmentYear = {
  year: number;
  assignments: number;
  paidCents: number;
  completedAssignments: number;
  managerAssignments: number;
  nonManagerAssignments: number;
  publicAdministrationGrantorRecords: number;
};

export type ConsulentiSnapshot = {
  schemaVersion: 1;
  transformVersion: 1;
  scope: "national-annual-overview";
  generatedAt: string;
  latestYear: number;
  externalAppointments: ExternalAppointmentYear[];
  employeeAppointments: EmployeeAppointmentYear[];
  source: {
    owner: string;
    dataset: string;
    landingUrl: string;
    endpoint: string;
    licenseUrl: string;
    reuseTerms: string;
    observedAt: string;
    declaredCadence: string;
    platformCheckCadence: string;
  };
  methodology: {
    amountMeaning: string;
    currentYearWarning: string;
    responsibilityWarning: string;
    publicAdministrationGrantorMeaning: string;
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

function isoTimestamp(value: unknown, field: string): string {
  const result = text(value, field);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field}: timestamp ISO non valido`);
  return result;
}

function exactUrl(value: unknown, field: string, expected: string): string {
  const result = text(value, field);
  if (result !== expected) throw new Error(`${field}: URL ufficiale inatteso`);
  return result;
}

function externalYears(value: unknown): ExternalAppointmentYear[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("snapshot.externalAppointments: serie non vuota attesa");
  }
  return value.map((item, index) => {
    const field = `snapshot.externalAppointments[${index}]`;
    const record = object(item, field);
    const assignments = integer(record.assignments, `${field}.assignments`);
    const completedAssignments = integer(
      record.completedAssignments,
      `${field}.completedAssignments`,
      assignments,
    );
    return {
      year: integer(record.year, `${field}.year`, 2200),
      assignments,
      paidCents: integer(record.paidCents, `${field}.paidCents`),
      completedAssignments,
      individualRecipients: integer(record.individualRecipients, `${field}.individualRecipients`),
      organizationRecipients: integer(
        record.organizationRecipients,
        `${field}.organizationRecipients`,
      ),
    };
  });
}

function employeeYears(value: unknown): EmployeeAppointmentYear[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("snapshot.employeeAppointments: serie non vuota attesa");
  }
  return value.map((item, index) => {
    const field = `snapshot.employeeAppointments[${index}]`;
    const record = object(item, field);
    const assignments = integer(record.assignments, `${field}.assignments`);
    const managerAssignments = integer(
      record.managerAssignments,
      `${field}.managerAssignments`,
      assignments,
    );
    const nonManagerAssignments = integer(
      record.nonManagerAssignments,
      `${field}.nonManagerAssignments`,
      assignments,
    );
    if (managerAssignments + nonManagerAssignments !== assignments) {
      throw new Error(`${field}: dirigenti e non dirigenti non riconciliano con il totale`);
    }
    return {
      year: integer(record.year, `${field}.year`, 2200),
      assignments,
      paidCents: integer(record.paidCents, `${field}.paidCents`),
      completedAssignments: integer(
        record.completedAssignments,
        `${field}.completedAssignments`,
        assignments,
      ),
      managerAssignments,
      nonManagerAssignments,
      publicAdministrationGrantorRecords: integer(
        record.publicAdministrationGrantorRecords,
        `${field}.publicAdministrationGrantorRecords`,
      ),
    };
  });
}

function assertStrictlyIncreasing(years: readonly number[], field: string): void {
  for (let index = 1; index < years.length; index += 1) {
    if (years[index] <= years[index - 1]) {
      throw new Error(`${field}: anni non strettamente crescenti`);
    }
  }
}

export function assertConsulentiSnapshot(value: unknown): ConsulentiSnapshot {
  const record = object(value, "snapshot");
  if (record.schemaVersion !== 1 || record.transformVersion !== 1) {
    throw new Error("snapshot: versione 1 attesa");
  }
  if (record.scope !== "national-annual-overview") {
    throw new Error("snapshot.scope non valido");
  }

  const externalAppointments = externalYears(record.externalAppointments);
  const employeeAppointments = employeeYears(record.employeeAppointments);
  const externalYearValues = externalAppointments.map((item) => item.year);
  const employeeYearValues = employeeAppointments.map((item) => item.year);
  assertStrictlyIncreasing(externalYearValues, "snapshot.externalAppointments");
  assertStrictlyIncreasing(employeeYearValues, "snapshot.employeeAppointments");
  if (
    externalYearValues.length !== employeeYearValues.length ||
    externalYearValues.some((year, index) => year !== employeeYearValues[index])
  ) {
    throw new Error("snapshot: consulenti e dipendenti devono coprire gli stessi anni");
  }
  const latestYear = integer(record.latestYear, "snapshot.latestYear", 2200);
  if (latestYear !== externalYearValues.at(-1)) {
    throw new Error("snapshot.latestYear non corrisponde alla serie");
  }

  const sourceRecord = object(record.source, "snapshot.source");
  const methodologyRecord = object(record.methodology, "snapshot.methodology");
  const generatedAt = isoTimestamp(record.generatedAt, "snapshot.generatedAt");
  const observedAt = isoTimestamp(sourceRecord.observedAt, "snapshot.source.observedAt");
  if (generatedAt !== observedAt) {
    throw new Error("snapshot: generatedAt e observedAt devono coincidere");
  }

  return {
    schemaVersion: 1,
    transformVersion: 1,
    scope: "national-annual-overview",
    generatedAt,
    latestYear,
    externalAppointments,
    employeeAppointments,
    source: {
      owner: text(sourceRecord.owner, "snapshot.source.owner"),
      dataset: text(sourceRecord.dataset, "snapshot.source.dataset"),
      landingUrl: exactUrl(sourceRecord.landingUrl, "snapshot.source.landingUrl", LANDING_URL),
      endpoint: exactUrl(sourceRecord.endpoint, "snapshot.source.endpoint", ENDPOINT),
      licenseUrl: exactUrl(
        sourceRecord.licenseUrl,
        "snapshot.source.licenseUrl",
        "https://www.perlapa.gov.it/cd-note-legali.html",
      ),
      reuseTerms: text(sourceRecord.reuseTerms, "snapshot.source.reuseTerms"),
      observedAt,
      declaredCadence: text(sourceRecord.declaredCadence, "snapshot.source.declaredCadence"),
      platformCheckCadence: text(
        sourceRecord.platformCheckCadence,
        "snapshot.source.platformCheckCadence",
      ),
    },
    methodology: {
      amountMeaning: text(methodologyRecord.amountMeaning, "snapshot.methodology.amountMeaning"),
      currentYearWarning: text(
        methodologyRecord.currentYearWarning,
        "snapshot.methodology.currentYearWarning",
      ),
      responsibilityWarning: text(
        methodologyRecord.responsibilityWarning,
        "snapshot.methodology.responsibilityWarning",
      ),
      publicAdministrationGrantorMeaning: text(
        methodologyRecord.publicAdministrationGrantorMeaning,
        "snapshot.methodology.publicAdministrationGrantorMeaning",
      ),
    },
  };
}
