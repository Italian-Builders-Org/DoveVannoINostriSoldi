import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { GoogleAnalytics } from "@/components/google-analytics";
import { Navigation } from "@/components/navigation";
import { SectionNav } from "@/components/section-nav";
import { SiteFooter } from "@/components/site-footer";
import { mefIrpefSourceMeta } from "@/lib/data/mef-irpef-source";
import { siopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import "./design-system.css";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

/** The freshest verification timestamp among the two territorial tax/spending snapshots. */
const latestTerritorialCheckAt = Math.max(
  Date.parse(siopeMunicipalSnapshot.source.observedAt),
  Date.parse(mefIrpefSourceMeta.period.observedAt),
);
const latestTerritorialCheckLabel = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Rome",
}).format(new Date(latestTerritorialCheckAt));

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
  colorScheme: "light",
  themeColor: "#f3f2f2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className={geist.variable}>
      <body>
        <GoogleAnalytics />
        <a className="skip-link" href="#contenuto-principale">Salta al contenuto principale</a>
        <Navigation />
        <div id="contenuto-principale" tabIndex={-1}>{children}</div>
        <SectionNav />
        <SiteFooter latestTerritorialCheckLabel={latestTerritorialCheckLabel} />
      </body>
    </html>
  );
}
