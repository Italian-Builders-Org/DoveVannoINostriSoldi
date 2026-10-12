import type { Metadata } from "next";
import Link from "next/link";
import { getPaycheckCounterView } from "@/lib/paycheck-counter-view";
import { PaycheckCounter } from "./paycheck-counter";
import styles from "./busta-paga.module.css";

export const metadata: Metadata = {
  title: "Contatore busta paga: dal lordo alle voci di spesa",
  description:
    "Stima illustrativa della busta paga da lordo o netto, mensile o annuo: IRPEF 2026, contributi INPS 9,19%, addizionali, oneri del datore (INPS, INAIL, TFR) e grafico a colonne fino a 100.000 €. Non è una busta paga reale.",
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
          Inserisci il lordo o il netto, annuo o mensile, la Regione e le mensilità (12, 13 o 14):
          ottieni il netto per cedolino, le trattenute del lavoratore e gli oneri che il datore
          versa o accantona in più (INPS di tabella, INAIL, TFR). Il grafico a colonne va da 5.000 a
          100.000 € di RAL, a passi di 5.000, e mostra sempre RAL dipendente, netto dipendente e
          costo azienda annuale. Non sostituisce un CAF né la busta paga del datore di lavoro.
        </p>
        <p className={styles.links}>
          <a href="#busta-contatore">Contatore ↓</a>
          <a href="#busta-curva">Grafico ↓</a>
          <a href="#busta-datore-title">Oneri del datore ↓</a>
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
          contributi INPS IVS ordinario ≈ 9,19% e quota datore 23,81%, più NASpI, CUAF, malattia,
          maternità, fondo garanzia TFR e CIGO/CIGS dove il profilo le prevede · massimale 122.295 €{" "}
          <a href="https://www.inps.it/content/dam/inps-site/it/scorporati/circolari-e-messaggi/2026/01/Circolare_15151/Allegati/16546_Circolare-numero-6-del-30-01-2026.pdf">
            circolare INPS n. 6/2026
          </a>
          {" · "}
          TFR{" "}
          <a href="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16~art2120">
            art. 2120 c.c.
          </a>{" "}
          e contributo 0,50%{" "}
          <a href="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1982-05-29;297">
            L. 297/1982
          </a>
          {" · "}
          INAIL, tariffe D.I. 27 febbraio 2019 e{" "}
          <a href="https://www.inail.it/portale/it/atti-e-documenti/note-provvedimenti-e-istruzioni-operative/normativa-circolari-inail/dettaglio.2026.06.circ-n-28-del-12-giugno-2026.html">
            circolare INAIL n. 28/2026
          </a>
          {" · "}
          {view.provenance.regionalSurtaxLabel} · addizionale comunale{" "}
          <a href={view.provenance.irpefSourceUrl}>MEF {view.mefIrpefTaxYear}</a>
          {" · "}
          {view.provenance.budgetLabel}.
        </p>
      </section>
    </main>
  );
}
