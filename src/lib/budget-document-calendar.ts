export type BudgetDocumentStatus = "published" | "expected";

export type BudgetDocument = Readonly<{
  id: string;
  cycleYear: number;
  title: string;
  owner: string;
  description: string;
  referencePeriod: string;
  expectedWindow: string;
  expectedMonth: number;
  status: BudgetDocumentStatus;
  publishedOn: string | null;
  sourceUrl: string;
  observedAt: string;
}>;

export const BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT = "2026-09-03";
export const BUDGET_DOCUMENT_CALENDAR_YEAR = 2026;

const OFFICIAL_HOSTS = new Set([
  "openbdap.rgs.mef.gov.it",
  "www.bancaditalia.it",
  "www.corteconti.it",
  "www.inps.it",
  "www.istat.it",
  "www.mef.gov.it",
  "www.upbilancio.it",
]);

const calendar = [
  {
    id: "dfp-2026",
    cycleYear: 2026,
    title: "Documento di finanza pubblica 2026",
    owner: "Ministero dell’Economia e delle Finanze",
    description:
      "Rendiconta i progressi del Piano strutturale di bilancio e aggiorna il quadro tendenziale dei conti pubblici.",
    referencePeriod: "Consuntivo 2025 e previsioni dal 2026 al 2029",
    expectedWindow: "aprile",
    expectedMonth: 4,
    status: "published",
    publishedOn: "2026-04-22",
    sourceUrl: "https://openbdap.rgs.mef.gov.it/it/News/Index/611",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "upb-validazione-dfp-2026",
    cycleYear: 2026,
    title: "Validazione UPB del quadro macroeconomico DFP",
    owner: "Ufficio parlamentare di bilancio",
    description:
      "Comunica l’esito della validazione indipendente del quadro macroeconomico tendenziale elaborato dal MEF.",
    referencePeriod: "Scenario tendenziale DFP 2026",
    expectedWindow: "aprile",
    expectedMonth: 4,
    status: "published",
    publishedOn: "2026-04-23",
    sourceUrl:
      "https://www.upbilancio.it/it/lupb-comunica-la-validazione-dello-scenario-macroeconomico-tendenziale-del-documento-di-finanza-pubblica-2026/",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "istat-rapporto-annuale-2026",
    cycleYear: 2026,
    title: "Rapporto annuale 2026 · La situazione del Paese",
    owner: "Istituto nazionale di statistica",
    description:
      "Offre il quadro annuale integrato delle trasformazioni economiche, demografiche e sociali del Paese.",
    referencePeriod: "Prevalentemente anno 2025",
    expectedWindow: "maggio",
    expectedMonth: 5,
    status: "published",
    publishedOn: "2026-05-21",
    sourceUrl:
      "https://www.istat.it/produzione-editoriale/rapporto-annuale-2026-la-situazione-del-paese/",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "banca-italia-relazione-2025",
    cycleYear: 2026,
    title: "Relazione annuale sul 2025",
    owner: "Banca d’Italia",
    description:
      "Analizza l’economia italiana e internazionale e pubblica separatamente appendice e dati dei grafici.",
    referencePeriod: "Anno 2025 e primi mesi del 2026",
    expectedWindow: "fine maggio",
    expectedMonth: 5,
    status: "published",
    publishedOn: "2026-05-29",
    sourceUrl: "https://www.bancaditalia.it/pubblicazioni/relazione-annuale/2025/",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "corte-conti-parificazione-2025",
    cycleYear: 2026,
    title: "Parificazione del Rendiconto generale dello Stato 2025",
    owner: "Corte dei conti",
    description:
      "Rende disponibili il giudizio e la relazione sul rendiconto dell’esercizio finanziario precedente.",
    referencePeriod: "Esercizio finanziario 2025",
    expectedWindow: "tra maggio e giugno",
    expectedMonth: 6,
    status: "published",
    publishedOn: "2026-06-24",
    sourceUrl:
      "https://www.corteconti.it/HOME/Documenti/DettaglioDocumenti?Id=87f8ccfd-da87-4455-9c00-9772ae41eb92",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "inps-rapporto-annuale-2026",
    cycleYear: 2026,
    title: "XXV Rapporto annuale INPS",
    owner: "Istituto nazionale della previdenza sociale",
    description:
      "Descrive le dinamiche del sistema di protezione sociale, del lavoro e delle prestazioni gestite dall’Istituto.",
    referencePeriod: "Prevalentemente anno 2025",
    expectedWindow: "luglio",
    expectedMonth: 7,
    status: "published",
    publishedOn: "2026-07-09",
    sourceUrl:
      "https://www.inps.it/it/it/dati-e-bilanci/rapporti-annuali/xxv-rapporto-annuale.html",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "dpfp-2026",
    cycleYear: 2026,
    title: "Documento programmatico di finanza pubblica 2026",
    owner: "Ministero dell’Economia e delle Finanze",
    description:
      "Aggiornerà il quadro programmatico prima della manovra. Ha sostituito e potenziato la precedente NADEF.",
    referencePeriod: "Ciclo di bilancio dal 2027 al 2029",
    expectedWindow: "tra settembre e ottobre",
    expectedMonth: 9,
    status: "expected",
    publishedOn: null,
    sourceUrl: "https://www.mef.gov.it/documenti-pubblicazioni/doc-finanza-pubblica/index.html",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
  {
    id: "ddl-bilancio-2027",
    cycleYear: 2026,
    title: "Disegno di legge di bilancio 2027",
    owner: "Ministero dell’Economia e delle Finanze · Parlamento",
    description:
      "Avvia l’esame parlamentare della manovra e del bilancio pluriennale; il testo può cambiare durante l’iter.",
    referencePeriod: "Bilancio 2027 e triennio di previsione",
    expectedWindow: "ottobre",
    expectedMonth: 10,
    status: "expected",
    publishedOn: null,
    sourceUrl: "https://openbdap.rgs.mef.gov.it/Bds/Analizza",
    observedAt: BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  },
] as const satisfies readonly BudgetDocument[];

function isoDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Calendario documenti: ${field} non è una data ISO valida`);
  }
}

export function assertBudgetDocumentCalendar(documents: readonly BudgetDocument[]): void {
  if (documents.length === 0) throw new Error("Calendario documenti: elenco vuoto");

  const ids = new Set<string>();
  let previousMonth = 0;

  for (const document of documents) {
    for (const [field, value] of [
      ["id", document.id],
      ["title", document.title],
      ["owner", document.owner],
      ["description", document.description],
      ["referencePeriod", document.referencePeriod],
      ["expectedWindow", document.expectedWindow],
      ["sourceUrl", document.sourceUrl],
    ] as const) {
      if (value.trim().length === 0) {
        throw new Error(`Calendario documenti: ${document.id || "record"}.${field} vuoto`);
      }
    }

    if (ids.has(document.id)) throw new Error(`Calendario documenti: id duplicato ${document.id}`);
    ids.add(document.id);

    if (document.cycleYear !== BUDGET_DOCUMENT_CALENDAR_YEAR) {
      throw new Error(`Calendario documenti: anno inatteso per ${document.id}`);
    }
    if (document.expectedMonth < 1 || document.expectedMonth > 12) {
      throw new Error(`Calendario documenti: mese inatteso per ${document.id}`);
    }
    if (document.expectedMonth < previousMonth) {
      throw new Error("Calendario documenti: ordine temporale non valido");
    }
    previousMonth = document.expectedMonth;

    isoDate(document.observedAt, `${document.id}.observedAt`);
    if (document.observedAt !== BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT) {
      throw new Error(`Calendario documenti: observedAt divergente per ${document.id}`);
    }

    if (document.status !== "published" && document.status !== "expected") {
      throw new Error(`Calendario documenti: stato inatteso per ${document.id}`);
    }
    if (document.status === "published") {
      if (!document.publishedOn) {
        throw new Error(`Calendario documenti: data di pubblicazione assente per ${document.id}`);
      }
      isoDate(document.publishedOn, `${document.id}.publishedOn`);
      if (document.publishedOn > document.observedAt) {
        throw new Error(`Calendario documenti: pubblicazione successiva al controllo per ${document.id}`);
      }
    } else if (document.publishedOn !== null) {
      throw new Error(`Calendario documenti: data inventata per documento atteso ${document.id}`);
    }

    const url = new URL(document.sourceUrl);
    if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname)) {
      throw new Error(`Calendario documenti: fonte non ufficiale per ${document.id}`);
    }
  }
}

assertBudgetDocumentCalendar(calendar);

export const budgetDocumentCalendar: readonly BudgetDocument[] = calendar;
