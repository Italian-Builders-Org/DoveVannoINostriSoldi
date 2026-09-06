import type { Metadata } from "next";
import { MonthlyReportsArchive } from "@/components/monthly-report";
import { MONTHLY_REPORT_SERIES } from "@/lib/monthly-reports-contract";
import { monthlyReports } from "@/lib/monthly-reports";
import { PUBLIC_SITE_URL } from "@/lib/site";

const canonical = `${PUBLIC_SITE_URL}${MONTHLY_REPORT_SERIES.routeBase}`;

export const metadata: Metadata = {
  title: MONTHLY_REPORT_SERIES.title,
  description: "Report mensili sui dati pubblici italiani, scritti per cittadini curiosi con fonti, periodi, perimetri e limiti in chiaro.",
  alternates: { canonical },
  openGraph: {
    type: "website",
    url: canonical,
    title: MONTHLY_REPORT_SERIES.title,
    description: "Una storia principale e rubriche stabili per capire i dati pubblici del mese.",
    siteName: "DoveVannoINostriSoldi",
    locale: "it_IT",
  },
};

export default function MonthlyReportsPage() {
  return <MonthlyReportsArchive reports={monthlyReports.listPublished()} />;
}
