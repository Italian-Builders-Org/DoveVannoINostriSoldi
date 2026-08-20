import type { Metadata } from "next";
import Link from "next/link";
import { publicSources, sourceCounts } from "@/lib/sources";

export const metadata: Metadata = {
  title: "Fonti",
  description: "Da dove arrivano i dati, quanto spesso cambiano e quali fonti sono già collegate.",
};

const statusLabel = {
  attiva: "Collegata",
  integrazione: "Ci stiamo lavorando",
  mappata: "Individuata",
};

export default function SourcesPage() {
  return (
    <main className="subpage">
      <header className="page-intro">
        <h1>Da dove arrivano i dati</h1>
        <p>
          Qui trovi chi pubblica ogni dato, che cosa contiene, quanto spesso cambia
          e se è già collegato al sito.
        </p>
        <div className="hero-actions" style={{ justifyContent: "flex-start" }}>
          <Link href="/fonti/stato" className="button button-primary">
            Le fonti funzionano?
          </Link>
          <Link href="/metodologia" className="button button-secondary">
            Come leggiamo i dati
          </Link>
        </div>
        <dl className="source-counts" aria-label="Copertura del registro">
          <div><dt>Totale</dt><dd>{sourceCounts.total}</dd></div>
          <div><dt>Fonti collegate</dt><dd>{sourceCounts.active}</dd></div>
          <div><dt>In lavorazione</dt><dd>{sourceCounts.integrating}</dd></div>
          <div><dt>Da collegare</dt><dd>{sourceCounts.mapped}</dd></div>
        </dl>
      </header>

      <section className="source-table-wrap">
        <div className="source-table-header">
          <span>Fonte</span><span>Copertura</span><span>Aggiornamento</span><span>Stato</span>
        </div>
        {publicSources.map((source) => (
          <article className="source-table-row" id={source.slug} key={source.slug}>
            <div>
              <a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>
              <small>{source.owner} · {source.area}</small>
              <p>{source.note}</p>
            </div>
            <div>
              <strong>{source.coverage}</strong><small>{source.format}</small>
              {source.joinKeys && <small>Campi usati per collegare i dati: {source.joinKeys.join(", ")}</small>}
            </div>
            <div><strong>{source.cadence}</strong></div>
            <div><span className={`status status-${source.status}`}>{statusLabel[source.status]}</span></div>
          </article>
        ))}
      </section>

      <section className="notice">
        <strong>“Aggiornato” significa: aggiornato quanto la fonte.</strong>
        <p>
          Se una fonte pubblica nuovi dati una volta al mese, non li chiamiamo dati in tempo reale.
          Mostriamo l&apos;ultimo periodo disponibile, quando lo abbiamo controllato e quando è atteso
          il prossimo aggiornamento.
        </p>
      </section>
    </main>
  );
}
