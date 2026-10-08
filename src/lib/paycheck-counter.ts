/**
 * Paycheck counter: illustrative monthly breakdown from annual gross pay.
 *
 * Uses MEF regional effective average rates (dichiarato / imponibile), OECD
 * employee SSC on gross for the Taxing Wages average-earner profile, and
 * OpenBDAP Legge di Bilancio mission shares for "where the tax goes".
 * Not a personal tax return and not cash payments.
 */

export const PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR = 30_000;
export const PAYCHECK_MIN_ANNUAL_GROSS_EUR = 5_000;
export const PAYCHECK_MAX_ANNUAL_GROSS_EUR = 500_000;
export const PAYCHECK_TOP_MISSIONS = 8;

export type PaycheckRegionRates = {
  code: string;
  name: string;
  /** netTaxDeclared / taxableIncome (MEF regional average). */
  effectiveIrpefRate: number;
  /** regionalSurtaxDue / taxableIncome. */
  effectiveRegionalSurtaxRate: number;
  /** municipalSurtaxDue / taxableIncome (regional average of municipal dues). */
  effectiveMunicipalSurtaxRate: number;
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
  region: PaycheckRegionRates;
  employeeSscRate: number;
  deductions: readonly PaycheckDeductionLine[];
  totalDeductionsCents: number;
  monthlyNetCents: number;
  /** IRPEF + addizionali regionali e comunali. */
  monthlyTaxCents: number;
  /** Solo IRPEF erariale, base della ripartizione sulle missioni di bilancio. */
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

/**
 * Apply rate to monthly gross in cents with banker's-avoiding half-up via Math.round.
 */
function applyRate(monthlyGrossCents: number, rate: number): number {
  if (!(rate > 0) || !Number.isFinite(rate)) return 0;
  return Math.round(monthlyGrossCents * rate);
}

export function computePaycheck(input: {
  annualGrossEur: number;
  region: PaycheckRegionRates;
  employeeSscRate: number;
  missions: readonly PaycheckMissionShare[];
}): PaycheckComputation {
  const annualGrossCents = eurosToCents(clampAnnualGross(input.annualGrossEur));
  const monthlyGrossCents = Math.round(annualGrossCents / 12);
  const { region } = input;
  const employeeSscRate = Math.max(0, input.employeeSscRate);

  const deductions: PaycheckDeductionLine[] = [
    {
      key: "irpef",
      label: "IRPEF (aliquota effettiva media regionale)",
      rate: region.effectiveIrpefRate,
      monthlyCents: applyRate(monthlyGrossCents, region.effectiveIrpefRate),
    },
    {
      key: "regionalSurtax",
      label: "Addizionale regionale",
      rate: region.effectiveRegionalSurtaxRate,
      monthlyCents: applyRate(monthlyGrossCents, region.effectiveRegionalSurtaxRate),
    },
    {
      key: "municipalSurtax",
      label: "Addizionale comunale (media regionale)",
      rate: region.effectiveMunicipalSurtaxRate,
      monthlyCents: applyRate(monthlyGrossCents, region.effectiveMunicipalSurtaxRate),
    },
    {
      key: "employeeSsc",
      label: "Contributi lavoratore (OECD, profilo tipo)",
      rate: employeeSscRate,
      monthlyCents: applyRate(monthlyGrossCents, employeeSscRate),
    },
  ];

  const totalDeductionsCents = deductions.reduce((sum, row) => sum + row.monthlyCents, 0);
  const monthlyNetCents = Math.max(0, monthlyGrossCents - totalDeductionsCents);
  /** IRPEF + addizionali: utile in sintesi, ma le missioni di bilancio usano solo l'IRPEF erariale. */
  const monthlyTaxCents =
    deductions[0].monthlyCents + deductions[1].monthlyCents + deductions[2].monthlyCents;
  /** Solo IRPEF erariale: le addizionali restano a Regione/Comune, non al bilancio per missione. */
  const monthlyStateIrpefCents = deductions[0].monthlyCents;

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
    monthlyCents: applyRate(monthlyStateIrpefCents, row.share),
  }));

  const allocated = missions.reduce((sum, row) => sum + row.monthlyCents, 0);
  const otherMissionsCents = Math.max(0, monthlyStateIrpefCents - allocated);

  return {
    annualGrossCents,
    monthlyGrossCents,
    region,
    employeeSscRate,
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
