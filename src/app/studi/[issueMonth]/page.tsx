import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MonthlyReportArticle } from "@/components/monthly-report";
import { MONTHLY_REPORT_SERIES, issueMonthLabel } from "@/lib/monthly-reports-contract";
import { monthlyReports } from "@/lib/monthly-reports";
import { PUBLIC_SITE_URL } from "@/lib/site";

type ReportPageProps = Readonly<{ params: Promise<{ issueMonth: string }> }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return monthlyReports.listPublished().map((report) => ({ issueMonth: report.issueMonth }));
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { issueMonth } = await params;
  const report = monthlyReports.getPublished(issueMonth);
  if (!report) return {};
  const canonical = `${PUBLIC_SITE_URL}${MONTHLY_REPORT_SERIES.routeBase}/${report.issueMonth}`;
  return {
    title: `${report.title}, ${issueMonthLabel(report.issueMonth)}`,
    description: report.teaser,
    authors: [{ name: MONTHLY_REPORT_SERIES.byline }],
    keywords: [...report.keywords],
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: report.title,
      description: report.teaser,
      siteName: "DoveVannoINostriSoldi",
      locale: "it_IT",
      authors: [MONTHLY_REPORT_SERIES.byline],
      publishedTime: report.publication.publishedOn,
    },
  };
}

export default async function MonthlyReportPage({ params }: ReportPageProps) {
  const { issueMonth } = await params;
  const report = monthlyReports.getPublished(issueMonth);
  if (!report) notFound();
  return <MonthlyReportArticle report={report} />;
}
