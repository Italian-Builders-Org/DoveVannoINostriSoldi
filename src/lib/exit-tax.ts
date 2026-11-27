/**
 * Contract of the exit tax study snapshot (scripts/etl/exit_tax.py).
 *
 * The reader refuses a payload whose numbers do not hold together: the
 * government estimate must follow from its own inputs, every scenario must be
 * labelled as such and its tax must follow from its parameters, emigration
 * rows must add up. A refused snapshot is never shown.
 */

export type Proposal = {
  act: string;
  actTitle: string;
  actUrl: string;
  article: string;
  newArticle: string;
  thresholdEuro: number;
  ratePct: number;
  residence: string;
  governmentBondsPct: number;
  paymentDays: number;
  advancePct: number;
  deferralYearsEu: number;
  deferralYearsOther: number;
  effectiveFrom: string;
  status: string;
};

export type GovernmentEstimate = {
  inputs: { substituteTax: number; shareAboveThreshold: number; emigrationRate: number; potential: number };
  potential: number;
  annual: number;
  firstYear: number;
  refunds: number;
};

export type Amendment = { id: string; title: string | null; outcome: string; additionalArticle: boolean; groups: string[] };
export type EmigrationYear = { year: number; low: number; medium: number; high: number; total: number };
export type Destination = { country: string; low: number; medium: number; high: number; total: number };
export type ScenarioCell = {
  kind: "scenario";
  emigrationPct: number;
  gainSharePct: number;
  leavingStockBn: number;
  gainsBn: number;
  taxMn: number;
  advanceMn: number;
};
export type Scenarios = { ratePct: number; emigrationPct: number[]; gainSharePct: number[]; note: string; grid: ScenarioCell[] };
export type CountryRule = { country: string; rule: string; who: string; rate: string; deferral: string; revenue: string; sourceUrls: string[] };
export type Source = { id: string; label: string; owner: string; url: string; license: string };

export type ExitTaxSnapshot = {
  version: string;
  observedAt: string;
  proposal: Proposal;
  governmentEstimate: GovernmentEstimate;
  corteConti: string;
  businessExitTax: { rule: string; minEuro: number; maxEuro: number };
  amendments: { rows: Amendment[]; total: number; admissible: number };
  emigration: { series: EmigrationYear[]; destinationsYear: number; destinations: Destination[] };
  wealth: { quarter: string; assetsBn: number; topDecileAssetsBn: number; topDecileSharePct: number; stockAboveThresholdBn: number };
  scenarios: Scenarios;
  international: CountryRule[];
  sources: Source[];
};

function fail(message: string): never {
  throw new Error(`Snapshot exit tax non valido: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} non è un oggetto`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} non è un elenco`);
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

function httpsUrl(value: unknown, path: string): string {
  const url = text(value, path);
  if (!url.startsWith("https://")) fail(`${path}: la fonte deve essere un indirizzo https`);
  return url;
}

const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

export function assertExitTaxSnapshot(value: unknown): ExitTaxSnapshot {
  const root = record(value, "snapshot");
  if (root.schemaVersion !== 1 || root.datasetId !== "exit-tax") fail("schema o dataset inattesi");

  const p = record(root.proposal, "proposal");
  const proposal: Proposal = {
    act: text(p.act, "proposal.act"),
    actTitle: text(p.actTitle, "proposal.actTitle"),
    actUrl: httpsUrl(p.actUrl, "proposal.actUrl"),
    article: text(p.article, "proposal.article"),
    newArticle: text(p.newArticle, "proposal.newArticle"),
    thresholdEuro: num(p.thresholdEuro, "proposal.thresholdEuro", 1),
    ratePct: num(p.ratePct, "proposal.ratePct", 0),
    residence: text(p.residence, "proposal.residence"),
    governmentBondsPct: num(p.governmentBondsPct, "proposal.governmentBondsPct", 0),
    paymentDays: num(p.paymentDays, "proposal.paymentDays", 1),
    advancePct: num(p.advancePct, "proposal.advancePct", 0),
    deferralYearsEu: num(p.deferralYearsEu, "proposal.deferralYearsEu", 0),
    deferralYearsOther: num(p.deferralYearsOther, "proposal.deferralYearsOther", 0),
    effectiveFrom: text(p.effectiveFrom, "proposal.effectiveFrom"),
    status: text(p.status, "proposal.status"),
  };

  const g = record(root.governmentEstimate, "governmentEstimate");
  const gi = record(g.inputs, "governmentEstimate.inputs");
  const estimate: GovernmentEstimate = {
    inputs: {
      substituteTax: num(gi.substituteTax, "inputs.substituteTax", 0),
      shareAboveThreshold: num(gi.shareAboveThreshold, "inputs.shareAboveThreshold", 0),
      emigrationRate: num(gi.emigrationRate, "inputs.emigrationRate", 0),
      potential: num(gi.potential, "inputs.potential", 0),
    },
    potential: num(g.potential, "governmentEstimate.potential", 0),
    annual: num(g.annual, "governmentEstimate.annual", 0),
    firstYear: num(g.firstYear, "governmentEstimate.firstYear", 0),
    refunds: num(g.refunds, "governmentEstimate.refunds", 0),
  };
  const product = (estimate.inputs.substituteTax * estimate.inputs.shareAboveThreshold * estimate.inputs.emigrationRate) / 10000;
  if (!close(product, estimate.potential, 0.01) || !close(estimate.potential, estimate.inputs.potential, 0.01) || !close(estimate.annual * 2, estimate.potential, 0.02)) {
    fail("la stima del Governo non segue dai suoi ingressi");
  }

  const b = record(root.businessExitTax, "businessExitTax");
  const a = record(root.amendments, "amendments");
  const rows = list(a.rows, "amendments.rows").map((item, index) => {
    const row = record(item, `amendments.rows[${index}]`);
    return {
      id: text(row.id, `amendments.rows[${index}].id`),
      title: typeof row.title === "string" ? row.title : null,
      outcome: text(row.outcome, `amendments.rows[${index}].outcome`),
      additionalArticle: row.additionalArticle === true,
      groups: list(row.groups, `amendments.rows[${index}].groups`).map((group) => text(group, "gruppo")),
    };
  });
  if (num(a.total, "amendments.total") !== rows.length) fail("totale degli emendamenti incoerente");

  const e = record(root.emigration, "emigration");
  const yearRow = (item: unknown, path: string) => {
    const row = record(item, path);
    const out = { low: num(row.low, `${path}.low`, 0), medium: num(row.medium, `${path}.medium`, 0), high: num(row.high, `${path}.high`, 0), total: num(row.total, `${path}.total`, 0) };
    if (out.low + out.medium + out.high !== out.total) fail(`${path}: gli espatri per titolo di studio non sommano al totale`);
    return out;
  };
  const series = list(e.series, "emigration.series").map((item, index) => ({ year: num(record(item, "anno").year, "emigration.year", 2000), ...yearRow(item, `emigration.series[${index}]`) }));
  const destinations = list(e.destinations, "emigration.destinations").map((item, index) => ({ country: text(record(item, "paese").country, "paese"), ...yearRow(item, `emigration.destinations[${index}]`) }));

  const w = record(root.wealth, "wealth");
  const s = record(root.scenarios, "scenarios");
  const rate = num(s.ratePct, "scenarios.ratePct", 0);
  const stock = num(w.stockAboveThresholdBn, "wealth.stockAboveThresholdBn", 0);
  const grid = list(s.grid, "scenarios.grid").map((item, index) => {
    const cell = record(item, `scenarios.grid[${index}]`);
    if (cell.kind !== "scenario") fail(`scenario ${index} non marcato come ipotesi`);
    const out: ScenarioCell = {
      kind: "scenario",
      emigrationPct: num(cell.emigrationPct, "emigrationPct", 0),
      gainSharePct: num(cell.gainSharePct, "gainSharePct", 0),
      leavingStockBn: num(cell.leavingStockBn, "leavingStockBn", 0),
      gainsBn: num(cell.gainsBn, "gainsBn", 0),
      taxMn: num(cell.taxMn, "taxMn", 0),
      advanceMn: num(cell.advanceMn, "advanceMn", 0),
    };
    const expected = ((stock * out.emigrationPct) / 100) * (out.gainSharePct / 100) * (rate / 100) * 1000;
    if (!close(expected, out.taxMn, Math.max(0.2, expected * 0.002))) fail(`scenario ${index}: l'imposta non segue dai parametri`);
    return out;
  });

  return {
    version: text(root.version, "version"),
    observedAt: text(root.observedAt, "observedAt"),
    proposal,
    governmentEstimate: estimate,
    corteConti: text(root.corteConti, "corteConti"),
    businessExitTax: { rule: text(b.rule, "businessExitTax.rule"), minEuro: num(b.minEuro, "minEuro", 0), maxEuro: num(b.maxEuro, "maxEuro", 0) },
    amendments: { rows, total: rows.length, admissible: num(a.admissible, "amendments.admissible", 0) },
    emigration: { series, destinationsYear: num(e.destinationsYear, "destinationsYear", 2000), destinations },
    wealth: {
      quarter: text(w.quarter, "wealth.quarter"),
      assetsBn: num(w.assetsBn, "wealth.assetsBn", 0),
      topDecileAssetsBn: num(w.topDecileAssetsBn, "wealth.topDecileAssetsBn", 0),
      topDecileSharePct: num(w.topDecileSharePct, "wealth.topDecileSharePct", 0),
      stockAboveThresholdBn: stock,
    },
    scenarios: {
      ratePct: rate,
      emigrationPct: list(s.emigrationPct, "scenarios.emigrationPct").map((v) => num(v, "emigrationPct", 0)),
      gainSharePct: list(s.gainSharePct, "scenarios.gainSharePct").map((v) => num(v, "gainSharePct", 0)),
      note: text(s.note, "scenarios.note"),
      grid,
    },
    international: list(root.international, "international").map((item, index) => {
      const row = record(item, `international[${index}]`);
      return {
        country: text(row.country, "country"),
        rule: text(row.rule, "rule"),
        who: text(row.who, "who"),
        rate: text(row.rate, "rate"),
        deferral: text(row.deferral, "deferral"),
        revenue: text(row.revenue, "revenue"),
        sourceUrls: list(row.sourceUrls, "sourceUrls").map((url) => httpsUrl(url, `international[${index}].fonte`)),
      };
    }),
    sources: list(root.sources, "sources").map((item, index) => {
      const row = record(item, `sources[${index}]`);
      return { id: text(row.id, "id"), label: text(row.label, "label"), owner: text(row.owner, "owner"), url: httpsUrl(row.url, `sources[${index}].fonte`), license: text(row.license, "license") };
    }),
  };
}

/** The scenario grid as a table: one row per emigration rate, one column per share of unrealised gain. */
export function scenarioTable(scenarios: Scenarios) {
  const columns = [...scenarios.gainSharePct];
  const rows = scenarios.emigrationPct.map((emigrationPct) => ({
    emigrationPct,
    cells: columns.map((gainSharePct) => scenarios.grid.find((cell) => cell.emigrationPct === emigrationPct && cell.gainSharePct === gainSharePct) ?? null),
  }));
  return { columns, rows };
}

/** Share of graduates among the Italians who leave, one decimal. */
export function emigrationShareHigh(year: EmigrationYear): number {
  return Math.round((1000 * year.high) / year.total) / 10;
}
