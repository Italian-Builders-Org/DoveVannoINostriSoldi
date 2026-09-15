import { calculateRounded } from './decimal.mjs';

export type ReaderMetric = { value: string; unit: string; sourceId: string; label: string };
export type ReaderCalculation = { id: string; operation: string; inputs: string[]; expected: string; digits: number; label: string; unit: string };
export type ReaderChart = { title: string; unit: string; rows: { label: string; metric: string }[]; note: string };
export type ReaderCase = {
  id: string; sector: string; kind: string; title: string; number: string; numberLabel: string;
  period: string; lead: string; paragraphs: string[]; conclusion: string; improve: string; sourceIds: string[];
  legacyId: string | null; chart: ReaderChart | null;
  math: { calculationIds: string[]; explanation: string; rows: { label: string; numerator: string; denominator: string; result: string }[] } | null;
};
export type ReaderSource = { id: string; publisher: string; title: string; url: string; locator: string; access: string; period: string; publishedOn: string | null; checkedOn: string; originalBytesSha256: string | null };
export type ReaderReport = {
  schemaVersion: number; revision: string; title: string; summary: string; route: string; pdfPath: string;
  publishedOn: string; modifiedOn: string; basePr: number; baseCommit: string;
  macro: { year: number; totalCents: string; gdpPercent: string; sourceId: string; snapshotSha256: string; note: string };
  lead: string; kindLabels: Record<string, string>;
  sectors: { code: string; label: string; amountCents: string; note: string; reading: string; caseIds: string[]; sourceIds: string[] }[];
  metrics: Record<string, ReaderMetric>; calculations: ReaderCalculation[]; cases: ReaderCase[]; sources: ReaderSource[];
  municipal: { title: string; paragraphs: string[]; charts: ReaderChart[]; sourceIds: string[] };
  method: string[]; glossary: { term: string; definition: string }[]; legacyEvidenceUrl: string;
  noNationalWasteTotal: boolean;
};
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY = ['affidamenti','tolentino','impianti','prepac','carceri','entrate','percentuali','personale','archivi','rti','date'];

function sumExact(values: string[], digits: number): string {
  const places = Math.max(...values.map(v => (v.split('.')[1] ?? '').length));
  const total = values.reduce((a, v) => {
    const sign = v.startsWith('-') ? -BigInt(1) : BigInt(1);
    const [whole, fraction = ''] = v.replace(/^-/, '').split('.');
    return a + sign * BigInt(whole + fraction.padEnd(places, '0'));
  }, BigInt(0));
  return calculateRounded({ operation: 'ratio', inputs: [String(total), String(BigInt(10) ** BigInt(places))], roundDigits: digits });
}
/** Resolve dependency-bound arithmetic, using exact decimal/rational calculations. */
export function readerValue(report: ReaderReport, id: string, stack: string[] = []): string {
  if (stack.includes(id)) throw new Error(`Ciclo nei calcoli: ${id}`);
  if (stack.length > 40) throw new Error('Catena di calcoli troppo lunga');
  const metric = report.metrics[id];
  if (metric) {
    if (!DECIMAL.test(metric.value)) throw new Error(`Valore non numerico: ${id}`);
    return metric.value;
  }
  const c = report.calculations.find(x => x.id === id);
  if (!c) throw new Error(`Metrica sconosciuta: ${id}`);
  if (!Number.isInteger(c.digits) || c.digits < 0 || c.digits > 8) throw new Error('Precisione non valida');
  const values = c.inputs.map(key => readerValue(report, key, [...stack, id]));
  if (c.operation === 'sum') {
    if (values.length < 2) throw new Error('Somma senza almeno due addendi');
    return sumExact(values, c.digits);
  }
  if (c.operation === 'reduction-percent') {
    if (values.length !== 2) throw new Error('Riduzione senza due valori');
    // -(actual / initial - 1) is the reduction. Negate the exact rounded result.
    const change = calculateRounded({operation: 'relative-change-percent', inputs: [values[1], values[0]], roundDigits: c.digits});
    return /^0(?:\.0+)?$/.test(change) ? change : change.startsWith('-') ? change.slice(1) : `-${change}`;
  }
  return calculateRounded({ operation: c.operation, inputs: values, roundDigits: c.digits });
}
export function readerNumber(value: string | number, digits = 2): string {
  return Number(value).toLocaleString('it-IT', {minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: 'always'});
}
export function readerBillions(cents: string): string {
  return readerNumber(calculateRounded({operation: 'ratio', inputs: [cents, '100000000000'], roundDigits: 2}), 2);
}
export function readerShare(cents: string, total: string): string {
  return calculateRounded({operation: 'ratio-percent', inputs: [cents, total], roundDigits: 2});
}
export function readerCalculationText(report: ReaderReport, c: ReaderCalculation): string {
  const v = c.inputs.map(key => readerValue(report, key));
  const f = v.map(x => readerNumber(x, x.includes('.') ? x.split('.')[1].length : 0));
  let expression: string;
  if (c.operation === 'sum') expression = f.join(' + ');
  else if (c.operation === 'difference') expression = `${f[0]} − ${f[1]}`;
  else if (c.operation === 'relative-change-percent') expression = `(${f[0]} − ${f[1]}) ÷ ${f[1]} × 100`;
  else if (c.operation === 'reduction-percent') expression = `(${f[0]} − ${f[1]}) ÷ ${f[0]} × 100`;
  else expression = `${f[0]} ÷ ${f[1]}${c.operation === 'ratio-percent' ? ' × 100' : ''}`;
  return `${expression} = ${readerNumber(readerValue(report, c.id), c.digits)} ${c.unit}`;
}
export function validateReader(report: ReaderReport): ReaderReport {
  if (report.schemaVersion !== 1 || report.route !== '/report/bilancio-stato-2025' || report.pdfPath !== '/report/bilancio-stato-2025.pdf') throw new Error('Identità o URL del report non validi');
  if (report.noNationalWasteTotal !== true) throw new Error('Totale degli sprechi non documentato');
  if (JSON.stringify(report).includes('\u2014')) throw new Error('Em dash nel contenuto');
  const ids = report.cases.map(x => x.id);
  const sourceIds = report.sources.map(x => x.id);
  const calcIds = report.calculations.map(x => x.id);
  for (const set of [ids, sourceIds, calcIds]) {
    if (new Set(set).size !== set.length || set.some(id => !SLUG.test(id))) throw new Error('Identificativo duplicato o non valido');
  }
  if (calcIds.some(id => id in report.metrics)) throw new Error('Collisione fra metrica e calcolo');
  const requiredSources = (refs: string[]) => { if (!refs.length || refs.some(id => !sourceIds.includes(id))) throw new Error('Fonte mancante'); };
  for (const source of report.sources) {
    const u = new URL(source.url);
    if (u.protocol !== 'https:' || u.username || u.password || !source.locator || !source.access) throw new Error('Provenienza non valida');
    if (source.publishedOn && source.publishedOn > report.modifiedOn) throw new Error('Fonte successiva al cutoff');
  }
  const codes = Array.from({length: 10}, (_,i) => `GF${String(i+1).padStart(2,'0')}`);
  if (report.sectors.length !== 10 || codes.some(code => report.sectors.filter(x => x.code === code).length !== 1)) throw new Error('Dieci funzioni richieste');
  if (!/^\d+$/.test(report.macro.totalCents) || BigInt(report.macro.totalCents) <= BigInt(0)) throw new Error('Totale non valido');
  let sum = BigInt(0);
  for (const sector of report.sectors) {
    if (!/^\d+$/.test(sector.amountCents)) throw new Error('Importo non intero');
    sum += BigInt(sector.amountCents);
    requiredSources(sector.sourceIds);
    if (sector.caseIds.some(id => !ids.includes(id) || report.cases.find(c => c.id === id)?.sector !== sector.code)) throw new Error('Caso associato al settore sbagliato');
  }
  if (sum !== BigInt(report.macro.totalCents)) throw new Error('Composizione non riconciliata');
  const visited = report.cases.map(c => c.legacyId).filter(Boolean);
  if (LEGACY.some(id => visited.filter(x => x === id).length !== 1)) throw new Error('Caso della prima analisi perso o duplicato');
  for (const [id, metric] of Object.entries(report.metrics)) {
    if (!SLUG.test(id) || !DECIMAL.test(metric.value) || !metric.unit || !metric.label) throw new Error('Metrica invalida');
    requiredSources([metric.sourceId]);
  }
  for (const c of report.calculations) {
    if (readerValue(report, c.id) !== c.expected) throw new Error(`Calcolo alterato: ${c.id}`);
  }
  const checkChart = (chart: ReaderChart) => {
    if (!chart.rows.length || !chart.title || !chart.unit || !chart.note) throw new Error('Grafico privo di contesto');
    chart.rows.forEach(row => { if (!row.label || Number(readerValue(report, row.metric)) < 0) throw new Error('Barra non valida'); });
  };
  for (const c of report.cases) {
    requiredSources(c.sourceIds);
    if (!codes.includes(c.sector) || !report.kindLabels[c.kind] || !c.period || !c.conclusion || !c.lead) throw new Error('Scheda incompleta');
    if (c.chart) checkChart(c.chart);
    if (c.math) {
      c.math.calculationIds.forEach(id => { if (!calcIds.includes(id)) throw new Error('Calcolo della scheda mancante'); });
      c.math.rows.forEach(row => { for (const key of [row.numerator,row.denominator,row.result]) readerValue(report,key); });
    }
  }
  requiredSources(report.municipal.sourceIds);
  report.municipal.charts.forEach(checkChart);
  return report;
}
export function validateReaderSnapshot(report: ReaderReport, observations: readonly {geo: string; year: number; function: string; amountCents: number; shareOfGdpHundredths: number}[]): void {
  const rows = observations.filter(row => row.geo === 'IT' && row.year === report.macro.year);
  const expected = [{code:'TOTAL',amountCents:report.macro.totalCents},...report.sectors];
  for (const item of expected) {
    const found = rows.filter(row => row.function === item.code);
    if (found.length !== 1 || !Number.isSafeInteger(found[0].amountCents) || String(found[0].amountCents) !== item.amountCents) throw new Error(`Snapshot diverso dal report: ${item.code}`);
  }
  const total = rows.find(row => row.function === 'TOTAL')!;
  if (String(total.shareOfGdpHundredths / 100) !== report.macro.gdpPercent) throw new Error('Quota PIL revisionata');
}
