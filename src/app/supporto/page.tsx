import type { Metadata } from "next";
import { PUBLIC_MCP_ENDPOINT, REPO_URL } from "@/lib/site";
import styles from "../legal-page.module.css";

export const metadata: Metadata = {
  title: "Supporto",
  description: "Assistenza per il sito e per il server MCP di DoveVannoINostriSoldi.",
};

export default function SupportPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <h1>Supporto</h1>
        <p>Per problemi riproducibili del sito, dei dati pubblicati o del collegamento MCP.</p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Problemi e richieste tecniche</h2>
        <p>
          Apri una <a href={`${REPO_URL}/issues`}>issue pubblica su GitHub</a> indicando pagina o
          endpoint, risultato atteso, risultato osservato, data e passaggi per riprodurlo. Non
          inserire dati personali, credenziali o informazioni riservate. Per una vulnerabilità non
          ancora corretta non aprire una issue: usa il{" "}
          <a href={`${REPO_URL}/security/advisories/new`}>report privato GitHub</a>.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Privacy</h2>
        <p>
          Le issue GitHub sono pubbliche. Non usarle per diritti privacy, dati personali o
          segnalazioni riservate. Un canale privato per queste richieste non è ancora indicato su
          questa pagina. Puoi presentare reclamo al{" "}
          <a href="https://www.garanteprivacy.it/" target="_blank" rel="noreferrer">
            Garante per la protezione dei dati personali
          </a>.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Collegare il server MCP</h2>
        <p>
          Usa l&apos;endpoint <code>{PUBLIC_MCP_ENDPOINT}</code> come server
          Streamable HTTP remoto. Non richiede autenticazione e offre soltanto tool read-only.
          Consulta la <a href="/mcp">pagina MCP</a> per catalogo e limiti prima di aprire una
          segnalazione.
        </p>
      </section>
    </main>
  );
}
