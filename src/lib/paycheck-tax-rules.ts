/**
 * Statutory tax rules for the paycheck counter (tax year 2026).
 *
 * Sources:
 * - IRPEF brackets: Agenzia delle Entrate + L. 199/2025 (second rate 33%).
 * - Detrazione lavoro dipendente: art. 13 TUIR (as currently applied for employees).
 * - Employee SSC: ordinary private-sector IVS share ≈ 9.19% of gross.
 * - Regional surtax: Dipartimento delle Finanze schede addizionale regionale 2026
 *   (compiled from MEF publications; ISTAT region codes).
 *
 * Still illustrative: no dependents, no other deductions/credits, no bonus IRPEF /
 * trattamento integrativo edge cases. Trentino-Alto Adige uses the shared
 * provincial band floor (PA Trento/Bolzano differ on exemptions/detrazioni).
 */

export const PAYCHECK_TAX_YEAR = 2026 as const;

/** Ordinary private-sector employee IVS share on gross pay. */
export const EMPLOYEE_SSC_RATE = 0.0919;

export const PAYCHECK_MONTH_OPTIONS = [12, 13, 14] as const;
export type PaycheckMonthCount = (typeof PAYCHECK_MONTH_OPTIONS)[number];
export const PAYCHECK_DEFAULT_MONTHS: PaycheckMonthCount = 12;

/** IRPEF 2026 brackets (upper bound inclusive for the slice below next). */
export const IRPEF_BRACKETS_2026 = [
  { upToEur: 28_000, rate: 0.23 },
  { upToEur: 50_000, rate: 0.33 },
  { upToEur: Number.POSITIVE_INFINITY, rate: 0.43 },
] as const;

export type ProgressiveBand = {
  upToEur: number;
  rate: number;
};

/**
 * Regional surtax schedule.
 *
 * - `progressive`: marginal rates on each band (standard IRPEF-style).
 * - `flat`: single rate on the entire taxable income.
 * - Optional `underThreshold`: when taxable ≤ upToEur, apply flatRate on the
 *   entire income instead of the progressive/flat schedule above the threshold
 *   (FVG reduced rate, Lazio/Umbria whole-income preferential rate, VdA exemption).
 * - Optional `deduction`: subtract a fixed euro amount when taxable is in range.
 */
export type RegionalSurtaxSchedule = {
  bands: readonly ProgressiveBand[];
  underThreshold?: { upToEur: number; flatRate: number };
  deduction?: { fromEur: number; toEur: number; amountEur: number };
};

function flat(rate: number): RegionalSurtaxSchedule {
  return { bands: [{ upToEur: Number.POSITIVE_INFINITY, rate }] };
}

function progressive(bands: readonly ProgressiveBand[]): RegionalSurtaxSchedule {
  return { bands };
}

/**
 * Known 2026 regional schedules keyed by ISTAT region code (2 digits).
 * Source: MEF Dipartimento delle Finanze — schede addizionale regionale 2026.
 */
export const REGIONAL_SURTAX_BY_CODE: Readonly<Record<string, RegionalSurtaxSchedule>> = {
  // 01 Piemonte
  "01": progressive([
    { upToEur: 15_000, rate: 0.0162 },
    { upToEur: 28_000, rate: 0.0268 },
    { upToEur: 50_000, rate: 0.0331 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
  ]),
  // 02 Valle d'Aosta — esente ≤15k; altrimenti 1,23% sull'intero
  "02": {
    bands: [{ upToEur: Number.POSITIVE_INFINITY, rate: 0.0123 }],
    underThreshold: { upToEur: 15_000, flatRate: 0 },
  },
  // 03 Lombardia
  "03": progressive([
    { upToEur: 15_000, rate: 0.0123 },
    { upToEur: 28_000, rate: 0.0158 },
    { upToEur: 50_000, rate: 0.0172 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0173 },
  ]),
  // 04 Trentino-Alto Adige — bande comuni PA; senza esenzioni/detrazioni provinciali
  "04": progressive([
    { upToEur: 50_000, rate: 0.0123 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0173 },
  ]),
  // 05 Veneto
  "05": flat(0.0123),
  // 06 Friuli-Venezia Giulia — 0,70% se ≤15k sull'intero; altrimenti 1,23% sull'intero
  "06": {
    bands: [{ upToEur: Number.POSITIVE_INFINITY, rate: 0.0123 }],
    underThreshold: { upToEur: 15_000, flatRate: 0.007 },
  },
  // 07 Liguria
  "07": progressive([
    { upToEur: 28_000, rate: 0.0123 },
    { upToEur: 50_000, rate: 0.0318 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0323 },
  ]),
  // 08 Emilia-Romagna
  "08": progressive([
    { upToEur: 15_000, rate: 0.0133 },
    { upToEur: 28_000, rate: 0.0193 },
    { upToEur: 50_000, rate: 0.0278 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
  ]),
  // 09 Toscana
  "09": progressive([
    { upToEur: 15_000, rate: 0.0142 },
    { upToEur: 28_000, rate: 0.0143 },
    { upToEur: 50_000, rate: 0.0332 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
  ]),
  // 10 Umbria — ≤28k: 1,23% sull'intero; oltre: scaglioni + detrazione 150 tra 28.001 e 50.000
  "10": {
    bands: [
      { upToEur: 15_000, rate: 0.0173 },
      { upToEur: 28_000, rate: 0.0302 },
      { upToEur: 50_000, rate: 0.0312 },
      { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
    ],
    underThreshold: { upToEur: 28_000, flatRate: 0.0123 },
    deduction: { fromEur: 28_001, toEur: 50_000, amountEur: 150 },
  },
  // 11 Marche
  "11": progressive([
    { upToEur: 15_000, rate: 0.0123 },
    { upToEur: 28_000, rate: 0.0153 },
    { upToEur: 50_000, rate: 0.017 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0173 },
  ]),
  // 12 Lazio — ≤28k: 1,73% sull'intero; oltre: scaglioni + detrazione 60 tra 28.001 e 30.000
  "12": {
    bands: [
      { upToEur: 15_000, rate: 0.0173 },
      { upToEur: 28_000, rate: 0.0333 },
      { upToEur: 50_000, rate: 0.0333 },
      { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
    ],
    underThreshold: { upToEur: 28_000, flatRate: 0.0173 },
    deduction: { fromEur: 28_001, toEur: 30_000, amountEur: 60 },
  },
  // 13 Abruzzo
  "13": progressive([
    { upToEur: 28_000, rate: 0.0167 },
    { upToEur: 50_000, rate: 0.0287 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
  ]),
  // 14 Molise
  "14": progressive([
    { upToEur: 15_000, rate: 0.0173 },
    { upToEur: 28_000, rate: 0.0193 },
    { upToEur: 50_000, rate: 0.0333 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
  ]),
  // 15 Campania
  "15": progressive([
    { upToEur: 15_000, rate: 0.0173 },
    { upToEur: 28_000, rate: 0.0296 },
    { upToEur: 50_000, rate: 0.032 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0333 },
  ]),
  // 16 Puglia
  "16": progressive([
    { upToEur: 15_000, rate: 0.0133 },
    { upToEur: 28_000, rate: 0.0143 },
    { upToEur: 50_000, rate: 0.0163 },
    { upToEur: Number.POSITIVE_INFINITY, rate: 0.0185 },
  ]),
  // 17 Basilicata
  "17": flat(0.0123),
  // 18 Calabria
  "18": flat(0.0173),
  // 19 Sicilia
  "19": flat(0.0123),
  // 20 Sardegna
  "20": flat(0.0123),
};

/** @deprecated Use REGIONAL_SURTAX_BY_CODE — kept for callers that only need Lombardia bands. */
export const LOMBARDIA_REGIONAL_BANDS = REGIONAL_SURTAX_BY_CODE["03"].bands;

/** @deprecated Use REGIONAL_SURTAX_BY_CODE. */
export const REGIONAL_SURTAX_BANDS_BY_CODE: Readonly<
  Record<string, readonly ProgressiveBand[]>
> = Object.fromEntries(
  Object.entries(REGIONAL_SURTAX_BY_CODE).map(([code, schedule]) => [code, schedule.bands]),
);

export function applyProgressiveTax(taxableEur: number, bands: readonly ProgressiveBand[]): number {
  if (!(taxableEur > 0) || !Number.isFinite(taxableEur)) return 0;
  let previous = 0;
  let tax = 0;
  for (const band of bands) {
    const slice = Math.min(taxableEur, band.upToEur) - previous;
    if (slice > 0) tax += slice * band.rate;
    if (taxableEur <= band.upToEur) break;
    previous = band.upToEur;
  }
  return tax;
}

export function regionalSurtaxEur(taxableEur: number, schedule: RegionalSurtaxSchedule): number {
  if (!(taxableEur > 0) || !Number.isFinite(taxableEur)) return 0;

  let tax: number;
  if (schedule.underThreshold && taxableEur <= schedule.underThreshold.upToEur) {
    tax = taxableEur * schedule.underThreshold.flatRate;
  } else {
    tax = applyProgressiveTax(taxableEur, schedule.bands);
  }

  if (
    schedule.deduction &&
    taxableEur >= schedule.deduction.fromEur &&
    taxableEur <= schedule.deduction.toEur
  ) {
    tax = Math.max(0, tax - schedule.deduction.amountEur);
  }

  return Math.max(0, tax);
}

export function regionalSurtaxForCode(taxableEur: number, regionCode: string): number | null {
  const schedule = REGIONAL_SURTAX_BY_CODE[regionCode];
  if (!schedule) return null;
  return regionalSurtaxEur(taxableEur, schedule);
}

/**
 * Detrazione art. 13 TUIR for employment income (no dependents).
 * `redditoComplessivoEur` ≈ imponibile after deductible SSC for this simplified model.
 */
export function employmentDeductionEur(redditoComplessivoEur: number): number {
  const income = Math.max(0, redditoComplessivoEur);
  let deduction = 0;
  if (income <= 15_000) {
    deduction = 1_955;
  } else if (income <= 28_000) {
    deduction = 1_910 + (1_190 * (28_000 - income)) / 13_000;
  } else if (income <= 50_000) {
    deduction = (1_910 * (50_000 - income)) / 22_000;
  } else {
    deduction = 0;
  }
  // Extra €65 for incomes between 25_000 and 35_000.
  if (income > 25_000 && income <= 35_000) {
    deduction += 65;
  }
  return Math.max(0, deduction);
}

export function irpefGrossEur(taxableEur: number): number {
  return applyProgressiveTax(taxableEur, IRPEF_BRACKETS_2026);
}

export function irpefNetEur(taxableEur: number): number {
  const gross = irpefGrossEur(taxableEur);
  const deduction = employmentDeductionEur(taxableEur);
  return Math.max(0, gross - deduction);
}

export function parsePaycheckMonths(raw: unknown): PaycheckMonthCount {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (value === 13 || value === 14) return value;
  return 12;
}
