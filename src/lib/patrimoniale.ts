/**
 * Contract of the wealth tax study snapshot (scripts/etl/patrimoniale.py).
 *
 * The reader refuses a payload whose numbers do not hold together: the bands of
 * the distribution must cover every household once and add up to the total,
 * the tail model must match the published share of the top 5%, every scenario
 * must be labelled as a hypothesis and its revenue must follow from base,
 * erosion and rate. A refused snapshot is never shown.
 */

export type Band = { group: string; label: string; householdsPct: number; wealthBn: number; perHouseholdK: number; thresholdK: number | null };
export type Distribution = {
  period: string;
  totalBn: number;
  households: number;
  meanK: number;
  medianK: number;
  top10Pct: number;
  top5Pct: number;
  bottom50Pct: number;
  gini: number;
  bands: Band[];
};
export type CompositionItem = { id: string; label: string; valueBn: number };
export type Composition = { group: string; items: CompositionItem[]; assetsBn: number; debtsBn: number; netBn: number };
export type SharePoint = { period: string; top10Pct: number; top5Pct: number; bottom50Pct: number; gini: number };
export type EuroAreaRow = { area: string; name: string; top10Pct: number; top5Pct: number; bottom50Pct: number; gini: number };
export type TailLevel = { thresholdK: number; households: number; wealthBn: number; extrapolated: boolean };
export type Tail = { alpha: number; thresholdK: number; check: { thresholdK: number; modelPct: number; publishedPct: number; gapPts: number }; levels: TailLevel[] };
export type ExistingTax = { id: string; label: string; year: number; valueMn: number; basis: string; source: string; pctGdp: number };
export type ScenarioCell = {
  kind: "scenario";
  thresholdK: number;
  ratePct: number;
  erosionPct: number;
  households: number;
  baseBn: number;
  revenueBn: number;
  variant?: string;
};
export type Variant = { id: string; label: string; erosionPct: number };
export type Scenarios = {
  note: string;
  thresholdsK: number[];
  ratesPct: number[];
  variantRatePct: number;
  grid: ScenarioCell[];
  variants: Variant[];
  variantGrid: ScenarioCell[];
  housingSharePct: number;
  businessSharePct: number;
};
export type AvsProposal = {
  act: string;
  group: string;
  status: string;
  exemptEuro: number;
  schedule: { fromK: number; ratePct: number }[];
  mainHomeExemptEuro: number;
  capPctIncome: number;
  declarationAboveEuro: number;
  households: number;
  revenue: { variant: string; kind: "scenario"; revenueBn: number }[];
};
export type Source = { id: string; label: string; owner: string; url: string; license: string };

export type PatrimonialeSnapshot = {
  version: string;
  observedAt: string;
  gdp2025Mn: number;
  distribution: Distribution;
  composition: { all: Composition; top10: Composition };
  shareSeries: SharePoint[];
  euroArea: EuroAreaRow[];
  tail: Tail;
  existingTaxes: ExistingTax[];
  existingContext: { ricottiTotalBn: number; ricottiBolloBn: number; immobiliTotaleBn: number; renditaCatastaleBn: number; ratioVsmVip: number };
  territory: {
    areas: { area: string; meanEuro: number; medianEuro: number }[];
    regions: { region: string; valueBn: number; mainHomeEuro: number; ratioMain: number; ratioOther: number }[];
  };
  scenarios: Scenarios;
  proposals: { avs: AvsProposal; s2102: { act: string; title: string; initiative: string; presented: string; status: string } };
  international: {
    ranking: { code: string; name: string; year: number; pctGdp: number }[];
    series: ({ year: number } & Record<string, number | null>)[];
    local2024: Record<string, number>;
    spain: { revenue2024Euro: number; declarants2024: number; itsgf2023Mn: number; itsgf2024Mn: number; itsgf2025Mn: number; capPctIncome: number; exemptEuro: number; mainHomeEuro: number; topRatePct: number; itsgfAboveEuro: number };
    switzerland: { thresholdFromChf: number; federalAbolished: number };
    norway: { municipalThresholdNok: number; stateThresholdNok: number; taxpayers2024: number; municipalRatePct: number; stateRatePct: number; stateTopRatePct: number };
    france: { ifi2025Mn: number; ifiTaxpayers2025: number };
  };
  sources: Source[];
};

function fail(message: string): never {
  throw new Error(`Snapshot patrimoniale non valido: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} non è un oggetto`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${path} non è un elenco non vuoto`);
  return value;
}

function num(value: unknown, path: string, min = -Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) fail(`${path} non è un numero valido`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${path} manca`);
  return value;
}

function nums<T extends Record<string, unknown>>(value: unknown, path: string, keys: string[], textKeys: string[] = []): T {
  const row = record(value, path);
  for (const key of keys) num(row[key], `${path}.${key}`);
  for (const key of textKeys) text(row[key], `${path}.${key}`);
  return row as T;
}

const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

function scenarioCell(value: unknown, path: string): ScenarioCell {
  const row = record(value, path);
  if (row.kind !== "scenario") fail(`${path} non è marcato come ipotesi`);
  const out = nums<ScenarioCell>(row, path, ["thresholdK", "ratePct", "erosionPct", "households", "baseBn", "revenueBn"]);
  const expected = (out.baseBn * (1 - out.erosionPct / 100) * out.ratePct) / 100;
  if (!close(expected, out.revenueBn, Math.max(0.02, expected * 0.002))) fail(`${path}: il gettito non segue da base, riduzione e aliquota`);
  return out;
}

export function assertPatrimonialeSnapshot(value: unknown): PatrimonialeSnapshot {
  const root = record(value, "snapshot");
  if (root.schemaVersion !== 1 || root.datasetId !== "patrimoniale") fail("schema o dataset inattesi");
  const gdp = num(root.gdp2025Mn, "gdp2025Mn", 1);

  const dist = nums<Distribution>(root.distribution, "distribution", ["totalBn", "households", "meanK", "medianK", "top10Pct", "top5Pct", "bottom50Pct", "gini"], ["period"]);
  const bands = list(dist.bands, "distribution.bands").map((item, index) => {
    const band = nums<Band>(item, `bands[${index}]`, ["householdsPct", "wealthBn", "perHouseholdK"], ["group", "label"]);
    if (band.thresholdK !== null) num(band.thresholdK, `bands[${index}].thresholdK`, 0);
    return band;
  });
  const shareSum = bands.reduce((sum, band) => sum + band.householdsPct, 0);
  const wealthSum = bands.reduce((sum, band) => sum + band.wealthBn, 0);
  if (shareSum !== 100 || !close(wealthSum, dist.totalBn, Math.max(1, dist.totalBn * 0.002))) fail("le fasce non coprono tutte le famiglie o non sommano al totale");

  const composition = record(root.composition, "composition");
  for (const key of ["all", "top10"]) {
    const comp = nums<Composition>(composition[key], `composition.${key}`, ["assetsBn", "debtsBn", "netBn"], ["group"]);
    list(comp.items, `composition.${key}.items`).forEach((item, index) => nums(item, `composition.${key}.items[${index}]`, ["valueBn"], ["id", "label"]));
    if (!close(comp.assetsBn - comp.debtsBn, comp.netBn, Math.max(2, comp.netBn * 0.003))) fail(`composition.${key}: attività meno debiti diverse dalla ricchezza netta`);
  }

  const tail = record(root.tail, "tail");
  const check = nums<Tail["check"]>(tail.check, "tail.check", ["thresholdK", "modelPct", "publishedPct", "gapPts"]);
  if (Math.abs(check.gapPts) > 2) fail("il modello della coda non riproduce la quota del 5% più ricco");
  list(tail.levels, "tail.levels").forEach((item, index) => nums(item, `tail.levels[${index}]`, ["thresholdK", "households", "wealthBn"]));

  list(root.existingTaxes, "existingTaxes").forEach((item, index) => {
    const tax = nums<ExistingTax>(item, `existingTaxes[${index}]`, ["year", "valueMn", "pctGdp"], ["id", "label", "basis", "source"]);
    if (!close((tax.valueMn / gdp) * 100, tax.pctGdp, 0.0015)) fail(`existingTaxes[${index}]: quota del PIL incoerente`);
  });

  const s = record(root.scenarios, "scenarios");
  text(s.note, "scenarios.note");
  list(s.grid, "scenarios.grid").forEach((item, index) => scenarioCell(item, `scenarios.grid[${index}]`));
  list(s.variantGrid, "scenarios.variantGrid").forEach((item, index) => {
    const out = scenarioCell(item, `scenarios.variantGrid[${index}]`);
    text(out.variant, `scenarios.variantGrid[${index}].variant`);
  });
  list(s.variants, "scenarios.variants").forEach((item, index) => nums(item, `scenarios.variants[${index}]`, ["erosionPct"], ["id", "label"]));

  const proposals = record(root.proposals, "proposals");
  const avs = nums<AvsProposal>(proposals.avs, "proposals.avs", ["exemptEuro", "mainHomeExemptEuro", "capPctIncome", "households"], ["act", "status"]);
  list(avs.schedule, "avs.schedule").forEach((item, index) => nums(item, `avs.schedule[${index}]`, ["fromK", "ratePct"]));
  list(avs.revenue, "avs.revenue").forEach((item, index) => {
    const row = record(item, `avs.revenue[${index}]`);
    if (row.kind !== "scenario") fail(`avs.revenue[${index}] non è marcato come ipotesi`);
    num(row.revenueBn, `avs.revenue[${index}].revenueBn`, 0);
  });

  const international = record(root.international, "international");
  list(international.ranking, "international.ranking").forEach((item, index) => nums(item, `ranking[${index}]`, ["year", "pctGdp"], ["code", "name"]));
  list(international.series, "international.series");
  list(root.sources, "sources").forEach((item, index) => {
    const source = record(item, `sources[${index}]`);
    if (!text(source.url, `sources[${index}].url`).startsWith("https://")) fail(`sources[${index}]: la fonte deve essere https`);
  });
  list(root.euroArea, "euroArea");
  list(root.shareSeries, "shareSeries");
  list(record(root.territory, "territory").areas, "territory.areas");
  list(record(root.territory, "territory").regions, "territory.regions");
  text(root.version, "version");
  text(root.observedAt, "observedAt");

  return root as unknown as PatrimonialeSnapshot;
}

/** Flat scenarios as a table: one row per threshold, one column per rate. */
export function scenarioTable(scenarios: Scenarios) {
  const columns = [...scenarios.ratesPct];
  const rows = scenarios.thresholdsK.map((thresholdK) => {
    const cells = columns.map((ratePct) => scenarios.grid.find((c) => c.thresholdK === thresholdK && c.ratePct === ratePct) ?? null);
    return { thresholdK, households: cells.find(Boolean)?.households ?? null, cells };
  });
  return { columns, rows };
}

/** The same thresholds at one rate, with the base reduced as in each variant. */
export function variantTable(scenarios: Scenarios) {
  const columns = scenarios.variants;
  const rows = scenarios.thresholdsK.map((thresholdK) => ({
    thresholdK,
    cells: columns.map((variant) => scenarios.variantGrid.find((c) => c.thresholdK === thresholdK && c.variant === variant.id) ?? null),
  }));
  return { columns, rows };
}

/** Billions of euro as a share of GDP (millions), two decimals. */
export function pctOfGdp(valueBn: number, gdpMn: number): number {
  return Math.round(((valueBn * 1000) / gdpMn) * 10000) / 100;
}
