export type InpsPensionsSourceDocument = {
  id: string;
  title: string;
  owner: string;
  url: string;
  documentDate: string;
  dateNote: string;
  locator: string;
  observedAt: string;
  sha256: string;
  rightsNote: string;
};

export type InpsPensionsNatureItem = {
  id: "previdenziali" | "assistenziali";
  label: string;
  pensionCount: number;
  sharePercent: number;
  amountMillionTenths: number;
};

export type InpsPensionsCategoryItem = {
  id: string;
  label: string;
  nature: InpsPensionsNatureItem["id"];
  pensionCount: number;
  amountMillionTenths: number;
};

export type InpsPensionsManagementItem = {
  id: string;
  label: string;
  pensionCount: number;
  amountMillionTenths: number;
};

export type InpsPensionsStockPoint = {
  year: number;
  previdenziali: number;
  assistenziali: number;
  total: number;
};

export type InpsPensionsOsservatorioSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  scope: "inps-administered-pensions";
  asOf: string;
  stock: {
    measure: string;
    unit: "benefits";
    pensionCount: number;
    amountMillionTenths: number;
    amountUnit: "million-euros-tenths";
    amountNote: string;
    sourceId: string;
  };
  nature: {
    sourceId: string;
    items: InpsPensionsNatureItem[];
  };
  categories: {
    sourceId: string;
    items: InpsPensionsCategoryItem[];
  };
  managementGroups: {
    sourceId: string;
    items: InpsPensionsManagementItem[];
  };
  stockSeries: {
    measure: string;
    unit: "benefits";
    sourceId: string;
    warning: string;
    observations: InpsPensionsStockPoint[];
  };
  awardedIn2025: {
    measure: string;
    pensionCount: number;
    sourceId: string;
    warning: string;
  };
  vintageCube: {
    osservatorioId: "388";
    title: string;
    url: string;
    parentArea: string;
    stockYears: number[];
    dimensions: string[];
    measures: string[];
    sourceId: string;
    warning: string;
  };
  methodology: {
    definitions: string;
    perimeter: string;
    amounts: string;
    rounding: string;
  };
  sources: InpsPensionsSourceDocument[];
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot INPS pensioni non valido: ${message}`);
}

function nonEmptyText(value: unknown, label: string): asserts value is string {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} mancante`);
}

function isoDate(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(!Number.isNaN(Date.parse(value)), `${label} non valida`);
}

function nonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  invariant(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${label} non intero`);
}

function sha256(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(/^[a-f0-9]{64}$/.test(value), `${label} non è uno sha256`);
}

function httpsUrl(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(/^https:\/\/(www\.inps\.it|servizi2\.inps\.it)\//.test(value), `${label} non è un URL INPS`);
}

export function millionTenthsToCents(tenths: number): number {
  const cents = tenths * 10_000_000;
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Importo INPS pensioni fuori dal range intero sicuro");
  }
  return cents;
}

export function validateInpsPensionsOsservatorioSnapshot(
  input: unknown,
): InpsPensionsOsservatorioSnapshot {
  invariant(input !== null && typeof input === "object", "payload assente");
  const snapshot = input as InpsPensionsOsservatorioSnapshot;
  invariant(snapshot.schemaVersion === 1, "schemaVersion");
  invariant(snapshot.scope === "inps-administered-pensions", "scope");
  isoDate(snapshot.generatedAt, "generatedAt");
  isoDate(snapshot.asOf, "asOf");
  invariant(snapshot.asOf === "2026-01-01", "data dello stock");

  nonEmptyText(snapshot.stock.measure, "misura dello stock");
  invariant(snapshot.stock.unit === "benefits", "unità dello stock");
  nonNegativeSafeInteger(snapshot.stock.pensionCount, "pensioni vigenti");
  nonNegativeSafeInteger(snapshot.stock.amountMillionTenths, "importo stock");
  invariant(snapshot.stock.amountUnit === "million-euros-tenths", "unità importo");
  nonEmptyText(snapshot.stock.amountNote, "nota importo");
  nonEmptyText(snapshot.stock.sourceId, "fonte stock");
  millionTenthsToCents(snapshot.stock.amountMillionTenths);

  const natureIds = snapshot.nature.items.map((item) => item.id);
  invariant(natureIds.join("|") === "previdenziali|assistenziali", "natura");
  const natureCount = snapshot.nature.items.reduce((sum, item) => sum + item.pensionCount, 0);
  invariant(natureCount === snapshot.stock.pensionCount, "natura non riconcilia lo stock");

  const categoryCount = snapshot.categories.items.reduce((sum, item) => sum + item.pensionCount, 0);
  invariant(categoryCount === snapshot.stock.pensionCount, "categorie non riconciliano lo stock");
  const previdenzialiFromCategories = snapshot.categories.items
    .filter((item) => item.nature === "previdenziali")
    .reduce((sum, item) => sum + item.pensionCount, 0);
  const assistenzialiFromCategories = snapshot.categories.items
    .filter((item) => item.nature === "assistenziali")
    .reduce((sum, item) => sum + item.pensionCount, 0);
  invariant(previdenzialiFromCategories === snapshot.nature.items[0].pensionCount, "categorie previdenziali");
  invariant(assistenzialiFromCategories === snapshot.nature.items[1].pensionCount, "categorie assistenziali");

  const managementCount = snapshot.managementGroups.items.reduce((sum, item) => sum + item.pensionCount, 0);
  invariant(managementCount === snapshot.stock.pensionCount, "gestioni non riconciliano lo stock");

  invariant(snapshot.stockSeries.observations.length === 15, "serie 2012-2026");
  snapshot.stockSeries.observations.forEach((point, index) => {
    invariant(point.year === 2012 + index, `anno serie ${point.year}`);
    invariant(point.previdenziali + point.assistenziali === point.total, `serie ${point.year}`);
    nonNegativeSafeInteger(point.total, `totale serie ${point.year}`);
  });
  const latestSeries = snapshot.stockSeries.observations.at(-1);
  invariant(latestSeries !== undefined, "ultima osservazione");
  invariant(latestSeries.year === 2026, "ultimo anno serie");
  invariant(latestSeries.total === snapshot.stock.pensionCount, "serie 2026 diversa dallo stock");
  invariant(latestSeries.previdenziali === snapshot.nature.items[0].pensionCount, "serie previdenziali 2026");
  invariant(latestSeries.assistenziali === snapshot.nature.items[1].pensionCount, "serie assistenziali 2026");

  nonNegativeSafeInteger(snapshot.awardedIn2025.pensionCount, "liquidate 2025");
  invariant(snapshot.vintageCube.osservatorioId === "388", "id osservatorio 388");
  invariant(
    snapshot.vintageCube.url === "https://servizi2.inps.it/servizi/osservatoristatistici/6/37/o/388",
    "URL tavola 388",
  );
  invariant(snapshot.vintageCube.stockYears.join(",") === "2022,2023,2024,2025,2026", "anni di stock 388");

  for (const key of ["definitions", "perimeter", "amounts", "rounding"] as const) {
    nonEmptyText(snapshot.methodology[key], `metodo ${key}`);
  }

  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  invariant(sourceIds.size === snapshot.sources.length, "id fonte duplicati");
  for (const source of snapshot.sources) {
    nonEmptyText(source.id, "id fonte");
    nonEmptyText(source.title, "titolo fonte");
    nonEmptyText(source.owner, "titolare fonte");
    httpsUrl(source.url, `url ${source.id}`);
    isoDate(source.documentDate, `documentDate ${source.id}`);
    nonEmptyText(source.dateNote, `dateNote ${source.id}`);
    nonEmptyText(source.locator, `locator ${source.id}`);
    isoDate(source.observedAt, `observedAt ${source.id}`);
    sha256(source.sha256, `sha256 ${source.id}`);
    nonEmptyText(source.rightsNote, `rightsNote ${source.id}`);
    invariant(/non presentato come dataset IODL/i.test(source.rightsNote), `licenza ${source.id}`);
  }
  for (const sourceId of [
    snapshot.stock.sourceId,
    snapshot.nature.sourceId,
    snapshot.categories.sourceId,
    snapshot.managementGroups.sourceId,
    snapshot.stockSeries.sourceId,
    snapshot.awardedIn2025.sourceId,
    snapshot.vintageCube.sourceId,
  ]) {
    invariant(sourceIds.has(sourceId), `fonte mancante: ${sourceId}`);
  }

  return snapshot;
}
