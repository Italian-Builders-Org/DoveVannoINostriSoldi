/**
 * Paycheck counter: illustrative monthly breakdown from annual gross pay.
 *
 * Tax year 2026 rules: IRPEF brackets + employment deduction, ordinary private
 * employee SSC (9.19%), regional surtax from MEF 2026 schedules (all regions),
 * municipal MEF average on taxable. Mission shares allocate only state IRPEF
 * illustratively (OpenBDAP A1). Monthly figures divide annual totals by the
 * chosen number of paychecks (12 / 13 / 14).
 */

import {
  EMPLOYEE_SSC_RATE,
  PAYCHECK_DEFAULT_MONTHS,
  PAYCHECK_TAX_YEAR,
  REGIONAL_SURTAX_BY_CODE,
  irpefNetEur,
  parsePaycheckMonths,
  regionalSurtaxForCode,
  type PaycheckMonthCount,
} from "@/lib/paycheck-tax-rules";

export const PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR = 30_000;
export const PAYCHECK_MIN_ANNUAL_GROSS_EUR = 5_000;
export const PAYCHECK_MAX_ANNUAL_GROSS_EUR = 500_000;
export const PAYCHECK_TOP_MISSIONS = 8;
export {
  PAYCHECK_TAX_YEAR,
  EMPLOYEE_SSC_RATE,
  PAYCHECK_DEFAULT_MONTHS,
  parsePaycheckMonths,
};
export type { PaycheckMonthCount };

export type PaycheckRegionRates = {
  code: string;
  name: string;
  /**
   * MEF fallback: regionalSurtaxDue / taxableIncome.
   * Used only when the region has no published 2026 schedule in-code.
   */
  effectiveRegionalSurtaxRate: number;
  /** MEF municipalSurtaxDue / taxableIncome (regional average). */
  effectiveMunicipalSurtaxRate: number;
  /** True when regional surtax uses the published 2026 MEF schedule. */
  regionalSchedule: "published-2026" | "mef-average";
};

export type PaycheckMissionShare = {
  mission: string;
  label: string;
  share: number;
};

export type PaycheckDeductionLine = {
  key: "irpef" | "regionalSurtax" | "municipalSurtax" | "employeeSsc";
  label: string;
  monthlyCents: number;
  /** Share of monthly gross, for display only. */
  rate: number;
};

export type PaycheckMissionLine = {
  mission: string;
  label: string;
  share: number;
  monthlyCents: number;
};

export type PaycheckComputation = {
  annualGrossCents: number;
  monthlyGrossCents: number;
  annualTaxableCents: number;
  payMonths: PaycheckMonthCount;
  region: PaycheckRegionRates;
  employeeSscRate: number;
  taxYear: typeof PAYCHECK_TAX_YEAR;
  deductions: readonly PaycheckDeductionLine[];
  totalDeductionsCents: number;
  monthlyNetCents: number;
  monthlyTaxCents: number;
  monthlyStateIrpefCents: number;
  missions: readonly PaycheckMissionLine[];
  otherMissionsCents: number;
  otherMissionsShare: number;
};

function clampAnnualGross(value: number): number {
  if (!Number.isFinite(value)) return PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR;
  const rounded = Math.round(value);
  return Math.min(
    PAYCHECK_MAX_ANNUAL_GROSS_EUR,
    Math.max(PAYCHECK_MIN_ANNUAL_GROSS_EUR, rounded),
  );
}

export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

export function centsToEuros(cents: number): number {
  return cents / 100;
}

export function formatPaycheckEuro(cents: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(centsToEuros(cents));
}

export function formatPaycheckPercent(rate: number): string {
  return `${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rate * 100)}%`;
}

export function parsePaycheckAnnualGross(raw: unknown): number {
  if (typeof raw === "number") return clampAnnualGross(raw);
  if (typeof raw === "string") {
    const normalized = raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    return clampAnnualGross(Number(normalized));
  }
  return PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR;
}

function displayRate(amountCents: number, monthlyGrossCents: number): number {
  if (!(monthlyGrossCents > 0)) return 0;
  return amountCents / monthlyGrossCents;
}

function regionalSurtaxAnnualEur(taxableEur: number, region: PaycheckRegionRates): number {
  const published = regionalSurtaxForCode(taxableEur, region.code);
  if (published != null) return published;
  return Math.max(0, taxableEur * region.effectiveRegionalSurtaxRate);
}

export function computePaycheck(input: {
  annualGrossEur: number;
  region: PaycheckRegionRates;
  missions: readonly PaycheckMissionShare[];
  /** Number of paychecks the RAL is split into (12 / 13 / 14). */
  payMonths?: PaycheckMonthCount | number;
  /** Override only for tests; default is the ordinary private-sector IVS share. */
  employeeSscRate?: number;
}): PaycheckComputation {
  const annualGrossCents = eurosToCents(clampAnnualGross(input.annualGrossEur));
  const payMonths = parsePaycheckMonths(input.payMonths ?? PAYCHECK_DEFAULT_MONTHS);
  const monthlyGrossCents = Math.round(annualGrossCents / payMonths);
  const { region } = input;
  const employeeSscRate = Math.max(0, input.employeeSscRate ?? EMPLOYEE_SSC_RATE);
  const hasPublishedSchedule = Boolean(REGIONAL_SURTAX_BY_CODE[region.code]);

  const annualGrossEur = centsToEuros(annualGrossCents);
  const annualSscEur = annualGrossEur * employeeSscRate;
  const annualTaxableEur = Math.max(0, annualGrossEur - annualSscEur);
  const annualTaxableCents = eurosToCents(annualTaxableEur);

  const annualIrpefEur = irpefNetEur(annualTaxableEur);
  const annualRegionalEur = regionalSurtaxAnnualEur(annualTaxableEur, region);
  const annualMunicipalEur = Math.max(0, annualTaxableEur * region.effectiveMunicipalSurtaxRate);

  const monthlyIrpefCents = Math.round(eurosToCents(annualIrpefEur) / payMonths);
  const monthlyRegionalCents = Math.round(eurosToCents(annualRegionalEur) / payMonths);
  const monthlyMunicipalCents = Math.round(eurosToCents(annualMunicipalEur) / payMonths);
  const monthlySscCents = Math.round(eurosToCents(annualSscEur) / payMonths);

  const regionalLabel = hasPublishedSchedule
    ? "Addizionale regionale (scaglioni MEF 2026)"
    : "Addizionale regionale (media effettiva MEF)";

  const deductions: PaycheckDeductionLine[] = [
    {
      key: "irpef",
      label: `IRPEF ${PAYCHECK_TAX_YEAR} (scaglioni + detrazione lavoro dipendente)`,
      monthlyCents: monthlyIrpefCents,
      rate: displayRate(monthlyIrpefCents, monthlyGrossCents),
    },
    {
      key: "regionalSurtax",
      label: regionalLabel,
      monthlyCents: monthlyRegionalCents,
      rate: displayRate(monthlyRegionalCents, monthlyGrossCents),
    },
    {
      key: "municipalSurtax",
      label: "Addizionale comunale (media regionale MEF)",
      monthlyCents: monthlyMunicipalCents,
      rate: displayRate(monthlyMunicipalCents, monthlyGrossCents),
    },
    {
      key: "employeeSsc",
      label: "Contributi lavoratore (INPS IVS ordinario ≈ 9,19%)",
      monthlyCents: monthlySscCents,
      rate: employeeSscRate,
    },
  ];

  const totalDeductionsCents = deductions.reduce((sum, row) => sum + row.monthlyCents, 0);
  const monthlyNetCents = Math.max(0, monthlyGrossCents - totalDeductionsCents);
  const monthlyTaxCents = monthlyIrpefCents + monthlyRegionalCents + monthlyMunicipalCents;
  const monthlyStateIrpefCents = monthlyIrpefCents;

  const sortedMissions = [...input.missions]
    .filter((row) => row.share > 0)
    .sort((left, right) => right.share - left.share);

  const top = sortedMissions.slice(0, PAYCHECK_TOP_MISSIONS);
  const topShare = top.reduce((sum, row) => sum + row.share, 0);
  const otherShare = Math.max(0, 1 - topShare);

  const missions: PaycheckMissionLine[] = top.map((row) => ({
    mission: row.mission,
    label: row.label,
    share: row.share,
    monthlyCents: Math.round(monthlyStateIrpefCents * row.share),
  }));

  const allocated = missions.reduce((sum, row) => sum + row.monthlyCents, 0);
  const otherMissionsCents = Math.max(0, monthlyStateIrpefCents - allocated);

  return {
    annualGrossCents,
    monthlyGrossCents,
    annualTaxableCents,
    payMonths,
    region: {
      ...region,
      regionalSchedule: hasPublishedSchedule ? "published-2026" : "mef-average",
    },
    employeeSscRate,
    taxYear: PAYCHECK_TAX_YEAR,
    deductions,
    totalDeductionsCents,
    monthlyNetCents,
    monthlyTaxCents,
    monthlyStateIrpefCents,
    missions,
    otherMissionsCents,
    otherMissionsShare: otherShare,
  };
}
