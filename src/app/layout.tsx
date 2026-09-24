import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { GoogleAnalytics } from "@/components/google-analytics";
import { ChromeUnlessImmersive, ImmersiveDocumentFlag } from "@/components/immersive-chrome";
import { IMMERSIVE_INIT_SCRIPT } from "@/lib/politici-immersive";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";
import { Navigation } from "@/components/navigation";
import { SectionNav } from "@/components/section-nav";
import { SiteFooter } from "@/components/site-footer";
import { monthlyReports } from "@/lib/monthly-reports";
import { papers } from "@/lib/papers";
import stateBudgetReport from "@/lib/reports/state-budget-publication";
import "./design-system.css";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const latestReport = monthlyReports.listPublished()[0];
const latestPaper = papers.listPublished()[0];
const announcements = [
  ...(latestReport ? [{ label: "Articolo", title: latestReport.title, description: latestReport.issueMonth === "2026-08" ? "Imprese e territori: cosa sta cambiando in Italia?" : latestReport.title, cta: "Leggi l’articolo", href: latestReport.href }] : []),
  ...(latestPaper ? [{
    label: "Paper",
    title: latestPaper.title,
    description: latestPaper.webPath === "/studi/tre-interventi-sprechi"
      ? "Farmaci, giustizia ed edilizia: tre spese da verificare"
      : latestPaper.webPath === "/studi/dai-fondi-ai-posti"
        ? "Asili PNRR: i finanziamenti diventano posti disponibili?"
        : latestPaper.title,
    cta: "Scopri il paper",
    href: latestPaper.webPath ?? "/studi",
  }] : []),
  { label: "Analisi", title: stateBudgetReport.title, description: "Spesa pubblica: costi evitabili, anomalie ed errori", cta: "Leggi l’analisi", href: `/report/${stateBudgetReport.slug}` },
];

export const metadata: Metadata = {
  title: {
    default: "DoveVannoINostriSoldi",
    template: "%s · DoveVannoINostriSoldi",
  },
  description:
    "Dati pubblici italiani spiegati in modo semplice, con la fonte sempre a portata di mano. Include un simulatore di riallocazione della Legge di Bilancio sullo stanziamento OpenBDAP, non sulla cassa.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={geist.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: IMMERSIVE_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body>
        <GoogleAnalytics />
        <ImmersiveDocumentFlag />
        <a className="skip-link" href="#contenuto-principale">Salta al contenuto principale</a>
        {/* Keep wrappers mounted so soft navigation can restore site chrome. */}
        <ChromeUnlessImmersive>
          <Navigation announcements={announcements} />
        </ChromeUnlessImmersive>
        <div className="site-content">
          <ChromeUnlessImmersive>
            <SectionNav />
          </ChromeUnlessImmersive>
          <div id="contenuto-principale" tabIndex={-1}>{children}</div>
          <ChromeUnlessImmersive>
            <SiteFooter />
          </ChromeUnlessImmersive>
        </div>
      </body>
    </html>
  );
}
