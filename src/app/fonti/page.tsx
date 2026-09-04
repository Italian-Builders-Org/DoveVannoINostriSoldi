import type { Metadata } from "next";
import Link from "next/link";
import { shortDate } from "@/lib/format";
import { companyAtlasSourceList } from "@/lib/company-atlas-metadata";
import { istatTurnoverSourceMetadata } from "@/lib/istat-turnover-metadata";
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

      <section className="panel" aria-labelledby="company-atlas-sources-title">
        <h2 id="company-atlas-sources-title" className="panel-title">Fonti del modulo Imprese</h2>
        <p>
          L&apos;Atlante Imprese usa tre release aggregate di CCIAA Marche su dati InfoCamere
          e la stima anticipata ISTAT 2024 (Frame Territoriale Anticipato). Sono
          registrate qui con periodo osservato e licenza; non fanno ancora parte del
          registry operativo delle fonti civiche.
        </p>
        <p id="company-atlas-sources-scroll-hint" className={styles.scrollHint}>
          Scorri orizzontalmente per leggere tutte le colonne della tabella.
        </p>
        <div
          className="table-scroll"
          role="region"
          aria-label="Fonti dell'Atlante Imprese"
          aria-describedby="company-atlas-sources-scroll-hint"
          tabIndex={0}
        >
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Fonte</th>
                <th scope="col">Copertura</th>
                <th scope="col">Ultimo aggiornamento</th>
                <th scope="col">Licenza</th>
              </tr>
            </thead>
            <tbody>
              {[...companyAtlasSourceList, istatTurnoverSourceMetadata].map((source) => (
                <tr key={source.id}>
                  <th scope="row">
                    <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
                  </th>
                  <td>{source.coverage}</td>
                  <td>{shortDate(source.updatedAt)} · osservato {shortDate(source.observedAt)}</td>
                  <td>{source.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Il modulo mostra soltanto aggregati regionali: sezioni ATECO 2025 per le fonti
          camerali, macro-settori ATECO 2007 agg. 2022 per il fatturato ISTAT. Non nomi di
          aziende, identificativi o fatturato individuale. <Link href="/imprese">Apri Atlante Imprese →</Link>
        </p>
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
        <strong>“Aggiornato” quanto la fonte</strong>
        <p>
          Se la fonte pubblica i dati una volta al mese, non sono in tempo reale. Mostriamo ultimo
          periodo, ultimo controllo e prossimo aggiornamento atteso.{" "}
          <Link href="/fonti/calendario">Calendario documenti →</Link> ·{" "}
          <Link href="/fonti/stato">Stato delle fonti →</Link> ·{" "}
          <Link href="/metodologia">Metodo →</Link>
        </p>
      </div>
    </main>
  );
}
