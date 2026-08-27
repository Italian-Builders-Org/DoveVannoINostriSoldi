import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { GoogleAnalytics } from "@/components/google-analytics";
import { Navigation } from "@/components/navigation";
import { SectionNav } from "@/components/section-nav";
import { SiteFooter } from "@/components/site-footer";
import { mefIrpefSourceMeta } from "@/lib/data/mef-irpef-source";
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
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#161514" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("dvns-theme");var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var d=t==="dark"||((t!=="light")&&m);if(d){document.documentElement.setAttribute("data-theme","dark");document.documentElement.style.colorScheme="dark";}else{document.documentElement.setAttribute("data-theme","light");document.documentElement.style.colorScheme="light";}}catch(e){}})()`,
          }}
        />
      </head>
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
