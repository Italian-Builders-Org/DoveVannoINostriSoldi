export const MONTHLY_REPORT_SERIES = {
  routeBase: "/report",
  navigationLabel: "Report mensili",
  title: "Il mese dei soldi pubblici",
  byline: "Redazione DVNS",
  targetReadingMinutes: { min: 5, max: 7 },
  rubricOrder: [
    "numbers",
    "territories",
    "signal",
    "sources",
    "nextMonth",
  ],
  rubricTitles: {
    numbers: "Numeri da ricordare",
    territories: "Territori",
    signal: "Un segnale da capire",
    sources: "Fonti e limiti",
    nextMonth: "Il mese prossimo",
  },
} as const;

export type YearMonth = `${number}-${number}`;
export type LocalDate = `${number}-${number}-${number}`;

export type ReferencePeriod =
  | Readonly<{ kind: "date"; date: LocalDate }>
  | Readonly<{ kind: "month"; month: YearMonth; completeness: "complete" | "partial" }>
  | Readonly<{ kind: "year"; year: number; completeness: "complete" | "partial" }>
  | Readonly<{ kind: "range"; from: LocalDate; to: LocalDate; completeness: "complete" | "partial" }>
  | Readonly<{ kind: "as-of"; date: LocalDate }>;

export type ReportValue =
  | Readonly<{ kind: "count"; value: number; unit: string }>
  | Readonly<{ kind: "money"; cents: number; display: "exact" | "compact" }>
  | Readonly<{ kind: "percentage"; basisPoints: number }>
  | Readonly<{ kind: "ratio"; decimal: string; unit: string }>
  | Readonly<{ kind: "text"; text: string }>;

export type ReportEvidence = Readonly<{
  id: string;
  datasetId: string;
  publisher: string;
  title: string;
  publicUrl: `https://${string}`;
  checkedOn: LocalDate;
  referencePeriod: ReferencePeriod;
  perimeter: string;
  caveat: string;
  dataRevision: string;
  artifactSha256: string;
}>;

export type ReportFact = Readonly<{
  id: string;
  label: string;
  value: ReportValue;
  plainLanguage: string;
  referencePeriod: ReferencePeriod;
  perimeter: string;
  denominator: string | null;
  caveat: string;
  evidenceIds: readonly [string, ...string[]];
}>;

export type ReportParagraph = Readonly<{
  text: string;
  evidenceIds: readonly string[];
}>;

export type ReportSection = Readonly<{
  title: string;
  paragraphs: readonly [ReportParagraph, ...ReportParagraph[]];
}>;

export type ReportFigureSeries = Readonly<{
  id: string;
  label: string;
  format: ReportValue["kind"];
  tableOnly?: boolean;
}>;

export type ReportFigureRow = Readonly<{
  key: string;
  label: string;
  values: Readonly<Record<string, ReportValue>>;
}>;

export type ReportFigure = Readonly<{
  id: string;
  kind: "time-series" | "ranked-bars";
  title: string;
  takeaway: string;
  accessibleSummary: string;
  referencePeriod: ReferencePeriod;
  perimeter: string;
  denominator: string | null;
  caveat: string;
  evidenceIds: readonly [string, ...string[]];
  visualSeriesId: string;
  series: readonly [ReportFigureSeries, ...ReportFigureSeries[]];
  rows: readonly [ReportFigureRow, ...ReportFigureRow[]];
}>;

export type ReportRubrics = Readonly<{
  numbers: ReportSection;
  territories: ReportSection;
  signal: ReportSection;
  sources: ReportSection;
  nextMonth: ReportSection;
}>;

type MonthlyReportBody = Readonly<{
  issueMonth: YearMonth;
  title: string;
  dek: string;
  teaser: string;
  keywords: readonly string[];
  inBrief: readonly [string, string, string];
  lead: ReportSection;
  facts: readonly [ReportFact, ...ReportFact[]];
  rubrics: ReportRubrics;
  figures: readonly [ReportFigure, ReportFigure];
  evidence: readonly [ReportEvidence, ...ReportEvidence[]];
  reviewers: readonly string[];
}>;

export type PublishedMonthlyReport = MonthlyReportBody & Readonly<{
  status: "published";
  publication: Readonly<{
    publishedOn: LocalDate;
    dataCutoff: LocalDate;
  }>;
  contentRevision: number;
  corrections: readonly Readonly<{
    publishedOn: LocalDate;
    explanation: string;
  }>[];
}>;

export type MonthlyReportDraft = MonthlyReportBody & Readonly<{
  status: "draft";
  publication: Readonly<{
    targetPublishedOn: LocalDate;
    dataCutoff: LocalDate;
  }>;
  draftNotes: readonly string[];
}>;

export type MonthlyReportSummary = Readonly<{
  issueMonth: YearMonth;
  issueLabel: string;
  href: `/report/${string}`;
  title: string;
  dek: string;
  teaser: string;
  keywords: readonly string[];
  publishedOn: LocalDate;
  dataCutoff: LocalDate;
  readingMinutes: number;
}>;

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const LOCAL_DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const SHA_40 = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const RUBRIC_KEYS = [...MONTHLY_REPORT_SERIES.rubricOrder].sort();

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Report mensile non valido: ${message}`);
}

function isSemanticDate(value: string): value is LocalDate {
  if (!LOCAL_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function validateReferencePeriod(period: ReferencePeriod, owner: string): void {
  if (period.kind === "date" || period.kind === "as-of") {
    invariant(isSemanticDate(period.date), `${owner}: data di riferimento non valida`);
    return;
  }
  if (period.kind === "month") {
    invariant(YEAR_MONTH.test(period.month), `${owner}: mese di riferimento non valido`);
    return;
  }
  if (period.kind === "year") {
    invariant(Number.isInteger(period.year) && period.year >= 1900 && period.year <= 2200, `${owner}: anno non valido`);
    return;
  }
  invariant(isSemanticDate(period.from) && isSemanticDate(period.to), `${owner}: intervallo non valido`);
  invariant(period.from <= period.to, `${owner}: intervallo invertito`);
}

function validateValue(value: ReportValue, owner: string): void {
  if (value.kind === "count") {
    invariant(Number.isSafeInteger(value.value), `${owner}: conteggio non intero sicuro`);
    invariant(value.unit.trim().length > 0, `${owner}: unità del conteggio assente`);
    return;
  }
  if (value.kind === "money") {
    invariant(Number.isSafeInteger(value.cents), `${owner}: importo non espresso in centesimi sicuri`);
    return;
  }
  if (value.kind === "percentage") {
    invariant(Number.isSafeInteger(value.basisPoints), `${owner}: percentuale non espressa in punti base`);
    return;
  }
  if (value.kind === "ratio") {
    invariant(/^-?\d+(?:\.\d+)?$/.test(value.decimal), `${owner}: rapporto decimale non valido`);
    invariant(value.unit.trim().length > 0, `${owner}: unità del rapporto assente`);
    return;
  }
  invariant(value.text.trim().length > 0, `${owner}: valore testuale assente`);
}

function validateEvidenceIds(ids: readonly string[], known: Set<string>, owner: string): void {
  invariant(ids.length > 0, `${owner}: fonte assente`);
  invariant(new Set(ids).size === ids.length, `${owner}: fonti duplicate`);
  for (const id of ids) invariant(known.has(id), `${owner}: fonte sconosciuta ${id}`);
}

function validateParagraphs(section: ReportSection, evidenceIds: Set<string>, owner: string): void {
  invariant(section.title.trim().length > 0, `${owner}: titolo assente`);
  invariant(section.paragraphs.length > 0, `${owner}: testo assente`);
  for (const [index, paragraph] of section.paragraphs.entries()) {
    invariant(paragraph.text.trim().length > 0, `${owner}.${index}: paragrafo vuoto`);
    if (/\d/.test(paragraph.text)) {
      invariant(paragraph.evidenceIds.length > 0, `${owner}.${index}: affermazione numerica senza fonte`);
    }
    for (const id of paragraph.evidenceIds) {
      invariant(evidenceIds.has(id), `${owner}.${index}: fonte sconosciuta ${id}`);
    }
  }
}

function editorialText(report: PublishedMonthlyReport): string {
  return [
    report.title,
    report.dek,
    report.teaser,
    ...report.lead.paragraphs.map((paragraph) => paragraph.text),
    ...MONTHLY_REPORT_SERIES.rubricOrder.flatMap((key) =>
      report.rubrics[key].paragraphs.map((paragraph) => paragraph.text)),
    ...report.facts.flatMap((fact) => [fact.label, fact.plainLanguage, fact.caveat]),
    ...report.figures.flatMap((figure) => [figure.title, figure.takeaway, figure.accessibleSummary, figure.caveat]),
  ].join(" ");
}

export function monthlyReportWordCount(report: PublishedMonthlyReport): number {
  return editorialText(report).trim().split(/\s+/u).filter(Boolean).length;
}

export function monthlyReportReadingMinutes(report: PublishedMonthlyReport): number {
  return Math.max(1, Math.ceil(monthlyReportWordCount(report) / 200));
}

export function issueMonthLabel(issueMonth: YearMonth): string {
  invariant(YEAR_MONTH.test(issueMonth), "mese dell'edizione non valido");
  const [year, month] = issueMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year!, month! - 1, 1)));
}

export function validatePublishedMonthlyReport(report: PublishedMonthlyReport): PublishedMonthlyReport {
  invariant(report.status === "published", `${report.issueMonth}: stato non pubblicato`);
  invariant(YEAR_MONTH.test(report.issueMonth), "mese dell'edizione non valido");
  invariant(report.title.trim().length > 0 && report.dek.trim().length > 0 && report.teaser.trim().length > 0, `${report.issueMonth}: intestazione incompleta`);
  invariant(isSemanticDate(report.publication.publishedOn), `${report.issueMonth}: data di pubblicazione non valida`);
  invariant(isSemanticDate(report.publication.dataCutoff), `${report.issueMonth}: cutoff non valido`);
  invariant(report.publication.dataCutoff <= report.publication.publishedOn, `${report.issueMonth}: cutoff successivo alla pubblicazione`);
  invariant(report.publication.publishedOn.slice(0, 7) > report.issueMonth, `${report.issueMonth}: pubblicazione non successiva al mese raccontato`);
  invariant(Number.isInteger(report.contentRevision) && report.contentRevision >= 1, `${report.issueMonth}: revisione non valida`);
  invariant(report.figures.length === 2, `${report.issueMonth}: servono esattamente due visualizzazioni`);
  invariant(report.inBrief.length === 3, `${report.issueMonth}: servono esattamente tre fatti in breve`);

  const evidenceIds = new Set<string>();
  for (const evidence of report.evidence) {
    invariant(evidence.id.trim().length > 0 && !evidenceIds.has(evidence.id), `${report.issueMonth}: prova duplicata o senza ID`);
    evidenceIds.add(evidence.id);
    invariant(evidence.datasetId.trim().length > 0, `${evidence.id}: dataset assente`);
    invariant(evidence.publisher.trim().length > 0 && evidence.title.trim().length > 0, `${evidence.id}: identità della fonte incompleta`);
    invariant(evidence.publicUrl.startsWith("https://"), `${evidence.id}: URL pubblico non HTTPS`);
    invariant(isSemanticDate(evidence.checkedOn), `${evidence.id}: data di verifica non valida`);
    invariant(evidence.checkedOn <= report.publication.dataCutoff, `${evidence.id}: verificata dopo il cutoff`);
    invariant(evidence.perimeter.trim().length > 0 && evidence.caveat.trim().length > 0, `${evidence.id}: perimetro o caveat assente`);
    invariant(SHA_40.test(evidence.dataRevision), `${evidence.id}: revisione dati non valida`);
    invariant(SHA_256.test(evidence.artifactSha256), `${evidence.id}: hash artefatto non valido`);
    validateReferencePeriod(evidence.referencePeriod, evidence.id);
  }

  const factIds = new Set<string>();
  for (const fact of report.facts) {
    invariant(fact.id.trim().length > 0 && !factIds.has(fact.id), `${report.issueMonth}: fatto duplicato o senza ID`);
    factIds.add(fact.id);
    invariant(fact.label.trim().length > 0 && fact.plainLanguage.trim().length > 0, `${fact.id}: testo incompleto`);
    invariant(fact.perimeter.trim().length > 0 && fact.caveat.trim().length > 0, `${fact.id}: perimetro o caveat assente`);
    if (fact.value.kind === "percentage" || fact.value.kind === "ratio") {
      invariant(Boolean(fact.denominator?.trim()), `${fact.id}: denominatore obbligatorio`);
    }
    validateValue(fact.value, fact.id);
    validateReferencePeriod(fact.referencePeriod, fact.id);
    validateEvidenceIds(fact.evidenceIds, evidenceIds, fact.id);
  }
  invariant(new Set(report.inBrief).size === report.inBrief.length, `${report.issueMonth}: fatti in breve duplicati`);
  for (const id of report.inBrief) invariant(factIds.has(id), `${report.issueMonth}: fatto in breve sconosciuto ${id}`);

  const rubricKeys = Object.keys(report.rubrics).sort();
  invariant(JSON.stringify(rubricKeys) === JSON.stringify(RUBRIC_KEYS), `${report.issueMonth}: rubriche inattese`);
  validateParagraphs(report.lead, evidenceIds, `${report.issueMonth}.lead`);
  for (const key of MONTHLY_REPORT_SERIES.rubricOrder) {
    validateParagraphs(report.rubrics[key], evidenceIds, `${report.issueMonth}.${key}`);
  }

  const figureIds = new Set<string>();
  for (const figure of report.figures) {
    invariant(figure.id.trim().length > 0 && !figureIds.has(figure.id), `${report.issueMonth}: figura duplicata o senza ID`);
    figureIds.add(figure.id);
    invariant(figure.title.trim().length > 0 && figure.takeaway.trim().length > 0 && figure.accessibleSummary.trim().length > 0, `${figure.id}: testo incompleto`);
    invariant(figure.perimeter.trim().length > 0 && figure.caveat.trim().length > 0, `${figure.id}: perimetro o caveat assente`);
    validateReferencePeriod(figure.referencePeriod, figure.id);
    validateEvidenceIds(figure.evidenceIds, evidenceIds, figure.id);
    const seriesIds = new Set<string>();
    for (const series of figure.series) {
      invariant(series.id.trim().length > 0 && !seriesIds.has(series.id), `${figure.id}: serie duplicata o senza ID`);
      seriesIds.add(series.id);
      invariant(series.label.trim().length > 0, `${figure.id}.${series.id}: etichetta assente`);
    }
    invariant(seriesIds.has(figure.visualSeriesId), `${figure.id}: serie visuale sconosciuta`);
    const rowKeys = new Set<string>();
    for (const row of figure.rows) {
      invariant(row.key.trim().length > 0 && !rowKeys.has(row.key), `${figure.id}: riga duplicata o senza chiave`);
      rowKeys.add(row.key);
      invariant(row.label.trim().length > 0, `${figure.id}.${row.key}: etichetta assente`);
      invariant(JSON.stringify(Object.keys(row.values).sort()) === JSON.stringify([...seriesIds].sort()), `${figure.id}.${row.key}: colonne divergenti dalla visualizzazione`);
      for (const [seriesId, value] of Object.entries(row.values)) {
        const series = figure.series.find((candidate) => candidate.id === seriesId)!;
        invariant(value.kind === series.format, `${figure.id}.${row.key}.${seriesId}: formato divergente`);
        validateValue(value, `${figure.id}.${row.key}.${seriesId}`);
      }
    }
    const visualSeries = figure.series.find((series) => series.id === figure.visualSeriesId)!;
    if (visualSeries.format === "percentage" || visualSeries.format === "ratio") {
      invariant(Boolean(figure.denominator?.trim()), `${figure.id}: denominatore obbligatorio`);
    }
  }

  for (const correction of report.corrections) {
    invariant(isSemanticDate(correction.publishedOn), `${report.issueMonth}: data correzione non valida`);
    invariant(correction.publishedOn >= report.publication.publishedOn, `${report.issueMonth}: correzione precedente alla pubblicazione`);
    invariant(correction.explanation.trim().length > 0, `${report.issueMonth}: spiegazione correzione assente`);
  }
  invariant(report.contentRevision === report.corrections.length + 1, `${report.issueMonth}: revisione e registro correzioni non coerenti`);

  const words = monthlyReportWordCount(report);
  const minutes = monthlyReportReadingMinutes(report);
  invariant(words >= 900 && words <= 1400, `${report.issueMonth}: lunghezza editoriale ${words}, attese 900-1400 parole`);
  invariant(minutes >= MONTHLY_REPORT_SERIES.targetReadingMinutes.min && minutes <= MONTHLY_REPORT_SERIES.targetReadingMinutes.max, `${report.issueMonth}: tempo di lettura fuori obiettivo`);
  return report;
}

export function monthlyReportSummary(report: PublishedMonthlyReport): MonthlyReportSummary {
  return {
    issueMonth: report.issueMonth,
    issueLabel: issueMonthLabel(report.issueMonth),
    href: `${MONTHLY_REPORT_SERIES.routeBase}/${report.issueMonth}`,
    title: report.title,
    dek: report.dek,
    teaser: report.teaser,
    keywords: report.keywords,
    publishedOn: report.publication.publishedOn,
    dataCutoff: report.publication.dataCutoff,
    readingMinutes: monthlyReportReadingMinutes(report),
  };
}
