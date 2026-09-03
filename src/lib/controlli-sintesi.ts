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
import { rgsConsultingSnapshot } from "@/lib/rgs-consulting-snapshot";
import { querySsnCce } from "@/lib/ssn-cce-snapshot";

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
  /** What domain / object the move covers. */
  concerns: string;
  /** How the agent would operate. */
  operation: string;
  /** Expected orientation effect if humans follow up (not a guaranteed saving). */
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
      title: "Mappare prima i vincoli di bilancio",
      concerns: "Stock di debito pubblico, interessi annui e scadenze residue.",
      operation:
        "L'agente legge stock, interessi e quota in scadenza entro un anno e li dispone come vincoli prima di qualsiasi proposta su spese o entrate.",
      effect:
        "Definisce un perimetro sostenibile: le revisioni successive restano confrontabili con il costo del debito, senza presentarle come cassa libera.",
      why: debt.observation,
      basedOnPathwayIds: ["public-debt-interest"],
      deepenHref: debt.deepenHref,
      deepenLabel: "Apri il debito pubblico",
      metric: {
        label: "Interessi annui (Eurostat)",
        display: formatBillion(interestBillion, 1),
        hint: `Scadenza ≤1 anno: ${(maturity.upToOneYearBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
      },
      bars: [
        {
          label: "Fino a 1 anno",
          value: maturity.upToOneYearBasisPoints,
          display: `${(maturity.upToOneYearBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
        {
          label: "Da 1 a 5 anni",
          value: maturity.oneToFiveYearsBasisPoints,
          display: `${(maturity.oneToFiveYearsBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
        {
          label: "Oltre 5 anni",
          value: maturity.overFiveYearsBasisPoints,
          display: `${(maturity.overFiveYearsBasisPoints / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        },
      ],
      chartCaption: "Scadenze residue del debito (quote sul totale)",
    },
    {
      id: "ai-review-tax-expenditures",
      priority: 2,
      title: "Ordinare le agevolazioni fiscali per revisione",
      concerns: "Agevolazioni fiscali MEF con stima puntuale e onere Superbonus già censito.",
      operation:
        "L'agente produce una coda delle sole misure con stima numerica, esclude quelle senza copertura e richiede una valutazione redistributiva umana prima di ipotesi normative.",
      effect:
        "Il dibattito fiscale parte da una shortlist verificabile: meno rumore sulle misure senza cifra, più trasparenza su dove una revisione potrebbe incidere.",
      why: tax.observation,
      basedOnPathwayIds: ["tax-expenditures", "superbonus"],
      deepenHref: tax.deepenHref,
      deepenLabel: "Apri le agevolazioni",
      metric: {
        label: "Stima puntuale MEF",
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
          label: "Superbonus (onere cumulato)",
          value: superbonusSignal.value,
          display: formatBillion(superbonusSignal.value, 1),
        },
      ],
      chartCaption: "Ordini di grandezza fiscali già in piattaforma (non sommare come un unico risparmio)",
    },
    {
      id: "ai-open-procurement",
      priority: 3,
      title: "Aprire più concorrenza negli appalti",
      concerns: "Affidamenti diretti ANAC e contratti a ridotta concorrenza sul valore.",
      operation:
        "L'agente segnala procedure vicino alla soglia e perimetri a ridotta concorrenza come code di verifica; propone di allargare la platea e di documentare le deroghe, senza attribuire illeciti.",
      effect:
        "Più controlli mirati e più confronto competitivo dove i dati lo suggeriscono; l'esito resta amministrativo e umano, non una sentenza automatica.",
      why: `${anac.observation} ${competition.observation}`,
      basedOnPathwayIds: ["anac-direct-awards", "reduced-competition-value"],
      deepenHref: anac.deepenHref,
      deepenLabel: "Apri gli appalti ANAC",
      metric: {
        label: "Affidamenti diretti (su n. procedure)",
        display: `${anac2025.byNumber.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
        hint: `Sul valore: ${anac2025.byValue.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`,
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
          label: "Ridotta concorrenza (valore)",
          value: Math.min(100, (reducedCompetition.value / anac2025.totalValueBillion) * 100),
          display: formatBillion(reducedCompetition.value, 1),
        },
      ],
      chartCaption: "ANAC 2025: quote e perimetro a ridotta concorrenza (scale diverse, lettura descrittiva)",
    },
    {
      id: "ai-municipal-profiles",
      priority: 4,
      title: "Priorità ai Comuni con profilo spesa alta / servizi bassi",
      concerns: "Profili OpenCivitas dei Comuni: spesa storica alta rispetto a servizi bassi.",
      operation:
        "L'agente costruisce una coda di lettura sui Comuni del profilo spesa alta / servizi bassi e chiede il confronto con pari e con i livelli di servizio prima di ipotesi locali.",
      effect:
        "Gli interventi locali partono dai casi dove spesa e servizi divergono di più, senza trasformare lo screening in una classifica di colpe.",
      why: oc.observation,
      basedOnPathwayIds: ["opencivitas-high-low", "opencivitas-outliers"],
      deepenHref: oc.deepenHref,
      deepenLabel: "Apri il confronto OpenCivitas",
      metric: {
        label: "Comuni nel profilo",
        display: highLow.municipalities.toLocaleString("it-IT"),
        hint: `su ${quadrants.completeMunicipalities.toLocaleString("it-IT")} con livelli completi`,
      },
      bars: [
        {
          label: "Spesa alta / servizi bassi",
          value: highLow.municipalities,
          display: highLow.municipalities.toLocaleString("it-IT"),
        },
        {
          label: "Altri profili completi",
          value: otherMunicipalities,
          display: otherMunicipalities.toLocaleString("it-IT"),
        },
      ],
      chartCaption: `OpenCivitas ${openCivitasSnapshot.referenceYear}: conteggio Comuni (profilo descrittivo)`,
    },
    {
      id: "ai-health-mix",
      priority: 5,
      title: "Riequilibrare il mix sanitario interno / esterno",
      concerns: "Costi di produzione SSN, servizi acquistati e personale sanitario esterno.",
      operation:
        "L'agente monitora il peso dei servizi acquistati e della spesa per personale esterno, li confronta con le assunzioni stabili e propone solo simulazioni di riequilibrio.",
      effect:
        "Si vede dove il mix interno/esterno pesa di più; eventuali scelte restano cliniche e di bilancio, non tagli automatici ai servizi.",
      why: ssn.observation,
      basedOnPathwayIds: ["ssn-production-costs", "healthcare-external-staff"],
      deepenHref: ssn.deepenHref,
      deepenLabel: "Apri la sanità",
      metric: {
        label: "Servizi acquistati sul costo di produzione",
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
          label: "Resto dei costi di produzione",
          value: Math.max(0, productionCostsCents - purchasedServicesCents),
          display: formatBillionFromCents(Math.max(0, productionCostsCents - purchasedServicesCents)),
        },
      ],
      chartCaption: "Composizione del costo di produzione SSN (aggregato nazionale selezionato)",
    },
    {
      id: "ai-consulting-and-collection",
      priority: 6,
      title: "Rivedere consulenze ripetute e stock di riscossione",
      concerns: "Pagamenti di consulenza RGS per amministrazione e stock nominale della riscossione.",
      operation:
        "L'agente confronta le amministrazioni con i pagamenti di consulenza più alti e tiene separato lo stock della riscossione dal gettito annuale, proponendo audit contabili e piani di recupero verificabili.",
      effect:
        "Si riduce la confusione tra flussi e stock: le consulenze si leggono per andamento, la riscossione resta un credito nominale da non trattare come tesoretto.",
      why: `${consult.observation} ${collection.observation}`,
      basedOnPathwayIds: ["rgs-consulting", "collection-stock"],
      deepenHref: consult.deepenHref,
      deepenLabel: "Apri le consulenze",
      metric: {
        label: "Stock riscossione (nominale)",
        display: formatBillion(collectionSignal.value, 1),
        hint: "Non è un tesoretto disponibile",
      },
      bars: consultTop.map((row) => ({
        label: shortAdminLabel(row.administration),
        value: row.paidCashCents / consultMax,
        display: formatMillionFromCents(row.paidCashCents),
      })),
      chartCaption: `Top ${consultTop.length} amministrazioni per pagamenti di consulenza (${consultYear})`,
    },
    {
      id: "ai-publish-hypothesis",
      priority: 7,
      title: "Pubblicare solo ipotesi con assunzioni esplicite",
      concerns: "Scenario centrale di miglioramento e sue componenti dichiarate.",
      operation:
        `L'agente usa lo scenario centrale (${formatBillion(centralScenario.annualBillion, 2)}/anno) solo come ordine di grandezza, con assunzioni visibili, e vieta di presentarlo come risparmio già disponibile.`,
      effect:
        "Il pubblico vede un'ipotesi di policy con formula e limiti: utile al dibattito, non confondibile con soldi già in cassa.",
      why: scenario.observation,
      basedOnPathwayIds: ["improvement-hypothesis"],
      deepenHref: scenario.deepenHref,
      deepenLabel: "Apri gli scenari",
      metric: {
        label: "Scenario centrale (ipotesi/anno)",
        display: formatBillion(centralScenario.annualBillion, 2),
        hint: "Ipotesi di policy, non previsione",
      },
      bars: centralScenarioBreakdown.map((row) => ({
        label: shortAdminLabel(row.label, 42),
        value: row.value / scenarioMax,
        display: formatBillion(row.value, 2),
      })),
      chartCaption: "Scomposizione dello scenario centrale (quote assunte, non risparmi certi)",
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
  title: "Agenda gestita da agenti AI",
  subtitle: "Cosa farebbe un agente se dovesse orientare spese e leggi dello Stato",
  lead:
    "Questa fascia è separata di proposito: non è il continuo dei 15 percorsi. È un'agenda deterministica etichettata come AI, non parere del Governo, non modello live e non sostituto delle scelte democratiche. Ogni priorità usa solo i numeri già mostrati sopra.",
  allowed: auditMethodology.aiUse.allowed,
  prohibited: auditMethodology.aiUse.prohibited,
} as const;
