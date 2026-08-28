import type { Metadata } from "next";
import styles from "../legal-page.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Come trattiamo i dati tecnici necessari a erogare il sito.",
};

export default function PrivacyPage() {
  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <h1>Informativa privacy</h1>
        <p>
          Questa pagina descrive i dati tecnici necessari a erogare il sito. Il portale legge fonti
          pubbliche e non chiede un account.
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Dati tecnici</h2>
        <p>
          Vercel, il provider di hosting, può trattare log tecnici, come indirizzo IP, user
          agent, orario e percorso richiesto, per consegnare, proteggere e diagnosticare il
          servizio. L&apos;applicazione non aggiunge ai log il contenuto delle richieste MCP. I log
          runtime restano disponibili secondo il piano Vercel attivo: un&apos;ora su Hobby, un
          giorno su Pro, tre giorni su Enterprise oppure fino a 30 giorni con Observability
          Plus. Consulta i limiti aggiornati dei{" "}
          <a href="https://vercel.com/docs/logs/runtime" target="_blank" rel="noreferrer">
            log runtime di Vercel
          </a>{" "}
          e il relativo{" "}
          <a href="https://vercel.com/legal/dpa" target="_blank" rel="noreferrer">
            accordo sul trattamento dei dati
          </a>. La home può
          ricavare dal provider una Regione approssimativa per proporre la mappa iniziale:
          l&apos;applicazione non mostra né salva l&apos;indirizzo IP e puoi cambiare Regione in ogni
          momento.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Misurazione delle visite</h2>
        <p>
          Il sito usa Google Analytics 4 (Google tag) per capire quali pagine vengono lette. Google
          tratta i dati secondo la propria informativa; consulta{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Privacy Policy di Google
          </a>{" "}
          e, se disponibile nel tuo browser,{" "}
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noreferrer">
            il componente aggiuntivo per disattivare Google Analytics
          </a>. Non usiamo il tag per profilazione pubblicitaria sul sito.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Server MCP e assistenti esterni</h2>
        <p>
          L&apos;endpoint MCP è pubblico, senza account o autenticazione e in sola lettura. Riceve
          richieste tecniche, filtri e parametri necessari a interrogare i dataset;
          l&apos;applicazione non crea un profilo utente né un archivio delle conversazioni. Restano
          possibili i log tecnici Vercel descritti sopra. Se colleghi l&apos;endpoint tramite un
          client o un gateway esterno, per esempio ChatGPT, Claude o Manufact, quel servizio
          tratta la richiesta secondo la propria informativa, conservazione e impostazioni:
          controllale prima di inviare testo o contesto. I tool DVNS espongono soltanto dati
          pubblici e non hanno bisogno di dati personali. Collegando direttamente il server,
          Manufact inoltra le richieste all&apos;endpoint DVNS; attivando proxy, analytics o cattura
          dei payload può trattare anche metadati e contenuto delle richieste secondo la sua{" "}
          <a href="https://manufact.com/privacy" target="_blank" rel="noreferrer">
            informativa privacy
          </a>.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Assistente testuale del portale</h2>
        <p>
          L&apos;assistente deterministico in <a href="/assistente">/assistente</a> interpreta solo
          poche domande allowlisted e interroga direttamente gli adapter read-only. Il testo della
          domanda non viene salvato, inserito in una cronologia o scritto nei log applicativi; la
          versione attuale non usa voce, modelli linguistici o analytics sulle domande. Restano
          possibili i log tecnici del provider di hosting descritti sopra.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">I tuoi diritti</h2>
        <p>
          Un canale privato per accesso, correzione, cancellazione, limitazione, portabilità quando
          applicabile o opposizione non è ancora indicato sul sito. Le issue GitHub sono pubbliche:
          non inviare dati personali. Puoi presentare reclamo al Garante per la protezione dei dati
          personali. La pagina <a href="/supporto">Supporto</a> resta per problemi tecnici del sito.
        </p>
      </section>
    </main>
  );
}
