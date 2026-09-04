export type AuditClassification =
  | "official-control-result"
  | "reduced-competition"
  | "operational-delay"
  | "administrative-liability"
  | "hard-to-collect-credit"
  | "policy-review"
  | "policy-scenario";

export const auditClassifications: Record<
  AuditClassification,
  { label: string; plainMeaning: string }
> = {
  "official-control-result": {
    label: "Esiti di controlli",
    plainMeaning: "Importi comunicati da un'autorità dopo controlli o indagini. Non equivalgono sempre a una sentenza definitiva o a somme recuperate.",
  },
  "reduced-competition": {
    label: "Concorrenza ridotta",
    plainMeaning: "Procedure con meno confronto tra offerte. Il dato segnala dove approfondire, ma non dimostra da solo uno spreco o un illecito.",
  },
  "operational-delay": {
    label: "Ritardi e attuazione",
    plainMeaning: "Risorse, progetti o opere che richiedono più tempo del previsto. Un ritardo non significa automaticamente denaro perso.",
  },
  "administrative-liability": {
    label: "Debiti e passività",
    plainMeaning: "Obblighi di pagamento emersi o riconosciuti dalle amministrazioni. Le cause possono essere diverse e vanno lette caso per caso.",
  },
  "hard-to-collect-credit": {
    label: "Crediti difficili da riscuotere",
    plainMeaning: "Somme nominalmente dovute allo Stato, ma non tutte ancora esigibili o realisticamente recuperabili.",
  },
  "policy-review": {
    label: "Misure da valutare",
    plainMeaning: "Costi o minori entrate legati a scelte pubbliche. Valutarli non significa considerarli tutti inutili.",
  },
  "policy-scenario": {
    label: "Ipotesi di miglioramento",
    plainMeaning: "Calcoli basati su assunzioni dichiarate. Non sono risparmi già disponibili e non sono previsioni ufficiali.",
  },
};

export type AuditSignal = {
  id: string;
  area: string;
  value: number;
  valueQualifier?: "over" | "about";
  unit: "percent" | "billion-euro" | "million-euro" | "count";
  label: string;
  classification: Exclude<AuditClassification, "policy-scenario">;
  plainMeaning: string;
  caveat: string;
  coverage: string;
  evidenceStatus: string;
  referenceDate: string;
  tone: "observed" | "attention" | "policy" | "stock";
  valueClass: "observed-value" | "estimated-effect" | "risk-exposure" | "nominal-stock";
  additive: false;
  verificationUse: "screening-only";
  source: {
    institution: string;
    title: string;
    url: string;
    documentType: "official-report";
  };
};

export const auditReviewedAt = "2026-08-20";

export const procurementReducedCompetition2025 = {
  directAwardsBillion: 15.702,
  negotiatedWithoutTenderBillion: 44.084,
  totalBillion: 59.786,
  byNumber: 76.2,
  byValue: 19.3,
} as const;

export const procurementServicesAndSupplies2025 = {
  directAwardShare: 95,
  directAwardShareQualifier: "quasi",
  replicatedDirectAwardShare: 93.00067,
  replicationObservedAt: "2026-08-20",
  thresholdBandLowerEuro: 135_000,
  thresholdBandUpperEuro: 140_000,
  thresholdBandCount2021: 1_549,
  thresholdBandCount2025: 13_879,
  meaning:
    "ANAC usa un perimetro specifico per servizi e forniture. Non è lo stesso denominatore della serie sulle procedure da 40.000 euro in su.",
  caveat:
    "La concentrazione vicino alla soglia indica cosa controllare. Non prova da sola un frazionamento o uno spreco.",
  sourceTitle: "Presentazione della Relazione annuale ANAC 2026",
  sourcePublishedAt: "2026-04-21",
  sourceUrl:
    "https://www.anticorruzione.it/documents/91439/393633199/Anac%2B-%2BPresentazione%2Bdella%2BRelazione%2Bannuale%2B2026%2Bsu%2Battivit%C3%A0%2B2025.pdf/a35c6b4a-db50-13be-8d6f-7fba8fa4d4dd?t=1776760814307",
  replicationUrl:
    "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/blob/main/docs/research/ANAC_2025_REPLICATION.md",
} as const;

const auditSignalsWithoutComparableProcurement: AuditSignal[] = [
  {
    id: "gdf-public-spending-fraud",
    area: "Controlli sulla spesa",
    value: 1.6,
    valueQualifier: "over",
    unit: "billion-euro",
    label: "Frodi accertate nei controlli GdF",
    classification: "official-control-result",
    plainMeaning: "La Guardia di finanza comunica oltre 1,6 miliardi di frodi accertate dai reparti a danno del bilancio nazionale e dell'Unione europea.",
    caveat: "Sono esiti di controlli e indagini. Non indicano da soli condanne definitive o somme già recuperate.",
    coverage: "Italia, controlli svolti dal 1 gennaio 2025 al 31 maggio 2026",
    evidenceStatus: "Risultati comunicati dalla Guardia di finanza",
    referenceDate: "2026-05-31",
    tone: "attention",
    valueClass: "observed-value",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "Guardia di finanza",
      title: "Bilancio operativo dal 1 gennaio 2025 al 31 maggio 2026",
      url: "https://www.gdf.gov.it/it/gdf-comunica/notizie-ed-eventi/eventi/anno-2026/252deg-anniversario-della-fondazione-della-guardia-di-finanza/comunicati-stampa/252deg-anniversario-della-fondazione-della-guardia-di-finanza",
      documentType: "official-report",
    },
  },
  {
    id: "procurement-low-competition-value",
    area: "Appalti",
    value: procurementReducedCompetition2025.totalBillion,
    unit: "billion-euro",
    label: "Contratti con confronto competitivo ridotto",
    classification: "reduced-competition",
    plainMeaning: `Nel 2025 affidamenti diretti e negoziate senza bando rappresentano il ${procurementReducedCompetition2025.byNumber.toLocaleString("it-IT")}% delle procedure e il ${procurementReducedCompetition2025.byValue.toLocaleString("it-IT")}% del valore sopra 40.000 euro.`,
    caveat: "È spesa da controllare meglio, non una perdita già accertata.",
    coverage: "Procedure pubbliche da 40.000 euro in su, anno 2025",
    evidenceStatus: "Somma ANAC di 15,702 miliardi di affidamenti diretti e 44,084 miliardi di negoziate senza bando",
    referenceDate: "2025",
    tone: "attention",
    valueClass: "risk-exposure",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "ANAC",
      title: "Relazione annuale 2026 sull'attività svolta nel 2025",
      url: "https://www.anticorruzione.it/documents/91439/393633199/Anac%2B-%2BRelazione%2Bannuale%2B2026%2Bsu%2Battivit%C3%A0%2B2025.pdf/165c4f77-a913-1fde-ff23-887cbcee3095?t=1776845818213",
      documentType: "official-report",
    },
  },
  {
    id: "pnrr-beyond-2026",
    area: "PNRR",
    value: 24.2,
    unit: "billion-euro",
    label: "Risorse previste oltre il 2026",
    classification: "operational-delay",
    plainMeaning: "Una parte del Piano ha una coda di spesa successiva alla scadenza originaria.",
    caveat: "È un rischio di ritardo, non denaro perso.",
    coverage: "Misure PNRR con spesa prevista dopo il 2026",
    evidenceStatus: "Previsione temporale rilevata dalla Corte dei conti",
    referenceDate: "2026-02",
    tone: "attention",
    valueClass: "risk-exposure",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "Corte dei conti",
      title: "Relazione sullo stato di attuazione del PNRR - maggio 2026",
      url: "https://www.corteconti.it/HOME/StampaMedia/ComunicatiStampa/DettaglioComunicati?Id=0a3d0038-093b-4197-918f-d98b87cd9158",
      documentType: "official-report",
    },
  },
  {
    id: "tax-expenditures",
    area: "Agevolazioni fiscali",
    value: 108.5827,
    unit: "billion-euro",
    label: "Effetto stimato delle agevolazioni fiscali",
    classification: "policy-review",
    plainMeaning: "Il MEF censisce 575 misure. Nel 2025 ne risultano vigenti 515 e 297 hanno una stima puntuale di 108,6 miliardi.",
    caveat: "Sono scelte di politica fiscale: non sono tutte sprechi e non sono tutte eliminabili.",
    coverage: "575 misure censite, 515 vigenti nel 2025, 297 con stima puntuale",
    evidenceStatus: "Stima del Ministero dell'Economia e delle Finanze",
    referenceDate: "2025",
    tone: "policy",
    valueClass: "estimated-effect",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "Ministero dell'Economia e delle Finanze",
      title: "Rapporto annuale sulle spese fiscali 2024",
      url: "https://www.mef.gov.it/export/sites/MEF/documenti-allegati/2024/RSF-2024.pdf",
      documentType: "official-report",
    },
  },
  {
    id: "superbonus-accrued-deductions",
    area: "Superbonus",
    value: 131.97,
    unit: "billion-euro",
    label: "Detrazioni maturate",
    classification: "policy-review",
    plainMeaning: "Il dato misura le detrazioni maturate per gli interventi ammessi al Superbonus fino al 30 aprile 2026.",
    caveat: "È un costo fiscale cumulato. Non è una somma recuperabile e non va sommato alle spese fiscali senza verificare le sovrapposizioni.",
    coverage: "Interventi ammessi al Superbonus, dato cumulato nazionale",
    evidenceStatus: "Monitoraggio mensile ENEA",
    referenceDate: "2026-04-30",
    tone: "policy",
    valueClass: "estimated-effect",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "ENEA",
      title: "Risultati nazionali del Superbonus al 30 aprile 2026",
      url: "https://www.efficienzaenergetica.enea.it/detrazioni-fiscali/superbonus/risultati-superbonus.html",
      documentType: "official-report",
    },
  },
  {
    id: "off-budget-debt",
    area: "Comuni",
    value: 945.749,
    unit: "million-euro",
    label: "Debiti fuori bilancio rilevati",
    classification: "administrative-liability",
    plainMeaning: "L'indagine riguarda 7.106 Comuni e fotografa posizioni contabili diverse nel 2023.",
    caveat: "Circa 250,5 milioni derivano da acquisti senza un impegno contabile preventivo.",
    coverage: "7.106 Comuni, esercizio 2023",
    evidenceStatus: "Passività rilevate dalla Corte dei conti",
    referenceDate: "2023",
    tone: "attention",
    valueClass: "observed-value",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "Corte dei conti, archivio del Senato",
      title: "Gestione finanziaria degli enti locali - Del. 14/SEZAUT/2025/FRG",
      url: "https://www.senato.it/service/PDF/PDFServer/DF/444237.pdf",
      documentType: "official-report",
    },
  },
  {
    id: "healthcare-external-staff",
    area: "Sanità",
    value: 457.5,
    unit: "million-euro",
    label: "Servizi esterni di personale sanitario",
    classification: "policy-review",
    plainMeaning: "Nel 2024 la spesa rilevata da ANAC per servizi esterni di personale medico e infermieristico è stata di 457,5 milioni.",
    caveat: "Il ricorso a personale esterno può essere necessario. Il dato segnala una dipendenza da valutare, non uno spreco automatico.",
    coverage: "Affidamenti per servizi di personale medico e infermieristico analizzati da ANAC",
    evidenceStatus: "Analisi della domanda pubblica ANAC",
    referenceDate: "2024",
    tone: "attention",
    valueClass: "observed-value",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "ANAC",
      title: "Servizi di fornitura di personale medico ed infermieristico",
      url: "https://www.anticorruzione.it/-/servizi-di-fornitura-di-personale-medico-ed-infermieristico-analisi-della-domanda-febbraio-2024",
      documentType: "official-report",
    },
  },
  {
    id: "collection-stock",
    area: "Riscossione",
    value: 1272.9,
    unit: "billion-euro",
    label: "Carichi affidati alla riscossione",
    classification: "hard-to-collect-credit",
    plainMeaning: "È il valore nominale accumulato dei carichi ancora presenti al 31 gennaio 2025.",
    caveat: "Gran parte non è realisticamente recuperabile: non è un tesoretto disponibile.",
    coverage: "Stock residuo nazionale al 31 gennaio 2025",
    evidenceStatus: "Stock nominale comunicato dall'Agenzia delle entrate-Riscossione",
    referenceDate: "2025-01-31",
    tone: "stock",
    valueClass: "nominal-stock",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "Agenzia delle entrate-Riscossione",
      title: "Audizione del Direttore - 27 marzo 2025",
      url: "https://www.agenziaentrateriscossione.gov.it/export/.files/it/Audizione-VI-COMM.-SENATO_27-marzo-2025.pdf",
      documentType: "official-report",
    },
  },
];

export type ProcurementComparison = {
  year: 2023 | 2024 | 2025;
  subject: string;
  byNumber: number;
  byValue: number;
  procedureCount: number;
  totalValueBillion: number;
  plainMeaning: string;
  caveat: string;
  sourcePublishedAt: string;
  sourceTitle: string;
  sourceUrl: string;
};

export const procurementComparisons: Record<ProcurementComparison["year"], ProcurementComparison> = {
  2023: {
    year: 2023,
    subject: "Affidamenti diretti",
    byNumber: 49.6,
    byValue: 6.5,
    procedureCount: 267_403,
    totalValueBillion: 283.37835211,
    plainMeaning: "La quota è calcolata sulle procedure da 40.000 euro in su.",
    caveat: "Il numero delle procedure e il loro valore raccontano due aspetti diversi.",
    sourcePublishedAt: "2024-05-14",
    sourceTitle: "Relazione annuale 2024 sull'attività svolta nel 2023",
    sourceUrl: "https://www.anticorruzione.it/documents/91439/226947274/Anac+-+Relazione+annuale+2024+su+attivit%C3%A0+2023.pdf/59fa6b9e-670d-9910-54e7-88071d5274cc?t=1715693924497",
  },
  2024: {
    year: 2024,
    subject: "Affidamenti diretti",
    byNumber: 54.3,
    byValue: 6.1,
    procedureCount: 267_157,
    totalValueBillion: 271.849043161,
    plainMeaning: "La quota è calcolata sulle procedure da 40.000 euro in su.",
    caveat: "Il numero delle procedure e il loro valore raccontano due aspetti diversi.",
    sourcePublishedAt: "2025-05-20",
    sourceTitle: "Relazione annuale 2025 sull'attività svolta nel 2024",
    sourceUrl: "https://www.anticorruzione.it/documents/91439/307867242/Anac%2B-%2BRelazione%2Bannuale%2B2025%2Bsu%2Battivit%C3%A0%2B2024.pdf/f5053514-6745-8516-c8df-5bb0e4b2dfbd?t=1747731265787",
  },
  2025: {
    year: 2025,
    subject: "Affidamenti diretti",
    byNumber: 55.3,
    byValue: 5.1,
    procedureCount: 287_421,
    totalValueBillion: 309.732573064,
    plainMeaning: "La quota è calcolata sulle procedure da 40.000 euro in su.",
    caveat: "Il numero delle procedure e il loro valore raccontano due aspetti diversi.",
    sourcePublishedAt: "2026-04-21",
    sourceTitle: "Relazione annuale 2026 sull'attività svolta nel 2025",
    sourceUrl: "https://www.anticorruzione.it/documents/91439/393633199/Anac%2B-%2BRelazione%2Bannuale%2B2026%2Bsu%2Battivit%C3%A0%2B2025.pdf/165c4f77-a913-1fde-ff23-887cbcee3095?t=1776845818213",
  },
};

const procurementDirectAwardSignals: AuditSignal[] = Object.values(procurementComparisons).map(
  (comparison) => ({
    id: `procurement-direct-awards-${comparison.year}`,
    area: "Appalti",
    value: comparison.byNumber,
    unit: "percent",
    label: "Affidamenti diretti sul numero delle procedure",
    classification: "reduced-competition",
    plainMeaning: `Nel ${comparison.year} erano affidamenti diretti il ${comparison.byNumber.toFixed(1).replace(".", ",")}% delle procedure da 40.000 euro in su.`,
    caveat: `Sul valore totale pesavano il ${comparison.byValue.toFixed(1).replace(".", ",")}%. È un dato da approfondire, non una prova di spreco.`,
    coverage: `Procedure pubbliche da 40.000 euro in su, anno ${comparison.year}`,
    evidenceStatus: "Dato aggregato ANAC",
    referenceDate: String(comparison.year),
    tone: "attention",
    valueClass: "risk-exposure",
    additive: false,
    verificationUse: "screening-only",
    source: {
      institution: "ANAC",
      title: comparison.sourceTitle,
      url: comparison.sourceUrl,
      documentType: "official-report",
    },
  }),
);

export const auditSignals: AuditSignal[] = [
  ...procurementDirectAwardSignals,
  ...auditSignalsWithoutComparableProcurement,
];

/**
 * Small, deliberately heterogeneous set used by the home-page signal rail.
 * Keep this list to one verified signal per phenomenon: the cards must not
 * turn the three views of one ANAC series into three apparent anomalies.
 */
export const homeAnomalySignalIds = [
  "procurement-direct-awards-2025",
  "gdf-public-spending-fraud",
  "pnrr-beyond-2026",
] as const;

export function getHomeAnomalySignals(
  signals: readonly AuditSignal[] = auditSignals,
): AuditSignal[] {
  return homeAnomalySignalIds.flatMap((id) => {
    const signal = signals.find((candidate) => candidate.id === id);
    return signal ? [signal] : [];
  });
}

export const procurementComparison = procurementComparisons[2025];

export const availableAuditYears = [...new Set(
  auditSignals.map((signal) => Number.parseInt(signal.referenceDate.slice(0, 4), 10)),
)].sort((left, right) => right - left);

export function getAuditSignalsForYear(year: number): AuditSignal[] {
  return auditSignals.filter((signal) => signal.referenceDate.startsWith(String(year)));
}

export function getProcurementComparisonForYear(year: number): ProcurementComparison | null {
  return year === 2023 || year === 2024 || year === 2025 ? procurementComparisons[year] : null;
}

export type ProcurementComparisonDisplay = {
  requestedYear: number;
  comparison: ProcurementComparison;
  usedLatestAvailable: boolean;
};

/**
 * Resolve the ANAC comparison used by a compact summary card.
 *
 * The strict year lookup above remains nullable for API consumers: an absent
 * annual report must stay absent. A visual summary can instead show the most
 * recent verified report, provided it carries the report year so the reader
 * cannot mistake it for data from the selected period.
 */
export function getProcurementComparisonForDisplay(year: number): ProcurementComparisonDisplay {
  const comparison = getProcurementComparisonForYear(year);
  if (comparison) {
    return { requestedYear: year, comparison, usedLatestAvailable: false };
  }

  const latest = Object.values(procurementComparisons).reduce<ProcurementComparison | null>(
    (current, candidate) => (current === null || candidate.year > current.year ? candidate : current),
    null,
  );
  if (!latest) throw new Error("Nessun confronto ANAC verificato disponibile.");
  return { requestedYear: year, comparison: latest, usedLatestAvailable: true };
}

export function parseAuditYearQuery(
  rawYear: string | null,
  currentYear = new Date().getUTCFullYear(),
): number | null {
  if (rawYear === null || rawYear === "") return null;
  if (!/^\d{4}$/.test(rawYear)) throw new Error("L'anno richiesto non è valido.");
  const year = Number.parseInt(rawYear, 10);
  if (year < 2000 || year > currentYear) throw new Error("L'anno richiesto non è valido.");
  return year;
}

export function getProcurementAvailability(year: number) {
  const comparison = getProcurementComparisonForYear(year);
  if (comparison) {
    return {
      status: "available" as const,
      message: `La relazione ANAC per il ${year} è disponibile e usa lo stesso perimetro della serie.`,
    };
  }
  if (year >= 2026) {
    return {
      status: "not-yet-published" as const,
      message: `La relazione ANAC completa sul ${year} non è ancora pubblicata. Non usiamo dati parziali come se fossero annuali.`,
    };
  }
  return {
    status: "not-collected" as const,
    message: `Il dato annuale ANAC per il ${year} non è ancora stato raccolto nella serie verificata.`,
  };
}

export const auditScenarioBasis = {
  modelVersion: "2026-06-24.1",
  reviewedAt: "2026-06-24",
  taxExpendituresBillion: 108.6,
  reducedCompetitionBillion: 59.7721,
  externalHealthcareStaffBillion: 0.568,
  purchasesWithoutPriorCommitmentBillion: 0.250546,
  sourceTitle: "Audit desk-based della spesa pubblica italiana, appendice dati",
  note: "Le basi appartengono al modello del dossier e restano separate dagli indicatori ufficiali aggiornati mostrati sopra.",
} as const;

export const auditScenarioAssumptions = {
  prudent: {
    label: "Prudente",
    procurementAuditedShare: 0.25,
    procurementEfficiencyRate: 0.02,
    taxReviewRate: 0.01,
    healthcareReductionRate: 0.05,
    debtPreventionRate: 0.1,
  },
  central: {
    label: "Centrale",
    procurementAuditedShare: 0.5,
    procurementEfficiencyRate: 0.025,
    taxReviewRate: 0.03,
    healthcareReductionRate: 0.1,
    debtPreventionRate: 0.2,
  },
  ambitious: {
    label: "Ambizioso",
    procurementAuditedShare: 1,
    procurementEfficiencyRate: 0.025,
    taxReviewRate: 0.05,
    healthcareReductionRate: 0.15,
    debtPreventionRate: 0.3,
  },
} as const;

type AuditScenarioId = keyof typeof auditScenarioAssumptions;

function roundScenarioBillion(value: number): number {
  return Number(value.toFixed(9));
}

function calculateAuditScenario(id: AuditScenarioId) {
  const assumptions = auditScenarioAssumptions[id];
  const components = {
    procurement: roundScenarioBillion(
      auditScenarioBasis.reducedCompetitionBillion
      * assumptions.procurementAuditedShare
      * assumptions.procurementEfficiencyRate,
    ),
    taxExpenditures: roundScenarioBillion(
      auditScenarioBasis.taxExpendituresBillion * assumptions.taxReviewRate,
    ),
    healthcare: roundScenarioBillion(
      auditScenarioBasis.externalHealthcareStaffBillion * assumptions.healthcareReductionRate,
    ),
    offBudgetDebt: roundScenarioBillion(
      auditScenarioBasis.purchasesWithoutPriorCommitmentBillion * assumptions.debtPreventionRate,
    ),
  };
  return {
    id,
    label: assumptions.label,
    annualBillion: roundScenarioBillion(
      Object.values(components).reduce((sum, value) => sum + value, 0),
    ),
    components,
  };
}

export const auditScenarios = (["prudent", "central", "ambitious"] as const).map(
  calculateAuditScenario,
);

const centralScenario = auditScenarios.find((scenario) => scenario.id === "central");
if (!centralScenario) throw new Error("Scenario centrale non disponibile");

export const centralScenarioBreakdown = [
  { label: "Revisione mirata delle agevolazioni fiscali", value: centralScenario.components.taxExpenditures, tone: "policy" },
  { label: "Più concorrenza e controlli negli appalti", value: centralScenario.components.procurement, tone: "attention" },
  { label: "Minore ricorso strutturale ai gettonisti", value: centralScenario.components.healthcare, tone: "observed" },
  { label: "Prevenzione di nuovi debiti fuori bilancio", value: centralScenario.components.offBudgetDebt, tone: "stock" },
] as const;

export const auditMethodology = {
  purpose:
    "Aiutare a scegliere quali dati controllare prima. Gli indicatori non stabiliscono da soli sprechi, illeciti o responsabilità.",
  aiUse: {
    allowed: [
      "confrontare valori omogenei nel tempo",
      "segnalare scostamenti e dati mancanti",
      "ordinare i casi da verificare",
      "spiegare il percorso fino alla fonte",
    ],
    prohibited: [
      "definire uno spreco senza una verifica documentale",
      "attribuire responsabilità a persone o enti",
      "sommare stock, flussi, stime e scenari",
      "nascondere anno, fonte o limiti del dato",
    ],
  },
  scenarioMeaning:
    "Gli scenari sono ipotesi di politica pubblica. Non sono risparmi già disponibili e non sono previsioni.",
  reviewedAt: auditReviewedAt,
} as const;
