import type { Metadata } from "next";
import Link from "next/link";
import { getPaycheckCounterView } from "@/lib/paycheck-counter-view";
import { PaycheckCounter } from "./paycheck-counter";
import styles from "./busta-paga.module.css";

export const metadata: Metadata = {
  title: "Contatore busta paga: dal lordo alle voci di spesa",
  description:
    "Stima illustrativa della busta paga mensile dal lordo annuo: IRPEF 2026 a scaglioni con detrazione lavoro dipendente, contributi INPS 9,19%, addizionali e ripartizione illustrativa sulle missioni di bilancio OpenBDAP. Non è una busta paga reale.",
  alternates: { canonical: "/busta-paga" },
};

export default async function BustaPagaPage() {
  const view = await getPaycheckCounterView();

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Lavoro · stima illustrativa {view.taxYear}</p>
        <h1>Contatore busta paga</h1>
        <p>
          Inserisci lo stipendio annuo lordo, la Regione e il numero di mensilità (12, 13 o 14):
          ottieni il lordo per cedolino, le trattenute (IRPEF a scaglioni, addizionali regionali MEF
          2026, contributi) e una ripartizione illustrativa della sola IRPEF erariale sulle missioni
          di bilancio dello Stato. Non sostituisce un CAF né la busta paga del datore di lavoro.
        </p>
        <p className={styles.links}>
          <a href="#busta-contatore">Contatore ↓</a>
          <a href="#busta-mappa-title">Mappa Regioni ↓</a>
          <a href="#busta-limiti">Limiti ↓</a>
          <Link href="/cuneo-fiscale">Cuneo fiscale OECD →</Link>
          <Link href="/territori/irpef">IRPEF territoriale →</Link>
          <Link href="/spese/legge-di-bilancio">Legge di Bilancio →</Link>
          <Link href="/economia">Economia →</Link>
        </p>
      </header>

      <section className="panel" id="busta-contatore" aria-labelledby="busta-contatore-title">
        <h2 id="busta-contatore-title" className="sr-only">
          Contatore
        </h2>
        <PaycheckCounter
          regions={view.regions}
          defaultRegionCode={view.defaultRegionCode}
          defaultAnnualGrossEur={view.defaultAnnualGrossEur}
          defaultPayMonths={view.defaultPayMonths}
          payMonthOptions={view.payMonthOptions}
          missions={view.missions}
          budgetYear={view.budgetYear}
          taxYear={view.taxYear}
        />
      </section>

      <section className="panel" id="busta-limiti" aria-labelledby="busta-limiti-title">
        <h2 id="busta-limiti-title" className="panel-title">
          Fonti e limiti
        </h2>
        <ul className={styles.caveatList}>
          {view.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
        <p className={styles.sourceLine}>
          Fonti: scaglioni IRPEF {view.taxYear} e detrazione lavoro dipendente (art. 13 TUIR) ·
          contributi INPS IVS ordinario ≈ 9,19% · {view.provenance.regionalSurtaxLabel} ·
          addizionale comunale{" "}
          <a href={view.provenance.irpefSourceUrl}>MEF {view.mefIrpefTaxYear}</a>
          {" · "}
          {view.provenance.budgetLabel}.
        </p>
      </section>
    </main>
  );
}
