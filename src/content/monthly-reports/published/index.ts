import type { PublishedMonthlyReport } from "../../../lib/monthly-reports-contract";

/**
 * Explicit static imports keep Next.js generation deterministic. Drafts live
 * in a separate directory and must never be imported here.
 */
export const PUBLISHED_MONTHLY_REPORTS = [] as const satisfies readonly PublishedMonthlyReport[];
