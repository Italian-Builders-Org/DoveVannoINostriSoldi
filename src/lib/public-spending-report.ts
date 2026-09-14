/** Helpers for the frozen, editorial report. No network and no new source dataset. */
export type ReportSource = {
  id: string; holder: string; title: string; url: string;
  publicationDate: string | null; referencePeriod: string; locator: string;
  checkedAt: string; verificationChannel: string; originalBytesSha256: string | null;
  rights: string; note: string;
};
export type ReportFact = {
  id: string; kind: string; title: string; text: string; referencePeriod: string;
  scope: string; sourceIds: string[]; calculationId: string | null; limitation: string;
  metrics: {key: string; value: string; unit: string}[];
};
export type ReportCalculation = {
  id: string; operation: string; inputs: string[]; result: string; roundDigits: number;
  roundedResult: string; display: string; description: string; sourceIds: string[];
};
export type ReportSection = {
  code: string; title: string; amountBillionRounded: string; headline: string;
  assessment: string; factIds: string[]; analysis: string[]; actions: string[];
  limitations: string; quantification: string; owner: string; kpi: string; sourceIds: string[];
};
export type PublicSpendingReport = {
  schemaVersion: number; reportId: string; slug: string; title: string; subtitle: string;
  edition: string; referenceDate: string; status: string; repositoryBase: string;
  predecessor: {pr: number; href: string; note: string};
  pdfPath: string; jsonPath: string; csvPath: string;
  scope: {name: string; accounting: string; macroYear: number; sectorEvidencePeriods: string;
    coverage: string; transactionAuditCoverage: null; reviewerSignoff: null; notClaimed: string[]};
  macro: {totalBillionRounded: string; shareGdpRounded: string; roundingUnit: string;
    sourceIds: string[]; sourceDataArtifactSha256Declared: string; provenance: string; reconciliation: string};
  executive: string[]; assessmentLabels: Record<string, string>; sections: ReportSection[];
  municipal: Omit<ReportSection, 'code' | 'amountBillionRounded' | 'headline' | 'assessment'>;
  facts: ReportFact[]; calculations: ReportCalculation[]; sources: ReportSource[];
  priorities: {title: string; scope: string; basis: string; action: string; tradeoff: string; sourceIds: string[]}[];
  methodology: string[]; noSavingsTotal: boolean; releaseGate: string;
};

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const COFOG_CODES = Array.from({length: 10}, (_, i) => `GF${String(i + 1).padStart(2, '0')}`);
function decimal(value: string): {n: bigint; d: bigint} {
  if (!DECIMAL.test(value)) throw new Error(`Numero decimale non valido: ${value}`);
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return {n: BigInt(whole + fraction) * (negative ? BigInt(-1) : BigInt(1)), d: BigInt(10) ** BigInt(fraction.length)};
}
/** Independent exact rational computation; no float in the report's calculation gate. */
export function calculateRounded(calculation: Pick<ReportCalculation, 'operation' | 'inputs' | 'roundDigits'>): string {
  if (calculation.inputs.length !== 2) throw new Error('Attesi due operandi');
  if (!Number.isInteger(calculation.roundDigits) || calculation.roundDigits < 0 || calculation.roundDigits > 8) {
    throw new Error('Precisione non valida');
  }
  const [a, b] = calculation.inputs.map(decimal);
  let n: bigint; let d: bigint;
  if (calculation.operation === 'difference') { n = a.n * b.d - b.n * a.d; d = a.d * b.d; }
  else {
    if (b.n === BigInt(0)) throw new Error('Denominatore nullo');
    n = a.n * b.d; d = a.d * b.n;
    if (calculation.operation === 'relative-change-percent') n = (n - d) * BigInt(100);
    else if (calculation.operation === 'ratio-percent') n *= BigInt(100);
    else if (calculation.operation !== 'ratio') throw new Error('Operazione non ammessa');
  }
  if (d < BigInt(0)) { n = -n; d = -d; }
  const sign = n < BigInt(0) ? '-' : '';
  const magnitude = n < BigInt(0) ? -n : n;
  const scaled = magnitude * BigInt(10) ** BigInt(calculation.roundDigits);
  const rounded = scaled / d + ((scaled % d) * BigInt(2) >= d ? BigInt(1) : BigInt(0));
  const digits = rounded.toString().padStart(calculation.roundDigits + 1, '0');
  const formatted = calculation.roundDigits === 0 ? digits : `${digits.slice(0, -calculation.roundDigits)}.${digits.slice(-calculation.roundDigits)}`;
  return rounded === BigInt(0) ? formatted : sign + formatted;
}

export function formatReportDecimal(value: string, digits = 2): string {
  if (!DECIMAL.test(value)) throw new Error('Valore non numerico');
  return Number(value).toLocaleString('it-IT', {minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: 'always'});
}
export function sectionShare(amount: string, total: string): string {
  return formatReportDecimal(calculateRounded({operation: 'ratio-percent', inputs: [amount, total], roundDigits: 1}), 1);
}

/** Validate the editorial contract before displaying it or building derived assets. */
export function validatePublicSpendingReport(report: PublicSpendingReport): PublicSpendingReport {
  if (report.schemaVersion !== 1 || report.reportId !== 'public-spending-2026') throw new Error('Edizione non riconosciuta');
  if (report.sections.length !== 10 || COFOG_CODES.some((code) => report.sections.filter((s) => s.code === code).length !== 1)) {
    throw new Error('Copertura COFOG incompleta o duplicata');
  }
  if (report.noSavingsTotal !== true || report.scope.transactionAuditCoverage !== null) throw new Error('Perimetro di audit non documentato');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.referenceDate)) throw new Error('Data non valida');
  if (!/^[a-f0-9]{64}$/.test(report.macro.sourceDataArtifactSha256Declared)) throw new Error('Hash del metadato non valido');
  if (Number(report.macro.totalBillionRounded) <= 0) throw new Error('Totale non valido');
  const sourceIds = new Set(report.sources.map((s) => s.id));
  const factIds = new Set(report.facts.map((s) => s.id));
  const calcIds = new Set(report.calculations.map((s) => s.id));
  if (sourceIds.size !== report.sources.length || factIds.size !== report.facts.length || calcIds.size !== report.calculations.length) {
    throw new Error('Identificativo duplicato');
  }
  const requireSources = (ids: string[]) => {
    if (!ids.length || ids.some((id) => !sourceIds.has(id))) throw new Error('Fonte assente o non risolta');
  };
  for (const source of report.sources) {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('URL fonte non sicuro');
    if (!source.holder || !source.locator || !source.verificationChannel) throw new Error('Provenienza incompleta');
    if (source.publicationDate && source.publicationDate > report.referenceDate) throw new Error('Fonte successiva al cutoff');
  }
  for (const fact of report.facts) {
    requireSources(fact.sourceIds);
    if (!report.assessmentLabels[fact.kind] || !fact.referencePeriod || !fact.scope || !fact.limitation) throw new Error('Fatto privo di contesto');
    if (fact.calculationId && !calcIds.has(fact.calculationId)) throw new Error('Calcolo non risolto');
    if (fact.metrics.some((m) => !DECIMAL.test(m.value))) throw new Error('Metrica non valida');
  }
  for (const calculation of report.calculations) {
    requireSources(calculation.sourceIds);
    if (calculateRounded(calculation) !== calculation.roundedResult) throw new Error(`Calcolo non riconciliato: ${calculation.id}`);
  }
  for (const section of [...report.sections, report.municipal]) {
    requireSources(section.sourceIds);
    if (section.factIds.some((id) => !factIds.has(id))) throw new Error('Fatto non risolto');
    if (!section.actions.length || !section.owner || !section.kpi || !section.quantification) throw new Error('Intervento incompleto');
  }
  report.sections.forEach((s) => { if (!/^\d+\.\d{2}$/.test(s.amountBillionRounded)) throw new Error('Unità monetaria della mappa non valida'); });
  report.priorities.forEach((p) => requireSources(p.sourceIds));
  requireSources(report.macro.sourceIds);
  if (JSON.stringify(report).includes('\u2014')) throw new Error('Punteggiatura non ammessa nel report');
  for (const path of [report.pdfPath, report.jsonPath, report.csvPath, report.predecessor.href]) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('Percorso non valido');
  }
  return report;
}

export type CofogCell = {geo: string; year: number; function: string; amountCents: number; shareOfGdpHundredths: number};
/** Compare the frozen report to the shared snapshot, without silently rewriting the edition. */
export function compareReportSnapshot(report: PublicSpendingReport, observations: readonly CofogCell[]): string[] {
  const cells = observations.filter((r) => r.geo === 'IT' && r.year === report.scope.macroYear);
  const differences: string[] = [];
  const expected = [{code: 'TOTAL', amount: report.macro.totalBillionRounded}, ...report.sections.map((s) => ({code: s.code, amount: s.amountBillionRounded}))];
  for (const item of expected) {
    const matches = cells.filter((r) => r.function === item.code);
    if (matches.length !== 1) { differences.push(`${item.code}: cella assente o duplicata`); continue; }
    const cell = matches[0];
    if (!Number.isSafeInteger(cell.amountCents) || cell.amountCents < 0) { differences.push(`${item.code}: importo non valido`); continue; }
    const actual = calculateRounded({operation: 'ratio', inputs: [String(cell.amountCents), '100000000000'], roundDigits: 2});
    if (actual !== item.amount) differences.push(`${item.code}: il rilascio corrente non coincide con l’edizione`);
    if (item.code === 'TOTAL') {
      const share = calculateRounded({operation: 'ratio', inputs: [String(cell.shareOfGdpHundredths), '100'], roundDigits: 1});
      if (share !== report.macro.shareGdpRounded) differences.push('TOTAL: quota di PIL revisionata');
    }
  }
  return differences;
}
