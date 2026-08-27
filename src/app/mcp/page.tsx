import type { Metadata } from "next";
import { AgentMcpPrompt, McpEndpoint } from "@/components/mcp-endpoint";
import { datasetCatalog } from "@/lib/mcp/catalog";
import { relatedMcpServices } from "@/lib/mcp/related-services";
import styles from "./mcp.module.css";

export const metadata: Metadata = {
  title: "MCP per i dati pubblici",
  description: "Collega un assistente AI ai dataset verificati di DoveVannoINostriSoldi.",
};

export default function McpPage() {
  return (
    <main className="shell page">
      <header className="page-intro">
        <h1>Interroga il portale con MCP</h1>
        <p>
          Il server MCP pubblico espone gli stessi dati e le stesse cautele del sito. È in sola
          lettura: non modifica fonti, record o configurazioni e non richiede credenziali.
        </p>
      </header>

      <section className={`panel ${styles.endpointPanel}`} aria-labelledby="endpoint-title">
        <h2 id="endpoint-title">Endpoint Streamable HTTP</h2>
        <McpEndpoint />
        <p>
          Copia l&apos;indirizzo qui sopra nel client MCP: è un endpoint tecnico e non una pagina da
          aprire nel browser. Il catalogo è
          disponibile anche come risorsa <code>dvns://datasets</code>. L&apos;indirizzo breve di
          questa pagina, <code>/mcp</code>, accetta comunque le richieste MCP per compatibilità:
          non è necessario indovinare un percorso diverso.
        </p>
      </section>

      <section className={styles.columns} aria-label="Come funziona">
        <article className="panel">
          <h2>Strumenti</h2>
          <dl className={styles.toolList}>
            <div><dt><code>list_datasets</code></dt><dd>Scopre fonti, filtri e limiti.</dd></div>
            <div><dt><code>query_dataset</code></dt><dd>Interroga snapshot locali o fonti ufficiali live.</dd></div>
          </dl>
        </article>
        <article className="panel">
          <h2>Uso responsabile</h2>
          <p>
            Pagamenti, costi, scostamenti e segnali non diventano automaticamente completamento,
            qualità, spreco o responsabilità. Ogni risposta conserva provenienza e metodologia.
          </p>
        </article>
      </section>

      <section className="panel" aria-labelledby="clients-title">
        <h2 id="clients-title">Collegalo ai client compatibili</h2>
        <p>
          Usa sempre l&apos;endpoint canonico qui sopra: Claude può aggiungerlo come connettore MCP
          remoto e Manufact può collegarlo come server esistente. L&apos;inclusione nelle directory
          pubbliche di ChatGPT o Claude richiede una candidatura e una review separate; non è
          implicita nel collegamento tecnico.
        </p>
        <p>
          Prima di inviare contesto tramite un servizio esterno, consulta <a href="/privacy">privacy</a>,{" "}
          <a href="/termini">termini</a> e <a href="/supporto">supporto</a>.
        </p>
      </section>

      <section className={`panel ${styles.promptPanel}`} aria-labelledby="agent-prompt-title">
        <h2 id="agent-prompt-title">Prompt pronto per un agente AI</h2>
        <p>
          Copialo in un agente che supporta server MCP remoti. Include la sequenza di discovery e
          i limiti necessari per non confondere fonti o significato dei dati.
        </p>
        <AgentMcpPrompt />
      </section>

      <section className="panel" aria-labelledby="datasets-title">
        <h2 id="datasets-title">{datasetCatalog.length} dataset interrogabili</h2>
        <div className="table-scroll" role="region" aria-label="Catalogo dei dataset MCP" tabIndex={0}>
          <table className={styles.datasetTable}>
            <caption className={styles.visuallyHidden}>
              Dataset disponibili nel server MCP, fonti ufficiali, modalità di aggiornamento,
              filtri e limiti interpretativi.
            </caption>
            <thead><tr><th scope="col">Dataset</th><th scope="col">Fonte</th><th scope="col">Aggiornamento</th><th scope="col">Filtri</th><th scope="col">Limiti</th></tr></thead>
            <tbody>
              {datasetCatalog.map((dataset) => (
                <tr id={`dataset-${dataset.id}`} key={dataset.id}>
                  <th scope="row">
                    <strong>{dataset.title}</strong>
                    <code className={styles.datasetId}>{dataset.id}</code>
                    <small>{dataset.summary}</small>
                  </th>
                  <td>
                    {dataset.sources.length > 0
                      ? dataset.sources.map((source, index) => (
                          <span className={styles.source} key={source.id}>
                            {index > 0 ? " · " : ""}
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${source.name}, fonte ufficiale, si apre in una nuova scheda`}
                            >
                              {source.name} ↗
                            </a>
                            <small>{source.owner}</small>
                          </span>
                        ))
                      : "Fonti indicate nella risposta"}
                  </td>
                  <td>
                    {dataset.freshness === "live"
                      ? "Fonte ufficiale interrogabile, con cache"
                      : "Snapshot verificato"}
                    {dataset.sources.length > 0 ? (
                      <small>
                        Cadenza: {[...new Set(dataset.sources.map((source) => source.cadence))].join(" · ")}
                      </small>
                    ) : null}
                  </td>
                  <td>{dataset.filters.length > 0 ? dataset.filters.join(", ") : "nessuno"}</td>
                  <td>{dataset.caveat ?? "Consulta fonte e metodologia nella risposta."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="related-mcp-title">
        <h2 id="related-mcp-title">MCP pubblici complementari</h2>
        <p className={styles.sectionIntro}>
          Servizi esterni segnalati a parte: restano fuori dal nostro endpoint e hanno proprietario,
          disponibilità e provenienza propri.
        </p>
        {relatedMcpServices.map((service) => (
          <article className={styles.relatedService} key={service.id}>
            <div className={styles.relatedServiceHead}>
              <div>
                <h3>{service.name}</h3>
                <p>{service.owner}</p>
              </div>
              <span className="tag tag-neutral">Servizio esterno</span>
            </div>
            <p>{service.scope}</p>
            <code className={styles.externalEndpoint}>{service.endpoint}</code>
            <dl className={styles.serviceFacts}>
              <div>
                <dt>Accesso</dt>
                <dd>{service.access}</dd>
              </div>
              <div>
                <dt>Limite dichiarato</dt>
                <dd>{service.rateLimit}</dd>
              </div>
              <div>
                <dt>Sequenza consigliata</dt>
                <dd>{service.preferredWorkflow.join(" → ")}</dd>
              </div>
              <div>
                <dt>Verificato da noi</dt>
                <dd>{new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "Europe/Rome" }).format(new Date(service.lastVerifiedAt))}</dd>
              </div>
            </dl>
            <p className={styles.externalCaveat}>{service.caveats.join(" ")}</p>
            <div className={styles.serviceLinks}>
              <a
                className="btn btn-secondary"
                href={service.aboutUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Istruzioni MCP di ${service.name}, si apre in una nuova scheda`}
              >
                Istruzioni ufficiali ↗
              </a>
              <a
                className="btn btn-secondary"
                href={service.repositoryUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Codice sorgente di ${service.name} su GitHub, si apre in una nuova scheda`}
              >
                Codice AgID ↗
              </a>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
