import type { Metadata } from "next";
import Link from "next/link";
import { buildInequalityPageView, INEQUALITY_DATASET_ID } from "@/lib/inequality-page";
import { IncomeIndicatorSection } from "./indicator-section";
import styles from "./disuguaglianza.module.css";

export const metadata: Metadata = {
  title: "Disuguaglianza dei redditi",
  description: "Come si distribuiscono i redditi in Italia: Gini e rapporto S80/S20, con serie Eurostat EU-SILC e anni di riferimento distinti.",
};

export default async function InequalityPage() {
  const indicators = await buildInequalityPageView();
  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-header">
        <h1>Disuguaglianza dei redditi</h1>
        <p>Come si distribuisce il reddito disponibile in Italia, dopo imposte e trasferimenti e tenendo conto della composizione familiare.</p>
        <div className={styles.links}>
          <Link href="/poverta">Povertà assoluta e relativa →</Link>
          <Link href={`/dati/${INEQUALITY_DATASET_ID}`}>Esplora i dati →</Link>
        </div>
      </header>
      <div className={styles.indicators}>
        {indicators.map((indicator) => <IncomeIndicatorSection key={indicator.key} indicator={indicator} />)}
      </div>
      <details className={styles.method} id="disuguaglianza-metodo">
        <summary>Come leggere questi dati</summary>
        <h2>Redditi e rilevazione</h2>
        <p>L’anno dei redditi precede quello della rilevazione EU-SILC: la rilevazione 2025 descrive i redditi del 2024. La serie copre i redditi dal 2013 al 2024.</p>
        <h2>Chi è incluso</h2>
        <p>Le persone che vivono in famiglie private in Italia. Le convivenze istituzionali e collettive sono generalmente escluse. Il reddito disponibile è reso equivalente per confrontare famiglie di composizione diversa.</p>
        <h2>Due misure della distribuzione</h2>
        <p>Il Gini considera l’intera distribuzione. S80/S20 confronta il reddito complessivo dei due gruppi estremi, ciascuno formato dal 20% delle persone. Valori più alti indicano maggiore disuguaglianza.</p>
        <p>Queste serie misurano i redditi, non il patrimonio o la povertà. Gli indicatori territoriali BES mantengono il proprio perimetro e non sono combinati in una classifica.</p>
        <p>Un dato mancante resta non disponibile. In presenza di un’interruzione dichiarata dalla fonte, la linea del grafico si interrompe.</p>
        <p><a href="https://ec.europa.eu/eurostat/cache/metadata/en/ilc_sieusilc.htm">Metodologia Eurostat</a>{" · "}<a href="https://ec.europa.eu/eurostat/web/main/help/copyright-notice">Condizioni di riutilizzo</a></p>
        <p>Fonte: Eurostat. Riutilizzo dei dati statistici con attribuzione, secondo la decisione della Commissione del 12 dicembre 2011. Selezione, traduzione e presentazione a cura di DoveVannoINostriSoldi; Eurostat non è responsabile di queste elaborazioni.</p>
      </details>
    </main>
  );
}
