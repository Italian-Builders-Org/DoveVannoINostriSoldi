import type { Metadata } from "next";
import Link from "next/link";
import { shortDate } from "@/lib/format";
import { REPO_URL } from "@/lib/site";
import { latestDataBySlug } from "@/lib/source-latest-data";
import { publicSources, sourceCounts } from "@/lib/sources";
import styles from "./fonti.module.css";

export const metadata: Metadata = {
  title: "Fonti",
  description: "Da dove arrivano i dati, quanto spesso cambiano e quali fonti sono già collegate.",
};

export default function SourcesPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Da dove arrivano i dati</h1>
        <p>
          Ogni numero su questo sito viene da una fonte pubblica ufficiale. Qui trovi quali sono,
          cosa contengono e quando le controlliamo.
        </p>
      </div>

      <div className="stat-strip">
        <div>
          <span className="stat-label">Fonti collegate</span>
          <span className="stat-value">{sourceCounts.total}</span>
          <span className="stat-note">tutte con un adapter operativo</span>
        </div>
      </div>

      <section className="panel">
        <div className="table-scroll" role="region" aria-label="Registro delle fonti" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Fonte</th>
                <th scope="col">Cosa contiene</th>
                <th scope="col">Chi la pubblica</th>
                <th scope="col">Ogni quanto esce</th>
                <th scope="col">Ultimo dato</th>
              </tr>
            </thead>
            <tbody>
              {publicSources.map((source) => {
                const latest = latestDataBySlug[source.slug];
                return (
                  <tr id={source.slug} key={source.slug}>
                    <th scope="row">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${source.name}, fonte ufficiale, si apre in una nuova scheda`}
                      >
                        {source.name} ↗
                      </a>
                      <small>{source.area}</small>
                    </th>
                    <td>{source.coverage}</td>
                    <td>{source.owner}</td>
                    <td>{source.cadence}</td>
                    <td className={styles.latest}>
                      {latest?.kind === "date"
                        ? shortDate(latest.value)
                        : latest?.kind === "period"
                          ? latest.label
                          : "scoperta automatica"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.principles}>
        <section className="panel">
          <h2 className="panel-title">Come lavoriamo</h2>
          <p>
            Scarichiamo i file ufficiali, li ricontiamo e mostriamo sempre il periodo o la data
            dichiarata dalla fonte, separandoli dal momento in cui li abbiamo controllati. Non
            cambiamo mai il significato di un dato e non inventiamo numeri che la fonte non pubblica.
          </p>
        </section>
        <section className="panel">
          <h2 className="panel-title">Se un dato manca</h2>
          <p>
            Lo scriviamo. Se una fonte è in ritardo o non copre un anno, lo trovi scritto accanto al
            numero, invece di uno spazio vuoto o una stima nascosta.
          </p>
        </section>
        <section className="panel">
          <h2 className="panel-title">Licenze e riuso</h2>
          <p>
            Ogni dato mantiene le condizioni di riuso indicate dalla fonte che lo pubblica. Il
            codice di questa piattaforma è open source su{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">Collegamenti diretti alle fonti</h2>
        <ul className={styles.linkList}>
          {publicSources.map((source) => (
            <li key={source.slug}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${source.name} di ${source.owner}, si apre in una nuova scheda`}
              >
                {source.name} · {source.owner} <i aria-hidden="true">↗</i>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className="notice">
        <strong>“Aggiornato” significa: aggiornato quanto la fonte</strong>
        <p>
          Se una fonte pubblica nuovi dati una volta al mese, non li chiamiamo dati in tempo reale.
          Mostriamo l&apos;ultimo periodo disponibile, quando lo abbiamo controllato e quando è
          atteso il prossimo aggiornamento.{" "}
          <Link href="/fonti/stato">Stato operativo delle fonti →</Link> ·{" "}
          <Link href="/metodologia">Come leggiamo i dati →</Link>
        </p>
      </div>
    </main>
  );
}
