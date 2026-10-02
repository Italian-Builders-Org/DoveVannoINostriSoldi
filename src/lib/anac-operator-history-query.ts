import { z } from "zod";
import type { OperatorHistorySummary } from "./data/anac-operator-history-contract";

const amount = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .max(100);
const querySchema = z
  .object({
    year: z
      .union([z.number().int().min(1900).max(9999), z.literal("missing")])
      .optional(),
    authority: z
      .string()
      .regex(/^authority-\d{8}$/)
      .optional(),
    procedure: z.string().min(1).max(500).optional(),
    minAmount: amount.optional(),
    maxAmount: amount.optional(),
    page: z.number().int().positive().max(1_000_000).default(1),
  })
  .strict()
  .refine((query) => query.minAmount === undefined || query.maxAmount === undefined
    || compareAmounts(query.minAmount, query.maxAmount) <= 0, "L’importo minimo supera il massimo");

function compareAmounts(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  // The schemas guarantee canonical digits. Compare exact decimal strings
  // without converting each row and query bound to BigInt. Signed zero in
  // published history still compares equal to zero.
  const leftNegative = leftInteger.startsWith("-") && /[1-9]/.test(left);
  const rightNegative = rightInteger.startsWith("-") && /[1-9]/.test(right);
  if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;
  const leftWhole = leftInteger.startsWith("-") ? leftInteger.slice(1) : leftInteger;
  const rightWhole = rightInteger.startsWith("-") ? rightInteger.slice(1) : rightInteger;
  let result = leftWhole.length !== rightWhole.length
    ? (leftWhole.length < rightWhole.length ? -1 : 1)
    : leftWhole !== rightWhole ? (leftWhole < rightWhole ? -1 : 1) : 0;
  if (result === 0) {
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const leftDigits = leftFraction.padEnd(scale, "0");
    const rightDigits = rightFraction.padEnd(scale, "0");
    result = leftDigits < rightDigits ? -1 : leftDigits > rightDigits ? 1 : 0;
  }
  return leftNegative ? -result : result;
}

export const OPERATOR_HISTORY_PAGE_SIZE = 25;
export type OperatorHistoryQuery = z.input<typeof querySchema>;

export function parseOperatorHistorySearch(
  raw: Record<string, string | string[] | undefined>,
): OperatorHistoryQuery {
  const input: Record<string, string | number> = {};
  for (const key of [
    "year",
    "authority",
    "procedure",
    "minAmount",
    "maxAmount",
    "page",
  ]) {
    const value = raw[key];
    if (Array.isArray(value)) throw new Error("Filtro ripetuto");
    if (value === undefined || value === "") continue;
    if (key === "page" || (key === "year" && value !== "missing")) {
      if (!/^\d+$/.test(value)) throw new Error("Anno o pagina non validi");
      input[key] = Number(value);
    } else input[key] = value;
  }
  return querySchema.parse(input);
}

export function operatorHistoryHref(
  ref: string,
  query: OperatorHistoryQuery,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && !(key === "page" && value === 1))
      params.set(key, String(value));
  }
  const suffix = params.toString();
  return `/appalti/operatori/${encodeURIComponent(ref)}${suffix ? `?${suffix}` : ""}`;
}

export function selectOperatorHistoryPage(
  history: OperatorHistorySummary,
  input: OperatorHistoryQuery,
) {
  const query = querySchema.parse(input);
  const start = (query.page - 1) * OPERATOR_HISTORY_PAGE_SIZE;
  const end = start + OPERATOR_HISTORY_PAGE_SIZE;
  const rows = history.detail.filterRows;
  const unfiltered =
    query.year === undefined &&
    query.authority === undefined &&
    query.procedure === undefined &&
    query.minAmount === undefined &&
    query.maxAmount === undefined;
  if (unfiltered) {
    return {
      total: rows.length,
      page: query.page,
      pageCount: Math.ceil(rows.length / OPERATOR_HISTORY_PAGE_SIZE),
      positions: Array.from(
        { length: Math.max(0, Math.min(end, rows.length) - start) },
        (_, index) => start + index,
      ),
    };
  }
  let total = 0;
  const positions: number[] = [];
  rows.forEach(
    ([year, authority, procedure, amount], index) => {
      if (
        query.year !== undefined &&
        year !== (query.year === "missing" ? null : query.year)
      )
        return;
      if (query.authority !== undefined && query.authority !== authority)
        return;
      if (query.procedure !== undefined && query.procedure !== procedure)
        return;
      if (
        query.minAmount !== undefined &&
        (amount === null || compareAmounts(amount, query.minAmount) < 0)
      )
        return;
      if (
        query.maxAmount !== undefined &&
        (amount === null || compareAmounts(amount, query.maxAmount) > 0)
      )
        return;
      // Count every match, but retain only this page rather than the full result set.
      if (total >= start && total < end) positions.push(index);
      total++;
    },
  );
  return {
    total,
    page: query.page,
    pageCount: Math.ceil(total / OPERATOR_HISTORY_PAGE_SIZE),
    positions,
  };
}
