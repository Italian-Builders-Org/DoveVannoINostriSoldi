import { PUBLISHED_MONTHLY_REPORTS } from "@/content/monthly-reports/published/index";
import {
  monthlyReportSummary,
  validatePublishedMonthlyReport,
  type MonthlyReportSummary,
  type PublishedMonthlyReport,
} from "@/lib/monthly-reports-contract";

export type MonthlyReportsCatalog = Readonly<{
  listPublished(): readonly MonthlyReportSummary[];
  getPublished(issueMonth: string): PublishedMonthlyReport | null;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createMonthlyReportsCatalog(
  issues: readonly PublishedMonthlyReport[],
): MonthlyReportsCatalog {
  const validated = issues.map((issue) => deepFreeze(validatePublishedMonthlyReport(structuredClone(issue))));
  const issueMonths = validated.map((issue) => issue.issueMonth);
  if (new Set(issueMonths).size !== issueMonths.length) {
    throw new Error("Report mensile non valido: edizioni duplicate nel catalogo");
  }

  const ordered = [...validated].sort((left, right) =>
    right.issueMonth.localeCompare(left.issueMonth));
  const byMonth = new Map<string, PublishedMonthlyReport>(
    ordered.map((issue) => [issue.issueMonth, issue]),
  );
  const summaries = deepFreeze(ordered.map(monthlyReportSummary));

  return Object.freeze({
    listPublished: () => summaries,
    getPublished: (issueMonth: string) => byMonth.get(issueMonth) ?? null,
  });
}

export const monthlyReports = createMonthlyReportsCatalog(PUBLISHED_MONTHLY_REPORTS);
