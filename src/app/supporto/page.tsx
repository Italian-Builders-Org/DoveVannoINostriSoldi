import type { Metadata } from "next";
import { ReportProblemButton } from "@/components/report-problem/report-problem-button";
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
          Il modo più rapido è il pulsante <ReportProblemButton variant="inline" /> presente in
          ogni pagina: raccoglie tipo di problema, risultato osservato, risultato atteso ed
          eventuale fonte ufficiale, allega pagina, data e ora, dimensione della
          finestra e versione del browser, e crea una issue pubblica nel repository restituendone
          il link. I passaggi per riprodurre sono obbligatori per un bug, un dato contestato o un
          problema di accessibilità; per una nuova funzionalità puoi lasciarli vuoti. Se
          l&apos;invio automatico non è disponibile, il modulo propone il composer
          GitHub già compilato.
        </p>
        <p>
          In alternativa apri direttamente una <a href={`${REPO_URL}/issues`}>issue pubblica su
          GitHub</a> indicando pagina o endpoint, risultato atteso, risultato osservato, data e
          passaggi per riprodurlo. In entrambi i casi non inserire dati personali, credenziali o
          informazioni riservate: le issue sono pubbliche. Per una vulnerabilità non
          ancora corretta non usare né il modulo né una issue: usa il{" "}
          <a href={`${REPO_URL}/security/advisories/new`}>report privato GitHub</a>.
        </p>
        <p>
          Per contestare un dato indica il link della fonte ufficiale con cui lo confronti. Un
          valore diverso da quello atteso non dimostra da solo spreco, frode o responsabilità.
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
