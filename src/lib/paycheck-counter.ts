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
  TFR_DIVISOR,
  employerChargeDrafts,
  inailPresetById,
  parseEmployerProfileId,
  parseInailPresetId,
  type EmployerProfileId,
  type InailPresetId,
} from "@/lib/paycheck-employer";
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

export type PaycheckEmployerLine = {
  key: string;
  label: string;
  /** Statutory rate on the line base (INPS imponibile or full RAL). */
  rate: number;
  annualCents: number;
  monthlyCents: number;
  base: "inps" | "gross";
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
  employerProfileId: EmployerProfileId;
  employerProfileLabel: string;
  inailPresetId: InailPresetId;
  inailPerMille: number;
  /** True when RAL is above the 2026 INPS contribution ceiling. */
  inpsBaseCapped: boolean;
  inpsBaseCents: number;
  employerCharges: readonly PaycheckEmployerLine[];
  /** INPS + INAIL + TFR, per cedolino. Does not include gross pay. */
  monthlyEmployerCents: number;
  annualEmployerCents: number;
  /** Gross pay plus employer charges. */
  monthlyCompanyCostCents: number;
  annualCompanyCostCents: number;
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

export function formatPaycheckRate(rate: number): string {
  return `${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
  employerProfileId?: EmployerProfileId | string;
  inailPresetId?: InailPresetId | string;
}): PaycheckComputation {
  const annualGrossCents = eurosToCents(clampAnnualGross(input.annualGrossEur));
  const payMonths = parsePaycheckMonths(input.payMonths ?? PAYCHECK_DEFAULT_MONTHS);
  const monthlyGrossCents = Math.round(annualGrossCents / payMonths);
  const { region } = input;
  const employeeSscRate = Math.max(0, input.employeeSscRate ?? EMPLOYEE_SSC_RATE);
  const hasPublishedSchedule = Boolean(REGIONAL_SURTAX_BY_CODE[region.code]);
  const employerProfileId = parseEmployerProfileId(input.employerProfileId);
  const inailPresetId = parseInailPresetId(input.inailPresetId);

  const annualGrossEur = centsToEuros(annualGrossCents);
  const employerDraft = employerChargeDrafts({
    annualGrossEur,
    profileId: employerProfileId,
    inailPerMille: inailPresetById(inailPresetId).perMille,
  });
  const inpsBaseEur = employerDraft.inpsBaseEur;
  const annualSscEur = inpsBaseEur * employeeSscRate;
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

  const employerCharges: PaycheckEmployerLine[] = employerDraft.lines.map((line) => {
    const annualCents = eurosToCents(line.annualEur);
    return {
      key: line.key,
      label: line.label,
      rate: line.rate,
      annualCents,
      monthlyCents: Math.round(annualCents / payMonths),
      base: line.base,
    };
  });
  const tfrFinancing = employerCharges.find((row) => row.key === "tfrFinancing");
  const tfrAccrual = employerCharges.find((row) => row.key === "tfrAccrual");
  if (tfrFinancing && tfrAccrual) {
    const tfrTotalCents = eurosToCents(annualGrossEur / TFR_DIVISOR);
    tfrAccrual.annualCents = Math.max(0, tfrTotalCents - tfrFinancing.annualCents);
    tfrAccrual.monthlyCents = Math.round(tfrAccrual.annualCents / payMonths);
  }
  const annualEmployerCents = employerCharges.reduce((sum, row) => sum + row.annualCents, 0);
  const monthlyEmployerCents = employerCharges.reduce((sum, row) => sum + row.monthlyCents, 0);
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
    employerProfileId,
    employerProfileLabel: employerDraft.profile.label,
    inailPresetId,
    inailPerMille: employerDraft.inailPerMille,
    inpsBaseCapped: employerDraft.capped,
    inpsBaseCents: eurosToCents(inpsBaseEur),
    employerCharges,
    monthlyEmployerCents,
    annualEmployerCents,
    monthlyCompanyCostCents: monthlyGrossCents + monthlyEmployerCents,
    annualCompanyCostCents: annualGrossCents + annualEmployerCents,
    missions,
    otherMissionsCents,
    otherMissionsShare: otherShare,
  };
}

/** Column chart window: every step is drawn, with no series filter. */
export const PAYCHECK_CURVE_MIN_ANNUAL_EUR = 5_000;
export const PAYCHECK_CURVE_MAX_ANNUAL_EUR = 100_000;
export const PAYCHECK_CURVE_STEP_EUR = 5_000;

export type PaycheckCurvePoint = {
  annualGrossEur: number;
  /** Annual net: monthly net × number of paychecks. */
  annualNetEur: number;
  monthlyNetEur: number;
  /** INPS + INAIL + TFR paid or accrued by the employer. Excludes gross pay. */
  employerAnnualEur: number;
  /** Annual gross plus employer charges. */
  companyAnnualEur: number;
  isCurrent: boolean;
};

/** Fixed 5.000 € steps from 5.000 € through 100.000 €. The entered RAL is not inserted off-grid. */
export function paycheckCurveAnnualGrid(): number[] {
  const values: number[] = [];
  for (
    let value = PAYCHECK_CURVE_MIN_ANNUAL_EUR;
    value <= PAYCHECK_CURVE_MAX_ANNUAL_EUR;
    value += PAYCHECK_CURVE_STEP_EUR
  ) {
    values.push(value);
  }
  return values;
}

type PaycheckSolveInput = {
  region: PaycheckRegionRates;
  missions: readonly PaycheckMissionShare[];
  payMonths?: PaycheckMonthCount | number;
  employerProfileId?: EmployerProfileId | string;
  inailPresetId?: InailPresetId | string;
};

function netCentsAtGross(
  annualGrossEur: number,
  input: PaycheckSolveInput,
  kind: "monthly" | "annual",
): number {
  const point = computePaycheck({ ...input, annualGrossEur });
  return kind === "monthly" ? point.monthlyNetCents : point.monthlyNetCents * point.payMonths;
}

/** Smallest annual gross whose net is closest to the target. Net rises with gross. */
function solveAnnualGrossForNetCents(
  targetCents: number,
  input: PaycheckSolveInput,
  kind: "monthly" | "annual",
): number {
  const target = Math.max(0, Math.round(targetCents));
  let low = PAYCHECK_MIN_ANNUAL_GROSS_EUR;
  let high = PAYCHECK_MAX_ANNUAL_GROSS_EUR;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (netCentsAtGross(mid, input, kind) < target) low = mid + 1;
    else high = mid;
  }
  const previous = Math.max(PAYCHECK_MIN_ANNUAL_GROSS_EUR, low - 1);
  const atLow = netCentsAtGross(low, input, kind);
  const atPrevious = netCentsAtGross(previous, input, kind);
  return Math.abs(atPrevious - target) <= Math.abs(atLow - target) ? previous : low;
}

export function solveAnnualGrossForMonthlyNetEur(
  input: PaycheckSolveInput & { targetMonthlyNetEur: number },
): number {
  return solveAnnualGrossForNetCents(eurosToCents(input.targetMonthlyNetEur), input, "monthly");
}

export function solveAnnualGrossForAnnualNetEur(
  input: PaycheckSolveInput & { targetAnnualNetEur: number },
): number {
  return solveAnnualGrossForNetCents(eurosToCents(input.targetAnnualNetEur), input, "annual");
}

/** Annual gross, net, employer charges and company cost along a RAL grid. */
export function buildPaycheckCurve(input: {
  annualGrossEur: number;
  region: PaycheckRegionRates;
  missions: readonly PaycheckMissionShare[];
  payMonths?: PaycheckMonthCount | number;
  employerProfileId?: EmployerProfileId | string;
  inailPresetId?: InailPresetId | string;
}): PaycheckCurvePoint[] {
  const currentAnnual = clampAnnualGross(input.annualGrossEur);
  return paycheckCurveAnnualGrid().map((annualGrossEur) => {
    const point = computePaycheck({
      annualGrossEur,
      region: input.region,
      missions: input.missions,
      payMonths: input.payMonths,
      employerProfileId: input.employerProfileId,
      inailPresetId: input.inailPresetId,
    });
    return {
      annualGrossEur,
      annualNetEur: centsToEuros(point.monthlyNetCents * point.payMonths),
      monthlyNetEur: centsToEuros(point.monthlyNetCents),
      employerAnnualEur: centsToEuros(point.annualEmployerCents),
      companyAnnualEur: centsToEuros(point.annualCompanyCostCents),
      isCurrent: annualGrossEur === currentAnnual,
    };
  });
}
