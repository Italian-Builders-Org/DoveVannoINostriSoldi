import { shortLabel } from "@/app/spese/legge-di-bilancio/reallocation";
import { getBudgetLawMissionSeries } from "@/lib/bdap-legge-bilancio";
import { MEF_IRPEF_TAX_YEAR } from "@/lib/data/mef-irpef-contract";
import { queryMefMunicipalIrpef, type ReportedMeasure } from "@/lib/mef-irpef-snapshot";
import {
  PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR,
  type PaycheckMissionShare,
  type PaycheckRegionRates,
} from "@/lib/paycheck-counter";
import { getTaxWedgeView } from "@/lib/tax-wedge";

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
    netTaxDeclared?: ReportedMeasure;
    regionalSurtaxDue?: ReportedMeasure;
    municipalSurtaxDue?: ReportedMeasure;
  },
): PaycheckRegionRates | null {
  const irpef = rateAgainstTaxable(measures.netTaxDeclared, measures.taxableIncome);
  const regional = rateAgainstTaxable(measures.regionalSurtaxDue, measures.taxableIncome);
  const municipal = rateAgainstTaxable(measures.municipalSurtaxDue, measures.taxableIncome);
  if (irpef == null || regional == null || municipal == null) return null;
  return {
    code,
    name,
    effectiveIrpefRate: irpef,
    effectiveRegionalSurtaxRate: regional,
    effectiveMunicipalSurtaxRate: municipal,
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
  regions: readonly PaycheckRegionRates[];
  employeeSscRate: number;
  employeeSscYear: number;
  missions: readonly PaycheckMissionShare[];
  budgetYear: number | null;
  irpefTaxYear: typeof MEF_IRPEF_TAX_YEAR;
  provenance: {
    irpefSourceUrl: string;
    oecdSourceUrl: string;
    budgetLabel: string;
  };
  caveats: readonly string[];
};

export async function getPaycheckCounterView(): Promise<PaycheckCounterView> {
  const irpef = queryMefMunicipalIrpef({ level: "region", limit: 100, detail: "summary" });
  const taxWedge = getTaxWedgeView();

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

  let budgetYear: number | null = null;
  let missions: PaycheckMissionShare[] = [];
  let budgetLabel = "OpenBDAP Legge di Bilancio (snapshot)";

  try {
    const series = await getBudgetLawMissionSeries({
      allowSnapshot: true,
      windowYears: 2,
      fallbackOnAbort: true,
    });
    budgetYear = series.years.at(-1) ?? null;
    if (budgetYear != null) {
      missions = missionSharesFromBudget(series.allocations, budgetYear);
      budgetLabel = `OpenBDAP Legge di Bilancio ${budgetYear} (competenza A1)`;
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
    regions,
    // OECD Taxing Wages view exposes percentages (e.g. 9.49), not unit fractions.
    employeeSscRate: taxWedge.latest.employeeSsc / 100,
    employeeSscYear: taxWedge.latest.year,
    missions,
    budgetYear,
    irpefTaxYear: MEF_IRPEF_TAX_YEAR,
    provenance: {
      irpefSourceUrl: irpef.provenance.source.landingUrl,
      oecdSourceUrl: taxWedge.metadata.source.landingUrl,
      budgetLabel,
    },
    caveats: [
      "Stima illustrativa: non è la busta paga di una persona reale né un calcolo CAF.",
      `Aliquote IRPEF e addizionali: medie effettive MEF anno d'imposta ${MEF_IRPEF_TAX_YEAR} (imposta / reddito imponibile) per Regione, non scaglioni individuali.`,
      `Contributi lavoratore: quota OECD Taxing Wages ${taxWedge.latest.year} sul profilo single al 100% del salario medio, applicata al lordo inserito.`,
      "La ripartizione sulle missioni usa solo l'IRPEF erariale e le quote di stanziamento della Legge di Bilancio (OpenBDAP, competenza A1): non è cassa, non è un vincolo di destinazione e non include addizionali né contributi.",
      "L'addizionale comunale è la media regionale MEF (per alcune Regioni sui soli comuni non oscurati): il comune di domicilio può discostarsi.",
      "Le aliquote MEF sono medie effettive su tutti i contribuenti della Regione (imposta / imponibile), applicate al lordo inserito: per un reddito tipico da lavoro dipendente l'IRPEF personale può risultare diversa.",
    ],
  };
}
