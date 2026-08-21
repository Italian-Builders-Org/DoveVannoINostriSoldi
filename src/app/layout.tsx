import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Navigation } from "@/components/navigation";
import { mefIrpefSourceMeta } from "@/lib/data/mef-irpef-source";
import { REPO_URL } from "@/lib/site";
import { siopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import "./design-system.css";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-archivo",
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
    "Dati pubblici italiani spiegati in modo semplice, con la fonte sempre a portata di mano.",
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
    <html lang="it" className={archivo.variable}>
      <body>
        <a className="skip-link" href="#contenuto-principale">Salta al contenuto principale</a>
        <Navigation />
        <div id="contenuto-principale" tabIndex={-1}>{children}</div>
        <footer className="shell site-footer">
          <div className="footer-row">
            <span>Ultimo controllo SIOPE o IRPEF: {latestTerritorialCheckLabel}</span>
            <span>Dati pubblici, liberi da riusare</span>
            <span className="footer-spacer" />
            <a className="footer-link" href={REPO_URL} target="_blank" rel="noreferrer">
              Codice su GitHub ↗
            </a>
            <a className="footer-link" href="/mcp">MCP</a>
          </div>
          <div className="footer-row">
            <span className="footer-credit">Fatto da</span>
            <a href="https://x.com/fragiannicola" target="_blank" rel="noreferrer">@fragiannicola</a>
            <span aria-hidden="true">·</span>
            <a href="https://x.com/dom_gag_96" target="_blank" rel="noreferrer">@dom_gag_96</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
