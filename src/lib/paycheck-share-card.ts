/**
 * Shareable paycheck counter card: richer than the generic fact card,
 * with deduction + mission lines for social posts.
 */

import { PUBLIC_SITE_URL } from "@/lib/site";
import {
  formatPaycheckEuro,
  formatPaycheckPercent,
  type PaycheckComputation,
} from "@/lib/paycheck-counter";

export const PAYCHECK_SHARE_CARD_SIZE = 1080;
export const PAYCHECK_SHARE_PATH = "/busta-paga";

const REGION_MAX = 80;
const LINE_MAX = 8;
const LABEL_MAX = 40;
const VALUE_MAX = 24;

export type PaycheckShareLine = {
  label: string;
  value: string;
};

export type PaycheckShareCardInput = {
  regionName: string;
  monthlyNetLabel: string;
  monthlyGrossLabel: string;
  annualGrossLabel: string;
  /** e.g. "12 mensilità" — shown on the card subtitle. */
  payMonthsLabel: string;
  deductions: readonly PaycheckShareLine[];
  missions: readonly PaycheckShareLine[];
};

export type PaycheckShareCardParsed = PaycheckShareCardInput & {
  pageUrl: string;
  hostLabel: string;
};

export class PaycheckShareCardError extends Error {
  readonly code: "invalid_params";

  constructor(message: string) {
    super(message);
    this.name = "PaycheckShareCardError";
    this.code = "invalid_params";
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function requireField(raw: string | null, label: string, max: number): string {
  if (raw == null) throw new PaycheckShareCardError(`missing_${label}`);
  const value = collapseWhitespace(raw);
  if (!value) throw new PaycheckShareCardError(`empty_${label}`);
  if (value.length > max) throw new PaycheckShareCardError(`${label}_too_long`);
  return value;
}

function parseLines(raw: string | null, field: string): PaycheckShareLine[] {
  if (raw == null || !raw.trim()) return [];
  const parts = raw.split("|");
  if (parts.length > LINE_MAX * 2) throw new PaycheckShareCardError(`${field}_too_many`);
  if (parts.length % 2 !== 0) throw new PaycheckShareCardError(`${field}_odd`);
  const lines: PaycheckShareLine[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const label = collapseWhitespace(parts[index] ?? "");
    const value = collapseWhitespace(parts[index + 1] ?? "");
    if (!label || !value) throw new PaycheckShareCardError(`${field}_empty_pair`);
    if (label.length > LABEL_MAX || value.length > VALUE_MAX) {
      throw new PaycheckShareCardError(`${field}_pair_too_long`);
    }
    lines.push({ label, value });
  }
  return lines;
}

function encodeLines(lines: readonly PaycheckShareLine[]): string {
  return lines.map((row) => `${row.label}|${row.value}`).join("|");
}

export function buildPaycheckShareCardInput(computation: PaycheckComputation): PaycheckShareCardInput {
  const deductions = computation.deductions.map((row) => ({
    label: row.key === "irpef"
      ? "IRPEF"
      : row.key === "regionalSurtax"
        ? "Add. regionale"
        : row.key === "municipalSurtax"
          ? "Add. comunale"
          : "Contributi",
    value: `${formatPaycheckEuro(row.monthlyCents)} (${formatPaycheckPercent(row.rate)})`,
  }));

  const missions = [
    ...computation.missions.slice(0, 5).map((row) => ({
      label: row.label.length > LABEL_MAX ? `${row.label.slice(0, LABEL_MAX - 1)}…` : row.label,
      value: formatPaycheckEuro(row.monthlyCents),
    })),
    ...(computation.otherMissionsCents > 0
      ? [{ label: "Altre missioni", value: formatPaycheckEuro(computation.otherMissionsCents) }]
      : []),
  ].slice(0, LINE_MAX);

  return {
    regionName: computation.region.name,
    monthlyNetLabel: formatPaycheckEuro(computation.monthlyNetCents),
    monthlyGrossLabel: formatPaycheckEuro(computation.monthlyGrossCents),
    annualGrossLabel: formatPaycheckEuro(computation.annualGrossCents),
    payMonthsLabel: `${computation.payMonths} mensilità`,
    deductions,
    missions,
  };
}

export function parsePaycheckShareCardSearchParams(
  params: URLSearchParams,
): PaycheckShareCardParsed {
  const regionName = requireField(params.get("region"), "region", REGION_MAX);
  const monthlyNetLabel = requireField(params.get("net"), "net", VALUE_MAX);
  const monthlyGrossLabel = requireField(params.get("gross"), "gross", VALUE_MAX);
  const annualGrossLabel = requireField(params.get("annual"), "annual", VALUE_MAX);
  const payMonthsLabel = requireField(params.get("months") ?? "12 mensilità", "months", VALUE_MAX);
  const deductions = parseLines(params.get("deductions"), "deductions");
  const missions = parseLines(params.get("missions"), "missions");
  if (deductions.length === 0) throw new PaycheckShareCardError("missing_deductions");

  const pageUrl = new URL(PAYCHECK_SHARE_PATH, PUBLIC_SITE_URL).toString();
  const hostLabel = new URL(PUBLIC_SITE_URL).host.replace(/^www\./, "");

  return {
    regionName,
    monthlyNetLabel,
    monthlyGrossLabel,
    annualGrossLabel,
    payMonthsLabel,
    deductions,
    missions,
    pageUrl,
    hostLabel,
  };
}

export function buildPaycheckShareCardPath(input: PaycheckShareCardInput): string {
  const params = new URLSearchParams();
  params.set("region", collapseWhitespace(input.regionName));
  params.set("net", collapseWhitespace(input.monthlyNetLabel));
  params.set("gross", collapseWhitespace(input.monthlyGrossLabel));
  params.set("annual", collapseWhitespace(input.annualGrossLabel));
  params.set("months", collapseWhitespace(input.payMonthsLabel));
  params.set("deductions", encodeLines(input.deductions));
  if (input.missions.length > 0) params.set("missions", encodeLines(input.missions));
  parsePaycheckShareCardSearchParams(params);
  return `/api/share/busta-paga?${params.toString()}`;
}

export const PAYCHECK_SHARE_X_HANDLE = "@DVNSoldi";

export function buildPaycheckShareMessage(input: PaycheckShareCardInput, pageUrl?: string): string {
  const parsed = parsePaycheckShareCardSearchParams(
    new URLSearchParams({
      region: input.regionName,
      net: input.monthlyNetLabel,
      gross: input.monthlyGrossLabel,
      annual: input.annualGrossLabel,
      months: input.payMonthsLabel,
      deductions: encodeLines(input.deductions),
      ...(input.missions.length > 0 ? { missions: encodeLines(input.missions) } : {}),
    }),
  );
  const url = pageUrl ?? parsed.pageUrl;
  return (
    `Busta paga stimata in ${parsed.regionName}: ${parsed.monthlyNetLabel} netti ` +
    `(${parsed.payMonthsLabel}, lordo ${parsed.monthlyGrossLabel}). Dove vanno le tasse? ` +
    `Dettaglio su Dove Vanno I Nostri Soldi ${PAYCHECK_SHARE_X_HANDLE} → ${url}`
  ).replace(/\s+/g, " ").trim();
}
