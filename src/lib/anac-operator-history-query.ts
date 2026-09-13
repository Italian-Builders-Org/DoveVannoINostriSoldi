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
  .strict();

function compareAmounts(left: string, right: string): number {
  const [li, lf = ""] = left.split(".");
  const [ri, rf = ""] = right.split(".");
  const scale = Math.max(lf.length, rf.length);
  const l = BigInt(li + lf.padEnd(scale, "0"));
  const r = BigInt(ri + rf.padEnd(scale, "0"));
  return l < r ? -1 : l > r ? 1 : 0;
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
  if (
    query.minAmount !== undefined &&
    query.maxAmount !== undefined &&
    compareAmounts(query.minAmount, query.maxAmount) > 0
  )
    throw new Error("L’importo minimo supera il massimo");
  const positions: number[] = [];
  history.detail.filterRows.forEach(
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
      positions.push(index);
    },
  );
  const start = (query.page - 1) * OPERATOR_HISTORY_PAGE_SIZE;
  return {
    total: positions.length,
    page: query.page,
    pageCount: Math.ceil(positions.length / OPERATOR_HISTORY_PAGE_SIZE),
    positions: positions.slice(start, start + OPERATOR_HISTORY_PAGE_SIZE),
  };
}
