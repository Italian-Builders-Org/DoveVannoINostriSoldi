import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import "./globals.css";
import "./design-system.css";

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
  colorScheme: "dark",
  themeColor: "#06131f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>
        <Navigation />
        {children}
        <footer className="site-footer">
          <div>
            <strong>DoveVannoINostriSoldi</strong>
            <p>Progetto indipendente e open source. Non è un sito della Pubblica Amministrazione.</p>
          </div>
          <div className="footer-contributors">
            <span>Contributori</span>
            <a href="https://x.com/fragiannicola" target="_blank" rel="noreferrer">@fragiannicola</a>
            <a href="https://x.com/dom_gag_96" target="_blank" rel="noreferrer">@dom_gag_96</a>
          </div>
          <div className="footer-rule">
            <Link href="/metodologia">Come leggiamo i dati</Link>
            <span>Ogni numero ha una fonte e una data.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
