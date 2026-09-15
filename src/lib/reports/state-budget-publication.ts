import report from '@/content/reports/state-budget-reader.json';

/** Public labels only. Frozen 2025 evidence remains unchanged. */
const stateBudgetPublication = {
  slug: report.route.split('/').at(-1)!,
  title: report.title,
  summary: report.summary,
  date: report.publishedOn,
  updatedOn: report.modifiedOn,
};

export default stateBudgetPublication;
