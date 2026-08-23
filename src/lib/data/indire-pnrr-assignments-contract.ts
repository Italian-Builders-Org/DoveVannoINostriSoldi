export type IndirePnrrAssignment = {
  id: string;
  sourceRow: number;
  firstName: string;
  lastName: string;
  programId: "m4c1-i3-1" | "m4c1-r2-1";
  programLabel: string;
  startDate: string;
  endDate: string;
  compensation: { basis: "contract_total"; valueCents: number };
  location: string | null;
  selection: string;
  cvPublished: boolean;
  conflictCheckPublished: boolean;
  decree: string;
};

export type IndirePnrrAssignmentsSnapshot = {
  schemaVersion: 1;
  dataset: "indire_pnrr_external_assignments";
  generatedAt: string;
  source: {
    owner: string;
    landingUrl: string;
    resourceUrl: string;
    referencePeriod: "aggiornamento aprile 2026";
    format: "XLSX";
    licenseStatus: "not-declared";
    asset: {
      bytes: 54_421;
      sha256: string;
      sheet: "Table 1";
      dimension: "A1:L205";
    };
  };
  coverage: {
    workbookAssignments: 201;
    pnrrAssignments: 88;
    uniquePeople: 88;
    compensationKnown: 88;
    latestEndDate: "2026-04-30";
  };
  totals: { contractCompensationCents: 597_807_504 };
  programs: Array<{
    id: IndirePnrrAssignment["programId"];
    label: string;
    assignments: number;
    compensationCents: number;
  }>;
  tiers: Array<{
    compensationCents: number;
    assignments: number;
    totalCents: number;
  }>;
  selections: Array<{ code: string; assignments: number }>;
  assignments: IndirePnrrAssignment[];
  methodology: {
    filter: string;
    scope: string;
    compensation: string;
    warning: string;
  };
};

const LANDING_URL = "https://www.indire.it/amministrazione/titolari-di-incarichi-di-collaborazione-o-consulenza/";
const RESOURCE_URL = "https://www.indire.it/wp-content/uploads/2026/05/Elenco-incarichi-di-prestazione-dopera_aprile-2026-3-1-1.xlsx";
const SOURCE_SHA256 = "d31dadc85a79b2b913608845202e146d0114469abeafe98a6d491d75f7f77a66";
const SOURCE_OWNER = "Istituto Nazionale di Documentazione, Innovazione e Ricerca Educativa (INDIRE)";
const PROGRAM_LABELS = new Map<IndirePnrrAssignment["programId"], string>([
  ["m4c1-i3-1", "M4C1 · Investimento 3.1 · Nuove competenze e nuovi linguaggi"],
  ["m4c1-r2-1", "M4C1 · Riforma 2.1 · Formazione alla transizione digitale"],
]);

function fail(message: string): never {
  throw new Error(`Snapshot incarichi PNRR INDIRE non valido: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} non è un oggetto`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} ha campi inattesi`);
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} non è valorizzato`);
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label} non è un intero valido`);
  return value as number;
}

function isoDate(value: unknown, label: string): string {
  const text = nonEmpty(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    fail(`${label} non è una data ISO`);
  }
  return text;
}

function parseAssignment(value: unknown): IndirePnrrAssignment {
  const item = record(value, "incarico");
  exactKeys(
    item,
    [
      "id", "sourceRow", "firstName", "lastName", "programId", "programLabel", "startDate",
      "endDate", "compensation", "location", "selection", "cvPublished",
      "conflictCheckPublished", "decree",
    ],
    "incarico",
  );
  const programId = nonEmpty(item.programId, "incarico.programId") as IndirePnrrAssignment["programId"];
  const expectedLabel = PROGRAM_LABELS.get(programId);
  if (!expectedLabel || item.programLabel !== expectedLabel) fail("programma incarico inatteso");
  const compensation = record(item.compensation, "incarico.compensation");
  exactKeys(compensation, ["basis", "valueCents"], "incarico.compensation");
  if (compensation.basis !== "contract_total") fail("base compenso inattesa");
  const startDate = isoDate(item.startDate, "incarico.startDate");
  const endDate = isoDate(item.endDate, "incarico.endDate");
  if (endDate < startDate) fail("periodo incarico invertito");
  if (item.location !== null && typeof item.location !== "string") fail("sede incarico inattesa");
  if (item.cvPublished !== true || item.conflictCheckPublished !== true) {
    fail("evidenza CV o conflitto non pubblicata");
  }
  const id = nonEmpty(item.id, "incarico.id");
  if (!/^indire-pnrr-[a-f0-9]{16}$/.test(id)) fail("identificatore incarico inatteso");
  const sourceRow = safeInteger(item.sourceRow, "incarico.sourceRow");
  const valueCents = safeInteger(compensation.valueCents, "incarico.compensation.valueCents");
  if (sourceRow < 5 || sourceRow > 205) fail("riga fonte incarico inattesa");
  if (valueCents === 0) fail("compenso incarico non positivo");
  return {
    id,
    sourceRow,
    firstName: nonEmpty(item.firstName, "incarico.firstName"),
    lastName: nonEmpty(item.lastName, "incarico.lastName"),
    programId,
    programLabel: expectedLabel,
    startDate,
    endDate,
    compensation: {
      basis: "contract_total",
      valueCents,
    },
    location: item.location as string | null,
    selection: nonEmpty(item.selection, "incarico.selection"),
    cvPublished: true,
    conflictCheckPublished: true,
    decree: nonEmpty(item.decree, "incarico.decree"),
  };
}

function countBy<T>(values: T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  return counts;
}

export function assertIndirePnrrAssignmentsSnapshot(value: unknown): IndirePnrrAssignmentsSnapshot {
  const snapshot = record(value, "snapshot");
  exactKeys(
    snapshot,
    ["schemaVersion", "dataset", "generatedAt", "source", "coverage", "totals", "programs", "tiers", "selections", "assignments", "methodology"],
    "snapshot",
  );
  if (snapshot.schemaVersion !== 1 || snapshot.dataset !== "indire_pnrr_external_assignments") {
    fail("identità dataset inattesa");
  }
  isoDate(snapshot.generatedAt, "generatedAt");

  const source = record(snapshot.source, "source");
  const asset = record(source.asset, "source.asset");
  exactKeys(source, ["owner", "landingUrl", "resourceUrl", "referencePeriod", "format", "licenseStatus", "asset"], "source");
  exactKeys(asset, ["bytes", "sha256", "sheet", "dimension"], "source.asset");
  if (
    source.owner !== SOURCE_OWNER
    || source.landingUrl !== LANDING_URL
    || source.resourceUrl !== RESOURCE_URL
    || source.referencePeriod !== "aggiornamento aprile 2026"
    || source.format !== "XLSX"
    || source.licenseStatus !== "not-declared"
    || asset.bytes !== 54_421
    || asset.sha256 !== SOURCE_SHA256
    || asset.sheet !== "Table 1"
    || asset.dimension !== "A1:L205"
  ) fail("provenienza ufficiale inattesa");

  if (!Array.isArray(snapshot.assignments)) fail("elenco incarichi assente");
  const assignments = snapshot.assignments.map(parseAssignment);
  const uniqueIds = new Set(assignments.map((item) => item.id));
  const uniquePeople = new Set(assignments.map((item) => `${item.lastName}|${item.firstName}`));
  if (assignments.length !== 88 || uniqueIds.size !== 88 || uniquePeople.size !== 88) {
    fail("copertura o identità incarichi inattesa");
  }
  const latestEndDate = assignments.map((item) => item.endDate).sort().at(-1);
  if (latestEndDate !== "2026-04-30") {
    fail("data finale inattesa");
  }

  const total = assignments.reduce((sum, item) => sum + item.compensation.valueCents, 0);
  if (total !== 597_807_504) fail("totale compensi inatteso");

  const coverage = record(snapshot.coverage, "coverage");
  exactKeys(coverage, ["workbookAssignments", "pnrrAssignments", "uniquePeople", "compensationKnown", "latestEndDate"], "coverage");
  if (
    coverage.workbookAssignments !== 201
    || coverage.pnrrAssignments !== 88
    || coverage.uniquePeople !== 88
    || coverage.compensationKnown !== 88
    || coverage.latestEndDate !== "2026-04-30"
  ) fail("copertura dichiarata non riconciliata");
  const totals = record(snapshot.totals, "totals");
  exactKeys(totals, ["contractCompensationCents"], "totals");
  if (totals.contractCompensationCents !== total) fail("totale dichiarato non riconciliato");

  if (!Array.isArray(snapshot.programs) || snapshot.programs.length !== 2) fail("programmi inattesi");
  const programCounts = countBy(assignments, (item) => item.programId);
  const programAmounts = new Map<string, number>();
  for (const item of assignments) {
    programAmounts.set(item.programId, (programAmounts.get(item.programId) ?? 0) + item.compensation.valueCents);
  }
  const seenProgramIds = new Set<string>();
  for (const value of snapshot.programs) {
    const item = record(value, "programma");
    exactKeys(item, ["id", "label", "assignments", "compensationCents"], "programma");
    const id = nonEmpty(item.id, "programma.id") as IndirePnrrAssignment["programId"];
    if (seenProgramIds.has(id)) fail("programma duplicato");
    seenProgramIds.add(id);
    if (
      item.label !== PROGRAM_LABELS.get(id)
      || item.assignments !== programCounts.get(id)
      || item.compensationCents !== programAmounts.get(id)
    ) fail("programma non riconciliato");
  }

  if (!Array.isArray(snapshot.tiers) || snapshot.tiers.length !== 5) fail("fasce compenso inattese");
  const tierCounts = countBy(assignments, (item) => String(item.compensation.valueCents));
  const seenTierAmounts = new Set<number>();
  for (const value of snapshot.tiers) {
    const item = record(value, "fascia");
    exactKeys(item, ["compensationCents", "assignments", "totalCents"], "fascia");
    const amount = safeInteger(item.compensationCents, "fascia.compensationCents");
    const count = safeInteger(item.assignments, "fascia.assignments");
    if (amount === 0 || count === 0 || seenTierAmounts.has(amount)) fail("fascia compenso duplicata o vuota");
    seenTierAmounts.add(amount);
    if (count !== tierCounts.get(String(amount)) || item.totalCents !== amount * count) {
      fail("fascia compenso non riconciliata");
    }
  }

  if (!Array.isArray(snapshot.selections) || snapshot.selections.length !== 2) fail("selezioni inattese");
  const selectionCounts = countBy(assignments, (item) => item.selection);
  const seenSelectionCodes = new Set<string>();
  for (const value of snapshot.selections) {
    const item = record(value, "selezione");
    exactKeys(item, ["code", "assignments"], "selezione");
    const code = nonEmpty(item.code, "selezione.code");
    if (seenSelectionCodes.has(code)) fail("selezione duplicata");
    seenSelectionCodes.add(code);
    if (item.assignments !== selectionCounts.get(code)) {
      fail("selezione non riconciliata");
    }
  }

  const methodology = record(snapshot.methodology, "methodology");
  exactKeys(methodology, ["filter", "scope", "compensation", "warning"], "methodology");
  for (const key of ["filter", "scope", "compensation", "warning"] as const) {
    nonEmpty(methodology[key], `methodology.${key}`);
  }

  return value as IndirePnrrAssignmentsSnapshot;
}
