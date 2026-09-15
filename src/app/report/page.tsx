import type { Metadata } from "next";
import { MonthlyReportsArchive } from "@/components/monthly-report";
import { MONTHLY_REPORT_SERIES } from "@/lib/monthly-reports-contract";
import { monthlyReports } from "@/lib/monthly-reports";
import { PUBLIC_SITE_URL } from "@/lib/site";

const canonical = `${PUBLIC_SITE_URL}${MONTHLY_REPORT_SERIES.routeBase}`;

export const metadata: Metadata = {
  title: "Report",
  description: "Analisi e report mensili sui dati pubblici italiani, con fonti e calcoli verificabili.",
  alternates: { canonical },
  openGraph: {
    type: "website",
    url: canonical,
    title: "Report",
    description: "Analisi e report mensili sui dati pubblici italiani, con fonti e calcoli verificabili.",
    siteName: "DoveVannoINostriSoldi",
    locale: "it_IT",
  },
};

export default function MonthlyReportsPage() {
  return <MonthlyReportsArchive reports={monthlyReports.listPublished()} />;
}
