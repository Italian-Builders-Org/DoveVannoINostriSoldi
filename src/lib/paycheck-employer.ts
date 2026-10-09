/**
 * Employer-side labour cost for the paycheck counter (illustrative, 2026).
 *
 * Statutory pieces, not a payroll engine:
 * - IVS employer share 23.81% of the 33% FPLD rate (employee 9.19% lives in
 *   paycheck-tax-rules). Minor INPS lines follow the 2026 private-sector
 *   tables (NASpI, CUAF, sickness, maternity, TFR guarantee fund, CIGO/CIGS).
 * - Contribution base stops at the 2026 ceiling in INPS circular 6/2026.
 * - TFR accrual is art. 2120 c.c. (pay / 13.5). The 0.50% financing
 *   contribution (art. 3, L. 297/1982) is part of that quota, paid to INPS.
 * - INAIL is a per-mille premium on gross pay. The real rate is the PAT
 *   tariff (D.I. 27 February 2019); the presets are illustrative magnitudes.
 *
 * A rounded "31% of RAL" journalistic average is not applied.
 */

export const INPS_CONTRIBUTION_CEILING_2026_EUR = 122_295;

/** art. 2120 c.c.: annual quota = useful pay / 13.5. */
export const TFR_DIVISOR = 13.5;

/** art. 3, L. 29 May 1982, n. 297. Charged on the INPS contribution base. */
export const TFR_INPS_FINANCING_RATE = 0.005;

export const INPS_CIRCULAR_6_2026_URL =
  "https://www.inps.it/content/dam/inps-site/it/scorporati/circolari-e-messaggi/2026/01/Circolare_15151/Allegati/16546_Circolare-numero-6-del-30-01-2026.pdf";

export const TFR_CIVIL_CODE_URL =
  "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16~art2120";

export const TFR_LAW_297_URL =
  "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1982-05-29;297";

export const INAIL_TARIFF_NOTE_URL =
  "https://www.inail.it/portale/it/atti-e-documenti/note-provvedimenti-e-istruzioni-operative/normativa-circolari-inail/dettaglio.2026.06.circ-n-28-del-12-giugno-2026.html";

export type EmployerInpsLine = {
  key:
    | "inpsIvs"
    | "inpsNaspi"
    | "inpsCuaf"
    | "inpsSickness"
    | "inpsMaternity"
    | "inpsTfrFund"
    | "inpsCigo"
    | "inpsCigs";
  label: string;
  rate: number;
};

const IVS: EmployerInpsLine = {
  key: "inpsIvs",
  label: "INPS IVS · quota datore",
  rate: 0.2381,
};
const NASPI: EmployerInpsLine = {
  key: "inpsNaspi",
  label: "NASpI",
  rate: 0.0161,
};
const CUAF: EmployerInpsLine = {
  key: "inpsCuaf",
  label: "CUAF · assegno per il nucleo familiare",
  rate: 0.0068,
};
const SICKNESS: EmployerInpsLine = {
  key: "inpsSickness",
  label: "Indennità economica di malattia",
  rate: 0.0222,
};
const MATERNITY: EmployerInpsLine = {
  key: "inpsMaternity",
  label: "Tutela maternità",
  rate: 0.0046,
};
const TFR_FUND: EmployerInpsLine = {
  key: "inpsTfrFund",
  label: "Fondo di garanzia TFR",
  rate: 0.002,
};
const CIGO_INDUSTRY: EmployerInpsLine = {
  key: "inpsCigo",
  label: "CIGO · cassa integrazione ordinaria",
  rate: 0.017,
};
const CIGO_CONSTRUCTION: EmployerInpsLine = {
  key: "inpsCigo",
  label: "CIGO edilizia · operai",
  rate: 0.047,
};
/** 0.90% CIGS, of which 0.30% is the worker share (not modelled on the payslip). */
const CIGS_EMPLOYER: EmployerInpsLine = {
  key: "inpsCigs",
  label: "CIGS · quota datore",
  rate: 0.006,
};

export type EmployerProfileId =
  | "commerce-to-50"
  | "industry-clerical-16-50"
  | "industry-blue-16-50"
  | "construction-blue-16-50";

export type EmployerProfile = {
  id: EmployerProfileId;
  label: string;
  lines: readonly EmployerInpsLine[];
};

export const EMPLOYER_PROFILES: readonly EmployerProfile[] = [
  {
    id: "commerce-to-50",
    label: "Commercio e terziario · fino a 50 dipendenti",
    lines: [IVS, NASPI, CUAF, SICKNESS, MATERNITY, TFR_FUND],
  },
  {
    id: "industry-clerical-16-50",
    label: "Industria · impiegati · da 16 a 50 dipendenti",
    lines: [IVS, NASPI, CUAF, CIGO_INDUSTRY, CIGS_EMPLOYER, MATERNITY, TFR_FUND],
  },
  {
    id: "industry-blue-16-50",
    label: "Industria · operai · da 16 a 50 dipendenti",
    lines: [IVS, NASPI, CUAF, SICKNESS, CIGO_INDUSTRY, CIGS_EMPLOYER, MATERNITY, TFR_FUND],
  },
  {
    id: "construction-blue-16-50",
    label: "Edilizia · operai · da 16 a 50 dipendenti",
    lines: [IVS, NASPI, CUAF, SICKNESS, CIGO_CONSTRUCTION, CIGS_EMPLOYER, MATERNITY, TFR_FUND],
  },
];

export const DEFAULT_EMPLOYER_PROFILE_ID: EmployerProfileId = "commerce-to-50";

export type InailPresetId = "office" | "retail" | "manufacturing" | "construction";

export type InailPreset = {
  id: InailPresetId;
  label: string;
  perMille: number;
};

/** Illustrative tariff magnitudes. Not the rate on a real INAIL position. */
export const INAIL_PRESETS: readonly InailPreset[] = [
  { id: "office", label: "Ufficio · 4‰", perMille: 4 },
  { id: "retail", label: "Negozi e ristorazione · 10‰", perMille: 10 },
  { id: "manufacturing", label: "Manifattura · 15‰", perMille: 15 },
  { id: "construction", label: "Edilizia · 40‰", perMille: 40 },
];

export const DEFAULT_INAIL_PRESET_ID: InailPresetId = "office";

export function employerProfileById(id: string | undefined): EmployerProfile {
  return EMPLOYER_PROFILES.find((profile) => profile.id === id) ?? EMPLOYER_PROFILES[0];
}

export function inailPresetById(id: string | undefined): InailPreset {
  return INAIL_PRESETS.find((preset) => preset.id === id) ?? INAIL_PRESETS[0];
}

export function employerInpsRate(profile: EmployerProfile): number {
  return profile.lines.reduce((sum, line) => sum + line.rate, 0);
}

/** Pay that INPS contributions are charged on. */
export function inpsContributionBaseEur(annualGrossEur: number): number {
  if (!(annualGrossEur > 0) || !Number.isFinite(annualGrossEur)) return 0;
  return Math.min(annualGrossEur, INPS_CONTRIBUTION_CEILING_2026_EUR);
}

export type EmployerChargeDraft = {
  key: EmployerInpsLine["key"] | "inail" | "tfrFinancing" | "tfrAccrual";
  label: string;
  /** Statutory rate on `base`, before the ceiling bites. */
  rate: number;
  /** Annual euro amount before cent rounding. */
  annualEur: number;
  base: "inps" | "gross";
};

/**
 * Annual employer charges in euros (not rounded to cents).
 * TFR financing is carved out of pay/13.5 so the two TFR lines sum to that quota.
 */
export function employerChargeDrafts(input: {
  annualGrossEur: number;
  profileId?: string;
  inailPerMille?: number;
}): {
  profile: EmployerProfile;
  inailPerMille: number;
  inpsBaseEur: number;
  capped: boolean;
  lines: EmployerChargeDraft[];
} {
  const annualGrossEur = Math.max(0, input.annualGrossEur);
  const profile = employerProfileById(input.profileId);
  const perMille = clampInailPerMille(input.inailPerMille);
  const inpsBaseEur = inpsContributionBaseEur(annualGrossEur);
  const inpsLines: EmployerChargeDraft[] = profile.lines.map((line) => ({
    key: line.key,
    label: line.label,
    rate: line.rate,
    annualEur: inpsBaseEur * line.rate,
    base: "inps",
  }));

  const inail: EmployerChargeDraft = {
    key: "inail",
    label: "INAIL · assicurazione infortuni e malattie professionali",
    rate: perMille / 1000,
    annualEur: annualGrossEur * (perMille / 1000),
    base: "gross",
  };

  const tfrTotalEur = annualGrossEur / TFR_DIVISOR;
  const tfrFinancingEur = inpsBaseEur * TFR_INPS_FINANCING_RATE;
  const tfrAccrualEur = Math.max(0, tfrTotalEur - tfrFinancingEur);

  return {
    profile,
    inailPerMille: perMille,
    inpsBaseEur,
    capped: annualGrossEur > INPS_CONTRIBUTION_CEILING_2026_EUR,
    lines: [
      ...inpsLines,
      inail,
      {
        key: "tfrFinancing",
        label: "Contributo INPS sul TFR",
        rate: TFR_INPS_FINANCING_RATE,
        annualEur: tfrFinancingEur,
        base: "inps",
      },
      {
        key: "tfrAccrual",
        label: "Accantonamento TFR",
        rate: 1 / TFR_DIVISOR - TFR_INPS_FINANCING_RATE,
        annualEur: tfrAccrualEur,
        base: "gross",
      },
    ],
  };
}

export function clampInailPerMille(raw: unknown): number {
  const preset = INAIL_PRESETS.find((row) => row.id === raw);
  if (preset) return preset.perMille;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return INAIL_PRESETS[0].perMille;
  return Math.min(150, Math.max(0, Math.round(value)));
}

export function parseEmployerProfileId(raw: unknown): EmployerProfileId {
  if (typeof raw === "string" && EMPLOYER_PROFILES.some((profile) => profile.id === raw)) {
    return raw as EmployerProfileId;
  }
  return DEFAULT_EMPLOYER_PROFILE_ID;
}

export function parseInailPresetId(raw: unknown): InailPresetId {
  if (typeof raw === "string" && INAIL_PRESETS.some((preset) => preset.id === raw)) {
    return raw as InailPresetId;
  }
  return DEFAULT_INAIL_PRESET_ID;
}
