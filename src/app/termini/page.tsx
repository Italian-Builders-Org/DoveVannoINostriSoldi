import type { Metadata } from "next";
import { REPO_URL } from "@/lib/site";
import styles from "../legal-page.module.css";

export const metadata: Metadata = {
  title: "Termini di utilizzo",
  description: "Condizioni essenziali per usare il sito e il server MCP pubblico.",
};

export default function TermsPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <h1>Termini di utilizzo</h1>
        <p>Condizioni essenziali per il sito e per l&apos;endpoint MCP pubblico. Aggiornate il 25 agosto 2026.</p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Che cosa offre il servizio</h2>
        <p>
          DoveVannoINostriSoldi rende più leggibili dati pubblici italiani e li espone anche
          tramite strumenti MCP in sola lettura. Le pagine indicano fonte, periodo, perimetro e
          limiti interpretativi. Il servizio non sostituisce le fonti ufficiali e non fornisce
          consulenza legale, fiscale, contabile o finanziaria.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Uso corretto</h2>
        <ul>
          <li>Non tentare di aggirare limiti, compromettere il servizio o sovraccaricare gli endpoint.</li>
          <li>Non presentare segnali, costi o scostamenti come prova automatica di illecito, spreco o responsabilità individuale.</li>
          <li>Verifica sulla fonte ufficiale qualsiasi decisione importante o dato che può essere cambiato.</li>
          <li>Non inviare dati personali o riservati ai tool MCP: bastano i dati pubblici già esposti.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">Disponibilità e responsabilità</h2>
        <p>
          Il progetto è offerto senza garanzia di continuità, completezza o assenza di errori.
          Fonti e schemi pubblici possono cambiare o diventare temporaneamente indisponibili.
          Correggiamo gli errori verificabili, ma chi riusa i risultati resta responsabile di
          controllarne adeguatezza, data e contesto.
        </p>
        <p>
          Parte delle aggregazioni e delle presentazioni sul sito è prodotta o organizzata con
          strumenti di intelligenza artificiale. Anche con controlli continui sulle fonti ufficiali,
          l&apos;AI può sbagliare o omettere limiti rilevanti. Prima di qualsiasi decisione,
          confronta sempre i numeri con la fonte ufficiale indicata in pagina.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Licenze e modifiche</h2>
        <p>
          Il <a href={REPO_URL}>codice del progetto</a> è disponibile sotto GNU Affero
          GPL v3, con possibilità di licenza commerciale separata per usi
          proprietari. I dataset e gli elementi di terze parti conservano le
          licenze e attribuzioni indicate nelle rispettive fonti. Questi termini
          possono essere aggiornati quando cambiano servizio o requisiti; la data
          in apertura identifica la versione pubblicata.
        </p>
      </section>
    </main>
  );
}
