import type { PublishedMonthlyReport } from "../../../lib/monthly-reports-contract";
import { monthlyReport202608 } from "@/content/monthly-reports/published/2026-08";

/**
 * Explicit static imports keep Next.js generation deterministic. Drafts live
 * in a separate directory and must never be imported here.
 */
export const PUBLISHED_MONTHLY_REPORTS = [
  monthlyReport202608,
] as const satisfies readonly PublishedMonthlyReport[];
