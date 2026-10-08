import type { Metadata } from "next";
import Link from "next/link";
import { getPaycheckCounterView } from "@/lib/paycheck-counter-view";
import { PaycheckCounter } from "./paycheck-counter";
import styles from "./busta-paga.module.css";

export const metadata: Metadata = {
  title: "Contatore busta paga: dal lordo alle voci di spesa",
  description:
    "Stima illustrativa della busta paga mensile dal lordo annuo: IRPEF e addizionali medie MEF per Regione, contributi OECD e ripartizione sulle missioni di bilancio OpenBDAP. Non è una busta paga reale.",
  alternates: { canonical: "/busta-paga" },
};

export default async function BustaPagaPage() {
  const view = await getPaycheckCounterView();

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Lavoro · stima illustrativa</p>
        <h1>Contatore busta paga</h1>
        <p>
          Inserisci lo stipendio annuo lordo e la Regione: ottieni un mensile lordo, le trattenute
          medie e una ripartizione delle tasse sulle missioni di bilancio dello Stato. Non sostituisce
          un CAF né la busta paga del datore di lavoro.
        </p>
        <p className={styles.links}>
          <a href="#busta-contatore">Contatore ↓</a>
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
          employeeSscRate={view.employeeSscRate}
          missions={view.missions}
          budgetYear={view.budgetYear}
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
          Fonti:{" "}
          <a href={view.provenance.irpefSourceUrl}>MEF IRPEF {view.irpefTaxYear}</a>
          {" · "}
          <a href={view.provenance.oecdSourceUrl}>
            OECD Taxing Wages {view.employeeSscYear}
          </a>
          {" · "}
          {view.provenance.budgetLabel}.
        </p>
      </section>
    </main>
  );
}
