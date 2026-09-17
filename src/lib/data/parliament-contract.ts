const OFFICIAL_HOSTS = new Set([
  "trasparenza.camera.it",
  "documenti.camera.it",
  "www.camera.it",
  "camera.it",
  "www.senato.it",
  "senato.it",
]);

type StatementKind = "account" | "budget";
type ChamberId = "camera" | "senato";

export type ParliamentCategory = {
  id: string;
  label: string;
  paid: number;
  components?: ParliamentCategoryComponent[];
  caveat?: string;
};

export type ParliamentCategoryComponent = {
  id: string;
  label: string;
  paid: number;
};

export type ParliamentHighlight = {
  id: string;
  label: string;
  value: number;
};

export type ParliamentStatement = {
  kind: StatementKind;
  year: number;
  title: string;
  documentUrl: string;
  values?: Record<string, number>;
  categories?: ParliamentCategory[];
  highlights?: ParliamentHighlight[];
  categoryReconciliationTolerance?: number;
  meaning: string;
};

export type ParliamentChamber = {
  id: ChamberId;
  name: string;
  structuredStatus: "structured-summary";
  landingUrl: string;
  procedureUrl?: string;
  statements: ParliamentStatement[];
};

export type ParliamentSnapshot = {
  schemaVersion: 1;
  transformVersion: 2;
  observedAt: string;
  unit: "million-euro";
  rounding: string;
  chambers: ParliamentChamber[];
  methodology: {
    comparability: string;
    missingData: string;
    publicationCheck: string;
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

function officialUrl(value: unknown, field: string): string {
  const raw = text(value, field);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !OFFICIAL_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(`${field}: URL parlamentare ufficiale atteso`);
  }
  return raw;
}

function amount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field}: importo non negativo atteso`);
  }
  return value;
}

function listOfAmounts<T extends "paid" | "value">(
  value: unknown,
  field: string,
  amountField: T,
): Array<{ id: string; label: string } & Record<T, number>> {
  if (!Array.isArray(value)) throw new Error(`${field}: lista attesa`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const itemField = `${field}[${index}]`;
    const record = object(item, itemField);
    const id = text(record.id, `${itemField}.id`);
    if (seen.has(id)) throw new Error(`${field}: id duplicato ${id}`);
    seen.add(id);
    return {
      id,
      label: text(record.label, `${itemField}.label`),
      [amountField]: amount(record[amountField], `${itemField}.${amountField}`),
    } as { id: string; label: string } & Record<T, number>;
  });
}

function categoryList(value: unknown, field: string): ParliamentCategory[] {
  if (!Array.isArray(value)) throw new Error(`${field}: lista attesa`);
  const base = listOfAmounts(value, field, "paid");
  return base.map((category, index) => {
    const record = object(value[index], `${field}[${index}]`);
    const components = record.components === undefined
      ? undefined
      : listOfAmounts(record.components, `${field}[${index}].components`, "paid");
    const caveat = record.caveat === undefined
      ? undefined
      : text(record.caveat, `${field}[${index}].caveat`);

    if (components) {
      const componentTotal = components.reduce((total, component) => total + component.paid, 0);
      if (Math.abs(componentTotal - category.paid) > 0.000001) {
        throw new Error(`${field}[${index}]: componenti non riconciliate con la categoria`);
      }
      if (!caveat) {
        throw new Error(`${field}[${index}]: nota semantica richiesta per la scomposizione`);
      }
    }

    if (category.id === "pensions") {
      if (category.label !== "Spese previdenziali") {
        throw new Error(`${field}[${index}]: il Titolo III non può essere rinominato vitalizi`);
      }
      const componentIds = components?.map((component) => component.id).sort() ?? [];
      if (
        componentIds.length !== 2 ||
        componentIds[0] !== "former-deputies" ||
        componentIds[1] !== "retired-staff"
      ) {
        throw new Error(`${field}[${index}]: Categorie XII e XIII richieste`);
      }
      if (!caveat?.toLocaleLowerCase("it-IT").includes("non equivale ai soli vitalizi")) {
        throw new Error(`${field}[${index}]: limite semantico sui vitalizi richiesto`);
      }
    }

    return {
      ...category,
      ...(components ? { components } : {}),
      ...(caveat ? { caveat } : {}),
    };
  });
}

function statement(value: unknown, field: string): ParliamentStatement {
  const record = object(value, field);
  const kind = record.kind;
  if (kind !== "account" && kind !== "budget") {
    throw new Error(`${field}.kind: account o budget atteso`);
  }
  const year = record.year;
  if (!Number.isInteger(year) || (year as number) < 1948 || (year as number) > 2200) {
    throw new Error(`${field}.year: anno non valido`);
  }

  const valuesRecord = record.values === undefined ? undefined : object(record.values, `${field}.values`);
  const values = valuesRecord
    ? Object.fromEntries(
        Object.entries(valuesRecord).map(([key, item]) => [key, amount(item, `${field}.values.${key}`)]),
      )
    : undefined;
  const categories = record.categories === undefined
    ? undefined
    : categoryList(record.categories, `${field}.categories`);
  const highlights = record.highlights === undefined
    ? undefined
    : listOfAmounts(record.highlights, `${field}.highlights`, "value");
  const tolerance = record.categoryReconciliationTolerance === undefined
    ? undefined
    : amount(record.categoryReconciliationTolerance, `${field}.categoryReconciliationTolerance`);

  if (categories && values?.effectivePayments !== undefined) {
    const categoryTotal = categories.reduce((total, item) => total + item.paid, 0);
    if (Math.abs(categoryTotal - values.effectivePayments) > (tolerance ?? 0)) {
      throw new Error(`${field}: categorie non riconciliate con i pagamenti`);
    }
  }

  return {
    kind,
    year: year as number,
    title: text(record.title, `${field}.title`),
    documentUrl: officialUrl(record.documentUrl, `${field}.documentUrl`),
    ...(values ? { values } : {}),
    ...(categories ? { categories } : {}),
    ...(highlights ? { highlights } : {}),
    ...(tolerance !== undefined ? { categoryReconciliationTolerance: tolerance } : {}),
    meaning: text(record.meaning, `${field}.meaning`),
  };
}

function hasStructuredData(entry: ParliamentStatement): boolean {
  return Boolean(
    (entry.values && Object.keys(entry.values).length > 0) ||
      (entry.categories && entry.categories.length > 0) ||
      (entry.highlights && entry.highlights.length > 0),
  );
}

export function assertParliamentSnapshot(value: unknown): ParliamentSnapshot {
  const record = object(value, "snapshot");
  if (record.schemaVersion !== 1 || record.transformVersion !== 2) {
    throw new Error("snapshot: versione 1 attesa");
  }
  const observedAt = text(record.observedAt, "snapshot.observedAt");
  if (Number.isNaN(new Date(observedAt).getTime())) {
    throw new Error("snapshot.observedAt: timestamp non valido");
  }
  if (record.unit !== "million-euro") throw new Error("snapshot.unit non valida");
  if (!Array.isArray(record.chambers) || record.chambers.length < 1 || record.chambers.length > 2) {
    throw new Error("snapshot.chambers: uno o due rami parlamentari attesi");
  }

  const chamberIds = new Set<string>();
  const chambers = record.chambers.map((item, index): ParliamentChamber => {
    const field = `snapshot.chambers[${index}]`;
    const chamber = object(item, field);
    if (chamber.id !== "camera" && chamber.id !== "senato") {
      throw new Error(`${field}.id non valido`);
    }
    if (chamberIds.has(chamber.id)) throw new Error(`${field}.id duplicato`);
    chamberIds.add(chamber.id);
    if (chamber.structuredStatus !== "structured-summary") {
      throw new Error(`${field}: si possono pubblicare soltanto dati strutturati`);
    }
    if (!Array.isArray(chamber.statements) || chamber.statements.length === 0) {
      throw new Error(`${field}.statements: lista non vuota attesa`);
    }
    const statements = chamber.statements.map((entry, statementIndex) =>
      statement(entry, `${field}.statements[${statementIndex}]`),
    );
    if (statements.some((entry) => !hasStructuredData(entry))) {
      throw new Error(`${field}: ogni documento pubblico deve avere valori strutturati`);
    }
    return {
      id: chamber.id,
      name: text(chamber.name, `${field}.name`),
      structuredStatus: chamber.structuredStatus,
      landingUrl: officialUrl(chamber.landingUrl, `${field}.landingUrl`),
      ...(chamber.procedureUrl
        ? { procedureUrl: officialUrl(chamber.procedureUrl, `${field}.procedureUrl`) }
        : {}),
      statements,
    };
  });

  const methodology = object(record.methodology, "snapshot.methodology");
  return {
    schemaVersion: 1,
    transformVersion: 2,
    observedAt,
    unit: "million-euro",
    rounding: text(record.rounding, "snapshot.rounding"),
    chambers,
    methodology: {
      comparability: text(methodology.comparability, "snapshot.methodology.comparability"),
      missingData: text(methodology.missingData, "snapshot.methodology.missingData"),
      publicationCheck: text(
        methodology.publicationCheck,
        "snapshot.methodology.publicationCheck",
      ),
    },
  };
}
