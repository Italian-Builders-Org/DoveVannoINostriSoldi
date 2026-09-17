import {
  auditMethodology,
  auditScenarioAssumptions,
  auditScenarioBasis,
  auditScenarios,
  auditSignals,
  centralScenarioBreakdown,
  procurementComparisons,
  procurementServicesAndSupplies2025,
  type AuditSignal,
} from "@/lib/audit-data";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import { queryOpenCivitasSpendingOutliers } from "@/lib/opencivitas-outliers";
import { summarizeOpenCivitasQuadrants } from "@/lib/opencivitas-quadrants";
import { getPublicDebtView } from "@/lib/public-debt";
import { mefParticipationsSnapshot } from "@/lib/mef-participations-snapshot";
import { rgsConsultingSnapshot } from "@/lib/rgs-consulting-snapshot";
import { querySsnCce } from "@/lib/ssn-cce-snapshot";
import { getEditorialTopic } from "@/lib/integrated-editorial";
import opencoesioneOverview from "@/data/generated/opencoesione-overview.json";

export type SintesiKind = "osservazione" | "screening" | "ipotesi";

export type SintesiPathway = Readonly<{
  id: string;
  kind: SintesiKind;
  area: string;
  headline: string;
  observation: string;
  deepenHref: string;
  deepenLabel: string;
  action: string;
  sourceLabel: string;
  sourceUrl: string;
  period: string;
  limits: string;
}>;

export type AiChartBar = Readonly<{
  label: string;
  /** Relative weight for bar width (same unit within a chart). */
  value: number;
  display: string;
}>;

export type AiStewardshipMove = Readonly<{
  id: string;
  priority: number;
  title: string;
  /** Plain-language: what this is about. */
  concerns: string;
  /** One sentence a non-expert can quote: what the agent proposes to do. */
  proposal: string;
  /** How the agent would operate, still plain language. */
  operation: string;
  /** What would change for citizens / public accounts (orientation, not a guarantee). */
  effect: string;
  why: string;
  basedOnPathwayIds: readonly string[];
  deepenHref: string;
  deepenLabel: string;
  metric: Readonly<{
    label: string;
    display: string;
    hint?: string;
  }>;
  bars: readonly AiChartBar[];
  chartCaption: string;
}>;

export type AiInterventionMapStep = Readonly<{
  order: number;
  moveId: string;
  label: string;
  plain: string;
}>;

export type AiNextMove = Readonly<{
  id: string;
  title: string;
  whyNow: string;
  proposal: string;
  effect: string;
  metricLabel: string;
  metricDisplay: string;
  deepenHref: string;
  deepenLabel: string;
  sourceNote: string;
}>;

function signalById(id: string): AuditSignal {
  const signal = auditSignals.find((candidate) => candidate.id === id);
  if (!signal) throw new Error(`Segnale audit assente: ${id}`);
  return signal;
}

function formatBillion(value: number, digits = 1): string {
  return `${new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)} mld €`;
}

function formatMillionFromCents(cents: number): string {
  return `${new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(cents / 100_000_000)} mln €`;
}

function formatBillionFromCents(cents: number, digits = 1): string {
  return formatBillion(cents / 100_000_000_000, digits);
}

function formatEuroFromCents(cents: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function consultingYear(): number {
  const years = [...new Set(rgsConsultingSnapshot.rows.map((row) => row.year))];
  years.sort((left, right) => left - right);
  const year = years.at(-1);
  if (year === undefined) throw new Error("Nessun anno consulenze RGS nello snapshot");
  return year;
}

function topConsultingAdministrations(year: number, limit: number) {
  const totals = new Map<string, number>();
  for (const row of rgsConsultingSnapshot.rows) {
    if (row.year !== year) continue;
    totals.set(row.administration, (totals.get(row.administration) ?? 0) + row.paidCashCents);
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "it"))
    .slice(0, limit)
    .map(([administration, paidCashCents]) => ({ administration, paidCashCents }));
}

/**
 * Editorial synthesis pathways built only from adapters already on the platform.
 * Numbers are never invented here; copy stays descriptive (verify / improve), never accusatory.
 */
export function buildControlliSintesiPathways(): readonly SintesiPathway[] {
  const anac2025 = procurementComparisons[2025];
  const tax = signalById("tax-expenditures");
  const healthcare = signalById("healthcare-external-staff");
  const offBudget = signalById("off-budget-debt");
  const reducedCompetition = signalById("procurement-low-competition-value");
  const pnrr = signalById("pnrr-beyond-2026");
  const superbonus = signalById("superbonus-accrued-deductions");
  const collection = signalById("collection-stock");
  const gdf = signalById("gdf-public-spending-fraud");
  const outliers = queryOpenCivitasSpendingOutliers({ limit: 3 });
  const quadrants = summarizeOpenCivitasQuadrants(openCivitasSnapshot.municipalities);
  const highLow = quadrants.quadrants.find((quadrant) => quadrant.key === "high-low");
  if (!highLow) throw new Error("Quadrante OpenCivitas high-low assente");
  const debt = getPublicDebtView();
  const ssn = querySsnCce({});
  const ssnValues = ssn.selectedAggregate.values;
  if (!ssnValues) throw new Error("Valori nazionali SSN assenti nello snapshot");
  const productionCostsCents = ssnValues.productionCosts;
  const purchasedServicesCents = ssnValues.purchasedServices;
  const purchasedShare = productionCostsCents > 0
    ? (purchasedServicesCents / productionCostsCents) * 100
    : 0;
  const consultYear = consultingYear();
  const consultTop = topConsultingAdministrations(consultYear, 3);
  const consultPaid = rgsConsultingSnapshot.rows
    .filter((row) => row.year === consultYear)
    .reduce((sum, row) => sum + row.paidCashCents, 0);
  const central = auditScenarios.find((scenario) => scenario.id === "central");
  if (!central) throw new Error("Scenario centrale assente");

  const outlierExamples = outliers.outliers
    .map((outlier) => {
      const signed = formatEuroFromCents(Math.abs(outlier.differencePerCapitaCents));
      const side = outlier.direction === "sopra" ? "sopra" : "sotto";
      return `${outlier.name} (${side} soglia, ${signed}/ab.)`;
    })
    .join("; ");

  const pathways: SintesiPathway[] = [
    {
      id: "opencivitas-outliers",
      kind: "screening",
      area: "Comuni",
      headline: "Spesa comunale lontana dal valore di riferimento",
      observation:
        outliers.pagination.total === 0
          ? `OpenCivitas ${openCivitasSnapshot.referenceYear}: nessuno scostamento oltre la soglia regionale con i dati attuali.`
          : `OpenCivitas ${openCivitasSnapshot.referenceYear}: ${outliers.pagination.total} Comuni (su ${outliers.evaluatedMunicipalities} valutati) risultano oltre la soglia regionale Tukey sulla differenza per abitante tra spesa storica e spesa standard. Esempi: ${outlierExamples}.`,
      deepenHref: "/controlli",
      deepenLabel: "Vedi lo screening completo",
      action:
        "Confrontare spesa storica, valore di riferimento e livello dei servizi; verificare costi locali prima di qualsiasi ipotesi di revisione.",
      sourceLabel: "OpenCivitas · screening derivato DVNS",
      sourceUrl: openCivitasSnapshot.source.datasetUrl,
      period: String(openCivitasSnapshot.referenceYear),
      limits:
        "Screening statistico, non esito di controllo. La differenza dalla spesa standard non dimostra uno spreco.",
    },
    {
      id: "opencivitas-high-low",
      kind: "screening",
      area: "Comuni",
      headline: "Spesa alta e servizi bassi (profilo OpenCivitas)",
      observation:
        `Nel rilascio ${openCivitasSnapshot.referenceYear}, ${highLow.municipalities.toLocaleString("it-IT")} Comuni rientrano nel profilo descrittivo spesa da 6 a 10 e servizi da 0 a 5 (su ${quadrants.completeMunicipalities.toLocaleString("it-IT")} con livelli completi). Spesa storica aggregata del profilo: ${formatBillionFromCents(highLow.historicalSpendingCents)}; valore di riferimento aggregato: ${formatBillionFromCents(highLow.standardSpendingCents)}.`,
      deepenHref: "/territori/confronto",
      deepenLabel: "Apri il confronto OpenCivitas",
      action:
        "Leggere insieme spesa e servizi: il profilo segnala dove approfondire qualità e costi, non un giudizio automatico di inefficienza.",
      sourceLabel: "OpenCivitas · quadranti descrittivi",
      sourceUrl: openCivitasSnapshot.source.datasetUrl,
      period: String(openCivitasSnapshot.referenceYear),
      limits:
        "Classificazione descrittiva sui livelli pubblicati (soglia 6). Non è una graduatoria di merito.",
    },
    {
      id: "anac-direct-awards",
      kind: "osservazione",
      area: "Appalti",
      headline: "Affidamenti diretti e fascia vicino alla soglia",
      observation:
        `Nella relazione ANAC ${anac2025.year}, gli affidamenti diretti sono il ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(anac2025.byNumber)}% delle procedure da 40.000 € in su (per numero). Su servizi e forniture, ANAC segnala quasi il ${procurementServicesAndSupplies2025.directAwardShare}% di affidamenti diretti; le procedure tra ${procurementServicesAndSupplies2025.thresholdBandLowerEuro.toLocaleString("it-IT")} e ${procurementServicesAndSupplies2025.thresholdBandUpperEuro.toLocaleString("it-IT")} € passano da ${procurementServicesAndSupplies2025.thresholdBandCount2021.toLocaleString("it-IT")} (2021) a ${procurementServicesAndSupplies2025.thresholdBandCount2025.toLocaleString("it-IT")} (2025).`,
      deepenHref: "/appalti",
      deepenLabel: "Apri il verticale appalti",
      action:
        "Verificare motivazioni, concorrenza effettiva e ripetizione dello stesso operatore; la concentrazione vicino alla soglia indica dove approfondire, non un illecito automatico.",
      sourceLabel: anac2025.sourceTitle,
      sourceUrl: anac2025.sourceUrl,
      period: String(anac2025.year),
      limits: procurementServicesAndSupplies2025.caveat,
    },
    {
      id: "tax-expenditures",
      kind: "osservazione",
      area: tax.area,
      headline: "Agevolazioni fiscali da rivedere con metodo",
      observation: `${tax.label}: ${formatBillion(tax.value)}. ${tax.plainMeaning}`,
      deepenHref: "/controlli",
      deepenLabel: "Vedi il segnale nelle priorità",
      action:
        "Selezionare misure con stima puntuale e basso target pubblico, poi stimare effetti redistributivi prima di una revisione normativa.",
      sourceLabel: `${tax.source.institution} · ${tax.source.title}`,
      sourceUrl: tax.source.url,
      period: tax.referenceDate,
      limits: tax.caveat,
    },
    {
      id: "superbonus",
      kind: "osservazione",
      area: superbonus.area,
      headline: "Superbonus: costo fiscale cumulato da monitorare",
      observation: `${superbonus.label}: ${formatBillion(superbonus.value)}. ${superbonus.plainMeaning}`,
      deepenHref: "/controlli",
      deepenLabel: "Vedi il segnale nelle priorità",
      action:
        "Tenere separate detrazioni maturate e pagamenti di cassa; verificare sovrapposizioni con altre agevolazioni prima di qualsiasi ipotesi di revisione.",
      sourceLabel: `${superbonus.source.institution} · ${superbonus.source.title}`,
      sourceUrl: superbonus.source.url,
      period: superbonus.referenceDate,
      limits: superbonus.caveat,
    },
    {
      id: "healthcare-external-staff",
      kind: "osservazione",
      area: healthcare.area,
      headline: "Personale sanitario esterno: dipendenza da valutare",
      observation: `${healthcare.label}: ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(healthcare.value)} mln €. ${healthcare.plainMeaning}`,
      deepenHref: "/spese/sanita",
      deepenLabel: "Apri la spesa sanitaria",
      action:
        "Confrontare costo esterno e assunzioni stabili per branca; il ricorso a esterni può essere necessario, ma va monitorato se strutturale.",
      sourceLabel: `${healthcare.source.institution} · ${healthcare.source.title}`,
      sourceUrl: healthcare.source.url,
      period: healthcare.referenceDate,
      limits: healthcare.caveat,
    },
    {
      id: "ssn-production-costs",
      kind: "osservazione",
      area: "Sanità",
      headline: "Costi di produzione SSN e servizi acquistati",
      observation:
        `Conto economico consuntivo SSN ${ssn.referenceYear}: costi della produzione ${formatBillionFromCents(productionCostsCents)}; servizi acquistati ${formatBillionFromCents(purchasedServicesCents)} (${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(purchasedShare)}% del totale produzione).`,
      deepenHref: "/spese/sanita",
      deepenLabel: "Apri il Conto economico SSN",
      action:
        "Monitorare il peso dei servizi acquistati rispetto al personale interno; è competenza economica, non cassa SIOPE.",
      sourceLabel: "OpenBDAP · Conto economico enti SSN",
      sourceUrl: "/spese/sanita",
      period: String(ssn.referenceYear),
      limits: ssn.observation.accountingBasis,
    },
    {
      id: "off-budget-debt",
      kind: "osservazione",
      area: offBudget.area,
      headline: "Debiti fuori bilancio nei Comuni",
      observation: `${offBudget.label}: ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(offBudget.value)} mln €. ${offBudget.plainMeaning}`,
      deepenHref: "/territori",
      deepenLabel: "Apri i territori e i pagamenti comunali",
      action:
        "Priorità agli enti con acquisti senza impegno preventivo: rafforzare controlli contabili e trasparenza degli impegni, non sanzioni automatiche da questo dato.",
      sourceLabel: `${offBudget.source.institution} · ${offBudget.source.title}`,
      sourceUrl: offBudget.source.url,
      period: offBudget.referenceDate,
      limits: offBudget.caveat,
    },
    {
      id: "public-debt-interest",
      kind: "osservazione",
      area: "Debito pubblico",
      headline: "Stock di debito e peso degli interessi",
      observation:
        `Stock BdI al ${debt.stock.referenceDate}: ${formatBillionFromCents(debt.stock.totalCents, 1)}. Interessi sul bilancio pubblico (Eurostat ${debt.citizenImpact.annualInterest.referenceYear}): ${formatBillionFromCents(debt.citizenImpact.annualInterest.interestExpenseCents, 1)}, pari a ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(debt.citizenImpact.annualInterest.euroPerHundredEuro)} € ogni 100 € di spesa pubblica totale. Quota in scadenza entro un anno: ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(debt.citizenImpact.refinancingExposure.upToOneYearShareBasisPoints / 100)}%.`,
      deepenHref: "/debito",
      deepenLabel: "Apri il debito pubblico",
      action:
        "Usare stock, fabbisogno e interessi come vincolo di contesto per qualsiasi ipotesi di revisione di spesa o entrate; non sono un taglio automatico.",
      sourceLabel: "Banca d'Italia · Eurostat gov_10a_main",
      sourceUrl: debt.sources.bancaditalia.landingUrl,
      period: debt.stock.referenceDate,
      limits:
        "Stock e interessi hanno fonti e periodi distinti. Non attribuiscono responsabilità a un singolo governo senza contesto.",
    },
    {
      id: "rgs-consulting",
      kind: "osservazione",
      area: "Consulenze ministeriali",
      headline: "Pagamenti per consulenze (categorie economiche RGS)",
      observation:
        consultTop.length === 0
          ? `Snapshot RGS ${consultYear}: nessun pagamento di consulenza nello snapshot.`
          : `Nel ${consultYear} lo snapshot RGS registra ${formatMillionFromCents(consultPaid)} di pagamenti di cassa per consulenze (aggregati PG). Principali amministrazioni per importo pagato: ${consultTop
              .map((row) => `${row.administration} (${formatMillionFromCents(row.paidCashCents)})`)
              .join("; ")}.`,
      deepenHref: "/spese/consulenze",
      deepenLabel: "Apri consulenze ministeriali",
      action:
        "Drill-down per amministrazione e piano di gestione: confrontare anni e verificare se i servizi sono ripetuti o sostituibili con capacità interne.",
      sourceLabel: "Ragioneria Generale dello Stato · OpenBDAP consulenze",
      sourceUrl: "https://bdap-opendata.rgs.mef.gov.it/",
      period: String(consultYear),
      limits:
        "Aggregati contabili PG, senza nominativi di consulenti. Non è una classifica di merito o di spreco.",
    },
    {
      id: "reduced-competition-value",
      kind: "osservazione",
      area: reducedCompetition.area,
      headline: "Valore delle procedure a ridotta concorrenza",
      observation: `${reducedCompetition.label}: ${formatBillion(reducedCompetition.value)}. ${reducedCompetition.plainMeaning}`,
      deepenHref: "/appalti",
      deepenLabel: "Apri gli appalti",
      action:
        "Allargare la platea di operatori e documentare meglio le deroghe: il dato misura esposizione a ridotta concorrenza, non un illecito.",
      sourceLabel: `${reducedCompetition.source.institution} · ${reducedCompetition.source.title}`,
      sourceUrl: reducedCompetition.source.url,
      period: reducedCompetition.referenceDate,
      limits: reducedCompetition.caveat,
    },
    {
      id: "pnrr-beyond-2026",
      kind: "osservazione",
      area: pnrr.area,
      headline: "Risorse PNRR previste oltre il 2026",
      observation: `${pnrr.label}: ${formatBillion(pnrr.value)}. ${pnrr.plainMeaning}`,
      deepenHref: "/coesione/asili",
      deepenLabel: "Apri fondi e progetti (asili PNRR)",
      action:
        "Monitorare scadenze, stati di avanzamento e capacità di spesa; il dato misura programmazione, non ritardi individuali.",
      sourceLabel: `${pnrr.source.institution} · ${pnrr.source.title}`,
      sourceUrl: pnrr.source.url,
      period: pnrr.referenceDate,
      limits: pnrr.caveat,
    },
    {
      id: "collection-stock",
      kind: "osservazione",
      area: collection.area,
      headline: "Carichi affidati alla riscossione",
      observation: `${collection.label}: ${formatBillion(collection.value)}. ${collection.plainMeaning}`,
      deepenHref: "/controlli",
      deepenLabel: "Vedi il segnale nelle priorità",
      action:
        "Distinguere stock storico e nuove affidamenti; valutare strategie di riscossione senza confondere credito affidato e gettito annuale.",
      sourceLabel: `${collection.source.institution} · ${collection.source.title}`,
      sourceUrl: collection.source.url,
      period: collection.referenceDate,
      limits: collection.caveat,
    },
    {
      id: "gdf-controls",
      kind: "osservazione",
      area: gdf.area,
      headline: "Esiti dei controlli della Guardia di finanza",
      observation:
        `La Guardia di finanza comunica oltre ${formatBillion(gdf.value)} di esiti di controllo a danno del bilancio nazionale e dell'Unione europea (${gdf.coverage}).`,
      deepenHref: "/controlli",
      deepenLabel: "Vedi il segnale nelle priorità",
      action:
        "Usare il comunicato ufficiale come priorità di lettura istituzionale; non equivale a condanne definitive o somme già recuperate.",
      sourceLabel: `${gdf.source.institution} · ${gdf.source.title}`,
      sourceUrl: gdf.source.url,
      period: gdf.referenceDate,
      limits: gdf.caveat,
    },
    {
      id: "improvement-hypothesis",
      kind: "ipotesi",
      area: "Ipotesi di miglioramento",
      headline: "Scenario centrale: dove una revisione potrebbe agire",
      observation:
        `Ipotesi di policy (non un risparmio già disponibile): scenario centrale a ${formatBillion(central.annualBillion, 2)}/anno, costruito su basi dichiarate (agevolazioni ${formatBillion(auditScenarioBasis.taxExpendituresBillion)}, ridotta concorrenza ${formatBillion(auditScenarioBasis.reducedCompetitionBillion)}, personale sanitario esterno ${formatBillion(auditScenarioBasis.externalHealthcareStaffBillion, 3)}, acquisti senza impegno ${formatBillion(auditScenarioBasis.purchasesWithoutPriorCommitmentBillion, 3)}). Quote assunte: appalti ${Math.round(auditScenarioAssumptions.central.procurementAuditedShare * 100)}% del perimetro × ${Math.round(auditScenarioAssumptions.central.procurementEfficiencyRate * 1000) / 10}% efficienza; agevolazioni ${Math.round(auditScenarioAssumptions.central.taxReviewRate * 100)}%; sanità ${Math.round(auditScenarioAssumptions.central.healthcareReductionRate * 100)}%; prevenzione debiti ${Math.round(auditScenarioAssumptions.central.debtPreventionRate * 100)}%. Componenti: ${centralScenarioBreakdown
          .map((row) => `${row.label} ${formatBillion(row.value, 1)}`)
          .join("; ")}.`,
      deepenHref: "/controlli#policy-scenarios-title",
      deepenLabel: "Vedi scenari e assunzioni",
      action:
        "Usare lo scenario solo come ordine di grandezza per un dibattito pubblico: ogni voce richiede una misura normativa o amministrativa verificabile.",
      sourceLabel: auditScenarioBasis.sourceTitle,
      sourceUrl: "/metodologia",
      period: auditScenarioBasis.reviewedAt,
      limits:
        "Sono ipotesi di politica pubblica. Non sono risparmi già disponibili e non sono previsioni ufficiali.",
    },
  ];

  return pathways;
}

function shortAdminLabel(name: string, max = 28): string {
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Deterministic "what an AI steward would do" agenda.
 * Explicitly AI-labeled: not a live model call, not government advice, grounded in the same pathways.
 * Each move carries a metric + bar chart built from the same sourced numbers (no invented figures).
 */
export function buildAiStewardshipAgenda(
  pathways: readonly SintesiPathway[] = buildControlliSintesiPathways(),
): readonly AiStewardshipMove[] {
  const byId = new Map(pathways.map((pathway) => [pathway.id, pathway]));
  const need = (id: string) => {
    const pathway = byId.get(id);
    if (!pathway) throw new Error(`Percorso assente per agenda AI: ${id}`);
    return pathway;
  };

  const tax = need("tax-expenditures");
  const anac = need("anac-direct-awards");
  const competition = need("reduced-competition-value");
  const debt = need("public-debt-interest");
  const oc = need("opencivitas-high-low");
  const ssn = need("ssn-production-costs");
  const consult = need("rgs-consulting");
  const collection = need("collection-stock");
  const scenario = need("improvement-hypothesis");

  const centralScenario = auditScenarios.find((row) => row.id === "central");
  if (!centralScenario) throw new Error("Scenario centrale assente per agenda AI");

  const debtView = getPublicDebtView();
  const interestBillion = debtView.citizenImpact.annualInterest.interestExpenseCents / 100_000_000_000;
  const maturity = debtView.residualMaturity.shares;
  const taxSignal = signalById("tax-expenditures");
  const superbonusSignal = signalById("superbonus-accrued-deductions");
  const anac2025 = procurementComparisons[2025];
  const reducedCompetition = signalById("procurement-low-competition-value");
  const collectionSignal = signalById("collection-stock");
  const healthcare = signalById("healthcare-external-staff");
  const quadrants = summarizeOpenCivitasQuadrants(openCivitasSnapshot.municipalities);
  const highLow = quadrants.quadrants.find((quadrant) => quadrant.key === "high-low");
  if (!highLow) throw new Error("Quadrante OpenCivitas high-low assente per agenda AI");
  const otherMunicipalities = Math.max(0, quadrants.completeMunicipalities - highLow.municipalities);
  const ssnQuery = querySsnCce({});
  const ssnValues = ssnQuery.selectedAggregate.values;
  if (!ssnValues) throw new Error("Valori nazionali SSN assenti per agenda AI");
  const productionCostsCents = ssnValues.productionCosts;
  const purchasedServicesCents = ssnValues.purchasedServices;
  const purchasedShare = productionCostsCents > 0
    ? (purchasedServicesCents / productionCostsCents) * 100
    : 0;
  const consultYear = consultingYear();
  const consultTop = topConsultingAdministrations(consultYear, 3);
  const consultMax = Math.max(...consultTop.map((row) => row.paidCashCents), 1);
  const scenarioMax = Math.max(...centralScenarioBreakdown.map((row) => row.value), 0.01);

  return [
    {
      id: "ai-map-constraints",
      priority: 1,
      title: "Prima di tutto: quanto costa il debito",
      concerns:
        "Il debito pubblico e quanto paghiamo ogni anno di interessi. È il punto di partenza: senza questo numero, ogni 'risparmio' rischia di essere una promessa vuota.",
      proposal:
        "Propone di mostrare sempre, in apertura di qualsiasi piano di revisione, tre cifre: quanto debito c'è, quanto paghiamo di interessi, quanto scade entro un anno.",
      operation:
        "L'agente prende questi tre numeri dalle fonti ufficiali e li mette in cima. Solo dopo guarda le spese da rivedere.",
      effect:
        "Chi legge capisce subito il vincolo: non si presenta un taglio come soldi già in tasca se prima non si vede il costo del debito.",
      why: debt.observation,
      basedOnPathwayIds: ["public-debt-interest"],
      deepenHref: debt.deepenHref,
      deepenLabel: "Vedi il debito pubblico",
      metric: {
        label: "Interessi pagati in un anno",
        display: formatBillion(interestBillion, 1),
        hint: `Scade entro 1 anno: ${(maturity.upToOneYearBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}% del debito`,
      },
      bars: [
        {
          label: "Scade entro 1 anno",
          value: maturity.upToOneYearBasisPoints,
          display: `${(maturity.upToOneYearBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
        {
          label: "Scade tra 1 e 5 anni",
          value: maturity.oneToFiveYearsBasisPoints,
          display: `${(maturity.oneToFiveYearsBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
        {
          label: "Scade oltre 5 anni",
          value: maturity.overFiveYearsBasisPoints,
          display: `${(maturity.overFiveYearsBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
      ],
      chartCaption: "Quando torna a scadenza il debito (quote sul totale)",
    },
    {
      id: "ai-review-tax-expenditures",
      priority: 2,
      title: "Mettere in fila le agevolazioni fiscali che hanno una cifra",
      concerns:
        "Sconti e agevolazioni sulle tasse. Molte esistono sulla carta: l'agente guarda solo quelle a cui il MEF ha già messo un valore in euro.",
      proposal:
        "Propone una lista pubblica delle agevolazioni con stima in euro, da far valutare a persone (non all'AI) prima di cambiare le leggi.",
      operation:
        "Toglie dalla lista le misure senza numero. Tiene Superbonus e altre voci grandi come contesto, senza sommarle a casaccio.",
      effect:
        "Il dibattito parte da 'queste misure costano circa X', non da slogan. Eventuali tagli restano una scelta politica umana.",
      why: tax.observation,
      basedOnPathwayIds: ["tax-expenditures", "superbonus"],
      deepenHref: tax.deepenHref,
      deepenLabel: "Vedi le agevolazioni",
      metric: {
        label: "Agevolazioni con stima MEF",
        display: formatBillion(taxSignal.value, 1),
        hint: taxSignal.coverage,
      },
      bars: [
        {
          label: "Agevolazioni con stima",
          value: taxSignal.value,
          display: formatBillion(taxSignal.value, 1),
        },
        {
          label: "Superbonus (costo accumulato)",
          value: superbonusSignal.value,
          display: formatBillion(superbonusSignal.value, 1),
        },
      ],
      chartCaption: "Due ordini di grandezza fiscali (non vanno sommati come un unico risparmio)",
    },
    {
      id: "ai-open-procurement",
      priority: 3,
      title: "Far concorrere di più chi vende allo Stato",
      concerns:
        "Appalti e affidamenti: quando una gara ha pochi concorrenti, o si compra 'in diretta' senza un confronto ampio.",
      proposal:
        "Propone di aprire più gare competitive e di spiegare per iscritto quando si sceglie invece un affidamento diretto o una procedura ristretta.",
      operation:
        "Segnala dove gli affidamenti diretti sono molti sul numero di procedure, e dove c'è molto valore a ridotta concorrenza. Non accusa nessuno di reato.",
      effect:
        "Più fornitori in gara può far scendere i prezzi e alzare la qualità; il controllo resta umano.",
      why: `${anac.observation} ${competition.observation}`,
      basedOnPathwayIds: ["anac-direct-awards", "reduced-competition-value"],
      deepenHref: anac.deepenHref,
      deepenLabel: "Vedi gli appalti",
      metric: {
        label: "Affidamenti diretti (sul numero di procedure)",
        display: `${anac2025.byNumber.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        hint: `Sul valore complessivo: ${anac2025.byValue.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
      },
      bars: [
        {
          label: "Diretti sul numero",
          value: anac2025.byNumber,
          display: `${anac2025.byNumber.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
        {
          label: "Diretti sul valore",
          value: anac2025.byValue,
          display: `${anac2025.byValue.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
        {
          label: "Valore a ridotta concorrenza",
          value: Math.min(100, (reducedCompetition.value / anac2025.totalValueBillion) * 100),
          display: formatBillion(reducedCompetition.value, 1),
        },
      ],
      chartCaption: "ANAC 2025: quanto pesano le procedure poco aperte (scale diverse, lettura semplice)",
    },
    {
      id: "ai-municipal-profiles",
      priority: 4,
      title: "Guardare i Comuni che spendono tanto e offrono poco",
      concerns:
        "Bilanci comunali confrontati con un valore di riferimento e con il livello dei servizi (OpenCivitas).",
      proposal:
        "Propone di partire dai Comuni dove la spesa è alta e i servizi risultano bassi, chiedendo spiegazioni e confronti con Comuni simili prima di qualsiasi taglio.",
      operation:
        "Prepara una coda di lettura: prima i dati, poi il confronto con pari, poi eventuali scelte locali. Non fa una classifica di 'cattivi amministratori'.",
      effect:
        "Si interviene dove c'è più da capire; i cittadini vedono spesa e servizi insieme, non solo un totale.",
      why: oc.observation,
      basedOnPathwayIds: ["opencivitas-high-low", "opencivitas-outliers"],
      deepenHref: oc.deepenHref,
      deepenLabel: "Confronta i Comuni",
      metric: {
        label: "Comuni nel profilo spesa alta / servizi bassi",
        display: highLow.municipalities.toLocaleString("it-IT"),
        hint: `su ${quadrants.completeMunicipalities.toLocaleString("it-IT")} con dati completi`,
      },
      bars: [
        {
          label: "Profilo da approfondire",
          value: highLow.municipalities,
          display: highLow.municipalities.toLocaleString("it-IT"),
        },
        {
          label: "Altri Comuni con dati completi",
          value: otherMunicipalities,
          display: otherMunicipalities.toLocaleString("it-IT"),
        },
      ],
      chartCaption: `OpenCivitas ${openCivitasSnapshot.referenceYear}: quanti Comuni rientrano nel profilo`,
    },
    {
      id: "ai-health-mix",
      priority: 5,
      title: "Capire quanto la sanità compra fuori e quanto fa in casa",
      concerns:
        "Soldi della sanità pubblica: servizi comprati all'esterno e personale 'a gettone' o esterno.",
      proposal:
        "Propone simulazioni (non tagli automatici) per vedere cosa cambierebbe se una parte dei servizi esterni tornasse a personale stabile, dove ha senso clinico.",
      operation:
        "Misura il peso dei servizi acquistati sui costi di produzione e la spesa per personale esterno. Confronta, non decide al posto dei medici o delle Regioni.",
      effect:
        "Si vede dove la dipendenza dall'esterno è più forte; le scelte restano sanitarie e politiche, non un taglio cieco.",
      why: ssn.observation,
      basedOnPathwayIds: ["ssn-production-costs", "healthcare-external-staff"],
      deepenHref: ssn.deepenHref,
      deepenLabel: "Vedi la sanità",
      metric: {
        label: "Quota di servizi acquistati",
        display: `${purchasedShare.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        hint: `Personale esterno: ${formatBillion(healthcare.value, 3)}`,
      },
      bars: [
        {
          label: "Servizi acquistati",
          value: purchasedServicesCents,
          display: formatBillionFromCents(purchasedServicesCents),
        },
        {
          label: "Altri costi di produzione",
          value: Math.max(0, productionCostsCents - purchasedServicesCents),
          display: formatBillionFromCents(Math.max(0, productionCostsCents - purchasedServicesCents)),
        },
      ],
      chartCaption: "Come si spezza il costo di produzione del SSN (dato nazionale)",
    },
    {
      id: "ai-consulting-and-collection",
      priority: 6,
      title: "Separare consulenze ripetute e crediti difficili da riscuotere",
      concerns:
        "Due cose diverse: soldi pagati per consulenze ai ministeri, e lo stock enorme di cartelle ancora da riscuotere (che non è denaro già disponibile).",
      proposal:
        "Propone di pubblicare ogni anno chi paga di più in consulenze e perché, e di trattare lo stock della riscossione come credito incerto, non come 'tesoretto'.",
      operation:
        "Confronta le amministrazioni con i pagamenti più alti per consulenze. Tiene la riscossione su un binario separato: piano di recupero realistico, senza confonderla con le entrate dell'anno.",
      effect:
        "Meno confusione: si capisce cosa si compra con le consulenze e cosa, invece, è solo un credito nominale difficile da incassare.",
      why: `${consult.observation} ${collection.observation}`,
      basedOnPathwayIds: ["rgs-consulting", "collection-stock"],
      deepenHref: consult.deepenHref,
      deepenLabel: "Vedi le consulenze",
      metric: {
        label: "Stock nominale della riscossione",
        display: formatBillion(collectionSignal.value, 1),
        hint: "Gran parte non è realisticamente recuperabile subito",
      },
      bars: consultTop.map((row) => ({
        label: shortAdminLabel(row.administration),
        value: row.paidCashCents / consultMax,
        display: formatMillionFromCents(row.paidCashCents),
      })),
      chartCaption: `Chi ha pagato di più in consulenze (${consultYear})`,
    },
    {
      id: "ai-publish-hypothesis",
      priority: 7,
      title: "Dire in chiaro quanto si potrebbe migliorare (con le ipotesi)",
      concerns:
        "Uno scenario di miglioramento già calcolato sul sito: non è soldi in cassa, è un 'se facessimo X con queste assunzioni'.",
      proposal:
        `Propone di usare lo scenario centrale (${formatBillion(centralScenario.annualBillion, 2)} all'anno) solo come ordine di grandezza pubblico, sempre con le assunzioni visibili.`,
      operation:
        "Mostra le parti dello scenario (agevolazioni, appalti, sanità, debiti fuori bilancio). Vieta di presentarlo come risparmio già fatto.",
      effect:
        "Cittadini e media discutono su numeri dichiarati, non su promesse senza formule.",
      why: scenario.observation,
      basedOnPathwayIds: ["improvement-hypothesis"],
      deepenHref: scenario.deepenHref,
      deepenLabel: "Vedi gli scenari",
      metric: {
        label: "Ipotesi scenario centrale / anno",
        display: formatBillion(centralScenario.annualBillion, 2),
        hint: "Ipotesi di policy, non previsione e non cassa",
      },
      bars: centralScenarioBreakdown.map((row) => ({
        label: shortAdminLabel(row.label, 42),
        value: row.value / scenarioMax,
        display: formatBillion(row.value, 2),
      })),
      chartCaption: "Di cosa è fatto lo scenario centrale (assunzioni, non soldi certi)",
    },
  ];
}

/** Visual reading order of the 7 AI moves for the intervention map. */
export function buildAiInterventionMap(
  agenda: readonly AiStewardshipMove[] = buildAiStewardshipAgenda(),
): readonly AiInterventionMapStep[] {
  return agenda.map((move) => ({
    order: move.priority,
    moveId: move.id,
    label: move.title,
    plain: move.proposal,
  }));
}

/**
 * Extra interventions grounded in platform data not yet in the 7-priority agenda.
 * Built after an end-to-end pass of audit signals, cohesion, participations and editorial gates.
 */
export function buildAiNextMoves(): readonly AiNextMove[] {
  const offBudget = signalById("off-budget-debt");
  const pnrr = signalById("pnrr-beyond-2026");
  const pathways = buildControlliSintesiPathways();
  const offBudgetPath = pathways.find((row) => row.id === "off-budget-debt");
  const pnrrPath = pathways.find((row) => row.id === "pnrr-beyond-2026");
  const consip = getEditorialTopic("appalti", "consip-da-confrontare");
  if (!consip) throw new Error("Topic editoriale consip-da-confrontare assente");

  const publicCostBillion = opencoesioneOverview.totals.publicCostCents / 100_000_000_000;
  const paymentsBillion = opencoesioneOverview.totals.paymentsCents / 100_000_000_000;
  const participations = mefParticipationsSnapshot;

  return [
    {
      id: "next-off-budget",
      title: "Fermare i nuovi debiti fuori bilancio nei Comuni",
      whyNow:
        offBudgetPath?.observation
        ?? `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(offBudget.value)} mln € di debiti fuori bilancio rilevati dalla Corte dei conti.`,
      proposal:
        "Propone di rafforzare i controlli sugli acquisti senza impegno preventivo e di pubblicare, per ogni Comune coinvolto, quanto nasce ancora fuori bilancio.",
      effect:
        "Meno passività 'sorpresa' nei bilanci locali; non è un recupero automatico dello stock già esistente.",
      metricLabel: "Debiti fuori bilancio rilevati",
      metricDisplay: `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(offBudget.value)} mln €`,
      deepenHref: offBudgetPath?.deepenHref ?? "/controlli",
      deepenLabel: "Vedi il segnale sui debiti fuori bilancio",
      sourceNote: `${offBudget.source.institution} · ${offBudget.source.title} · ${offBudget.referenceDate}`,
    },
    {
      id: "next-pnrr-cohesion",
      title: "Tenere sotto controllo PNRR e fondi di coesione",
      whyNow:
        pnrrPath?.observation
        ?? `Circa ${formatBillion(pnrr.value, 1)} di risorse PNRR previste oltre il 2026.`,
      proposal:
        "Propone una dashboard pubblica di scadenze e pagamenti: cosa è in corso, cosa è concluso, cosa è ancora da avviare, senza confondere ritardo e denaro perso.",
      effect:
        "Si vede se i progetti avanzano davvero; i cittadini possono chiedere conto sui tempi.",
      metricLabel: "Costo pubblico progetti vs pagamenti (OpenCoesione)",
      metricDisplay: `${formatBillion(publicCostBillion, 0)} costo · ${formatBillion(paymentsBillion, 0)} pagati`,
      deepenHref: "/coesione",
      deepenLabel: "Apri Coesione e PNRR",
      sourceNote: `OpenCoesione overview · PNRR oltre 2026: ${formatBillion(pnrr.value, 1)} (${pnrr.referenceDate})`,
    },
    {
      id: "next-participations",
      title: "Fare luce sulle società partecipate",
      whyNow: `Il MEF censisce ${participations.totals.participationRecords.toLocaleString("it-IT")} rapporti di partecipazione; ${participations.declaredEvidence.directAwardRecords.toLocaleString("it-IT")} dichiarano affidamenti diretti.`,
      proposal:
        "Propone di aggiornare e pubblicare l'elenco delle partecipate con i segnali dichiarati (affidamento diretto / controllo analogo) e di chiedere spiegazioni periodiche dove i due segnali coesistono.",
      effect:
        "Più trasparenza su chi controlla cosa; non è una sentenza di illegalità.",
      metricLabel: "Partecipazioni censite (MEF)",
      metricDisplay: participations.totals.participationRecords.toLocaleString("it-IT"),
      deepenHref: "/partecipazioni",
      deepenLabel: "Apri le partecipazioni",
      sourceNote: `Rilevazione MEF ${participations.referenceYear} · ${participations.declaredEvidence.legalMeaning}`,
    },
    {
      id: "next-appointments",
      title: "Monitorare gli incarichi esterni (oltre le consulenze RGS)",
      whyNow:
        "In piattaforma c'è anche la serie nazionale degli incarichi (diversa dai soli pagamenti RGS per consulenze).",
      proposal:
        "Propone di confrontare anno su anno incarichi esterni e dipendente, evidenziando gli enti dove crescono di più assegnazioni e pagamenti, senza liste di nomi da giudicare.",
      effect:
        "Si capisce se lo Stato compra lavoro esterno in modo ripetuto o se rafforza capacità interne.",
      metricLabel: "Pagina di dettaglio",
      metricDisplay: "Incarichi",
      deepenHref: "/incarichi",
      deepenLabel: "Apri gli incarichi",
      sourceNote: "Dataset consulenti/incarichi già in catalogo MCP",
    },
    {
      id: "next-budget-law",
      title: "Leggere la Legge di Bilancio missione per missione",
      whyNow:
        "I dati di stanziamento enacted per missione permettono di vedere cosa cresce o cala rispetto all'anno prima.",
      proposal:
        "Propone di ordinare le missioni per variazione annuale e di aprire un approfondimento pubblico dove le voci crescono di più, senza mescolare stanziamenti e pagamenti consuntivi.",
      effect:
        "Il dibattito sulla manovra parte da numeri confrontabili, non solo da titoli di giornale.",
      metricLabel: "Pagina di dettaglio",
      metricDisplay: "Legge di Bilancio",
      deepenHref: "/spese/legge-di-bilancio",
      deepenLabel: "Apri la Legge di Bilancio",
      sourceNote: "Serie storica OpenBDAP legge di bilancio",
    },
    {
      id: "next-territorial",
      title: "Confrontare la spesa dello Stato sul territorio",
      whyNow:
        "Esistono già la spesa statale territorializzata (RGS) e i conti CPT regionali: oggi si possono leggere meglio insieme.",
      proposal:
        "Propone confronti pro capite e per missione a livelli non sommabili (Italia, macroaree, regioni), segnalando scostamenti da approfondire, non un 'residuo fiscale' inventato.",
      effect:
        "Si vede dove lo Stato spende di più o di meno per abitante, con i limiti del dato in chiaro.",
      metricLabel: "Pagine di dettaglio",
      metricDisplay: "Territoriale + CPT",
      deepenHref: "/spese/territoriale",
      deepenLabel: "Apri la spesa territorializzata",
      sourceNote: "RGS spesa territoriale · CPT finanza regionale su /territori/fisco",
    },
    {
      id: "next-invalidity",
      title: "Seguire la spesa per invalidità civile regione per regione",
      whyNow:
        "I dati INPS su invalidità civile mostrano spesa e nuove pensioni per territorio.",
      proposal:
        "Propone di pubblicare l'andamento regionale e di approfondire dove crescono insieme spesa e nuove prestazioni, guardando servizi e controlli amministrativi, senza accusare i beneficiari.",
      effect:
        "Più chiarezza sulla qualità della spesa sociale; niente 'caccia' alle persone.",
      metricLabel: "Pagina di dettaglio",
      metricDisplay: "Invalidità INPS",
      deepenHref: "/spese/invalidita",
      deepenLabel: "Apri l'invalidità civile",
      sourceNote: "Dataset INPS invalidità civile",
    },
    {
      id: "next-consip-gate",
      title: "Rendere confrontabili gli acquisti (prima di parlare di prezzi)",
      whyNow: consip.hubSummary,
      proposal:
        "Propone di obbligare modello, SKU, quantità, periodo e IVA nei contratti candidati al confronto: senza questi campi non si pubblica alcun 'sovrapprezzo'.",
      effect:
        "Si sblocca un confronto prezzi futuro onesto; oggi si rende trasparente il buco informativo.",
      metricLabel: "Contratti non ancora confrontabili",
      metricDisplay: consip.primaryMetric,
      deepenHref: "/dati",
      deepenLabel: "Apri il catalogo dati (appalti)",
      sourceNote: `${consip.title} · ${consip.status}`,
    },
  ];
}

export const sintesiReadingOrder = [
  {
    step: "1",
    title: "Cosa emerge",
    text: "Osservazioni e screening già calcolati dai dati in piattaforma.",
  },
  {
    step: "2",
    title: "Dove approfondire",
    text: "Link alla pagina di dettaglio o alla fonte ufficiale.",
  },
  {
    step: "3",
    title: "Cosa si può fare",
    text: "Piste di verifica o di miglioramento. Mai accuse automatiche.",
  },
] as const;

export const aiStewardshipDisclosure = {
  badge: "Sezione agenti AI · non ufficiale",
  kicker: "Capitolo distinto dai percorsi umani sopra",
  title: "Cosa proporrebbe un agente AI",
  subtitle: "In linguaggio semplice: sette mosse, poi una mappa, poi cosa manca ancora",
  lead:
    "Qui non continuiamo l'elenco dei percorsi. Qui un agente AI (regole fisse, non un robot che decide da solo) dice cosa farebbe se dovesse aiutare a orientare spese e leggi. Non è parere del Governo. Ogni proposta usa solo numeri già in piattaforma.",
  howToRead:
    "Per ogni priorità leggi prima 'In pratica propone', poi cosa riguarda, come lavora e che effetto avrebbe. I grafici sono il dato di supporto.",
  allowed: auditMethodology.aiUse.allowed,
  prohibited: auditMethodology.aiUse.prohibited,
} as const;
