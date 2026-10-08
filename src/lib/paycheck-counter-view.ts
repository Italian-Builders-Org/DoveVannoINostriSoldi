import { shortLabel } from "@/app/spese/legge-di-bilancio/reallocation";
import { getCommittedBudgetLawMissionSeries } from "@/lib/bdap-legge-bilancio";
import { MEF_IRPEF_TAX_YEAR } from "@/lib/data/mef-irpef-contract";
import { queryMefMunicipalIrpef, type ReportedMeasure } from "@/lib/mef-irpef-snapshot";
import {
  PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR,
  PAYCHECK_DEFAULT_MONTHS,
  type PaycheckMissionShare,
  type PaycheckRegionRates,
} from "@/lib/paycheck-counter";
import {
  EMPLOYEE_SSC_RATE,
  PAYCHECK_MONTH_OPTIONS,
  PAYCHECK_TAX_YEAR,
  REGIONAL_SURTAX_BY_CODE,
} from "@/lib/paycheck-tax-rules";

/**
 * Prefer complete amounts; for partial MEF cells use the known (non-suppressed)
 * amount so regional averages still cover all 20 regions when municipal surtax
 * has a few obscured municipalities.
 */
function usableAmountCents(measure: ReportedMeasure | undefined): number | null {
  if (!measure) return null;
  if (measure.coverage === "complete") {
    if (!Number.isInteger(measure.amountCents) || measure.amountCents < 0) return null;
    return measure.amountCents;
  }
  if (!Number.isInteger(measure.knownAmountCents) || measure.knownAmountCents < 0) return null;
  return measure.knownAmountCents;
}

function rateAgainstTaxable(
  numerator: ReportedMeasure | undefined,
  taxable: ReportedMeasure | undefined,
): number | null {
  const taxableCents = usableAmountCents(taxable);
  const numeratorCents = usableAmountCents(numerator);
  if (taxableCents == null || numeratorCents == null || taxableCents === 0) return null;
  return numeratorCents / taxableCents;
}

function buildRegionRates(
  code: string,
  name: string,
  measures: {
    taxableIncome?: ReportedMeasure;
    regionalSurtaxDue?: ReportedMeasure;
    municipalSurtaxDue?: ReportedMeasure;
  },
): PaycheckRegionRates | null {
  const regional = rateAgainstTaxable(measures.regionalSurtaxDue, measures.taxableIncome);
  const municipal = rateAgainstTaxable(measures.municipalSurtaxDue, measures.taxableIncome);
  if (regional == null || municipal == null) return null;
  const hasPublished = Boolean(REGIONAL_SURTAX_BY_CODE[code]);
  return {
    code,
    name,
    effectiveRegionalSurtaxRate: regional,
    effectiveMunicipalSurtaxRate: municipal,
    regionalSchedule: hasPublished ? "published-2026" : "mef-average",
  };
}

function missionSharesFromBudget(
  allocations: readonly { year: number; mission: string; amountEur: number }[],
  year: number,
): PaycheckMissionShare[] {
  const forYear = allocations.filter((row) => row.year === year && row.amountEur > 0);
  const total = forYear.reduce((sum, row) => sum + row.amountEur, 0);
  if (!(total > 0)) return [];
  return forYear
    .map((row) => ({
      mission: row.mission,
      label: shortLabel(row.mission),
      share: row.amountEur / total,
    }))
    .sort((left, right) => right.share - left.share);
}

export type PaycheckCounterView = {
  defaultAnnualGrossEur: number;
  defaultRegionCode: string;
  defaultPayMonths: typeof PAYCHECK_DEFAULT_MONTHS;
  payMonthOptions: typeof PAYCHECK_MONTH_OPTIONS;
  regions: readonly PaycheckRegionRates[];
  employeeSscRate: number;
  taxYear: typeof PAYCHECK_TAX_YEAR;
  missions: readonly PaycheckMissionShare[];
  budgetYear: number | null;
  mefIrpefTaxYear: typeof MEF_IRPEF_TAX_YEAR;
  provenance: {
    irpefSourceUrl: string;
    budgetLabel: string;
    regionalSurtaxLabel: string;
  };
  caveats: readonly string[];
};

export async function getPaycheckCounterView(): Promise<PaycheckCounterView> {
  const irpef = queryMefMunicipalIrpef({ level: "region", limit: 100, detail: "summary" });

  const regions: PaycheckRegionRates[] = [];
  for (const row of irpef.data) {
    if (row.territory.level !== "region") continue;
    const rates = buildRegionRates(row.territory.code, row.territory.name, row.measures);
    if (rates) regions.push(rates);
  }
  regions.sort((left, right) => left.name.localeCompare(right.name, "it-IT"));

  if (regions.length === 0) {
    throw new Error("Paycheck counter: nessuna regione MEF IRPEF con misure complete.");
  }

  const missingSchedules = regions.filter((row) => !REGIONAL_SURTAX_BY_CODE[row.code]);
  if (missingSchedules.length > 0) {
    throw new Error(
      `Paycheck counter: scaglioni regionali 2026 mancanti per ${missingSchedules
        .map((row) => row.code)
        .join(", ")}.`,
    );
  }

  // Snapshot-only: the paycheck counter is illustrative and must stay offline-safe
  // (no live OpenBDAP refresh at request time).
  let budgetYear: number | null = null;
  let missions: PaycheckMissionShare[] = [];
  let budgetLabel = "OpenBDAP Legge di Bilancio (snapshot)";

  try {
    const series = getCommittedBudgetLawMissionSeries(2);
    budgetYear = series.years.at(-1) ?? null;
    if (budgetYear != null) {
      missions = missionSharesFromBudget(series.allocations, budgetYear);
      budgetLabel = `OpenBDAP Legge di Bilancio ${budgetYear} (competenza A1, snapshot)`;
    }
  } catch {
    missions = [];
    budgetYear = null;
  }

  const lombardia = regions.find((row) => /lombardia/i.test(row.name));
  const defaultRegionCode = lombardia?.code ?? regions[0].code;

  return {
    defaultAnnualGrossEur: PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR,
    defaultRegionCode,
    defaultPayMonths: PAYCHECK_DEFAULT_MONTHS,
    payMonthOptions: PAYCHECK_MONTH_OPTIONS,
    regions,
    employeeSscRate: EMPLOYEE_SSC_RATE,
    taxYear: PAYCHECK_TAX_YEAR,
    missions,
    budgetYear,
    mefIrpefTaxYear: MEF_IRPEF_TAX_YEAR,
    provenance: {
      irpefSourceUrl: irpef.provenance.source.landingUrl,
      budgetLabel,
      regionalSurtaxLabel: `Addizionale regionale MEF anno d'imposta ${PAYCHECK_TAX_YEAR}`,
    },
    caveats: [
      "Stima illustrativa: non è la busta paga di una persona reale né un calcolo CAF.",
      `IRPEF ${PAYCHECK_TAX_YEAR}: scaglioni statutari (23% / 33% / 43%) e detrazione per lavoro dipendente (art. 13 TUIR), su imponibile dopo contributi. Nessun familiare a carico, nessun altro credito o bonus.`,
      "Contributi lavoratore: quota IVS ordinaria del settore privato ≈ 9,19% sul lordo.",
      "Mensilità: la RAL resta annuale; 12/13/14 cambia solo come si ripartisce il netto medio per cedolino (tasse e contributi restano sul reddito annuo).",
      `Addizionale regionale: scaglioni e aliquote pubblicati dal Dipartimento delle Finanze per il ${PAYCHECK_TAX_YEAR} (con soglie preferenziali Lazio, Umbria, FVG, Valle d'Aosta). Trentino-Alto Adige usa le bande comuni delle Province autonome, senza esenzioni/detrazioni provinciali.`,
      `Addizionale comunale: media regionale MEF anno d'imposta ${MEF_IRPEF_TAX_YEAR} (per alcune Regioni sui soli comuni non oscurati): il comune di domicilio può discostarsi.`,
      "La ripartizione sulle missioni usa solo l'IRPEF erariale e le quote di stanziamento della Legge di Bilancio (OpenBDAP, competenza A1): è statistica illustrativa, non cassa né vincolo di destinazione delle tue imposte, e non include addizionali né contributi.",
      "La mappa confronta il netto per cedolino a parità di RAL e mensilità: le differenze tra Regioni dipendono solo dalle addizionali (regionale a scaglioni MEF e comunale come media regionale).",
    ],
  };
}
