import type { Metadata } from "next";
import Link from "next/link";
import IntegratedSurfacePreview from "@/components/integrated-surface-preview";
import { integer, longDate, percent } from "@/lib/format";
import { getEditorialSurfacePreview } from "@/lib/integrated-editorial";
import { mefParticipationsSnapshot as snapshot } from "@/lib/mef-participations-snapshot";
import styles from "./partecipazioni.module.css";

export const metadata: Metadata = {
  title: "Partecipazioni pubbliche",
  description: "Quadro verificabile del censimento MEF delle partecipazioni pubbliche.",
};

function requireParticipationPreview() {
  const preview = getEditorialSurfacePreview("/partecipazioni");
  if (!preview) {
    throw new Error("Preview editoriale delle partecipazioni non configurata.");
  }
  return preview;
}

const participationPreview = requireParticipationPreview();

export default function ParticipationsPage() {
  const directShare = snapshot.totals.participationRecords > 0
    ? (snapshot.totals.directParticipationRecords / snapshot.totals.participationRecords) * 100
    : 0;

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/enti">Enti e società</Link>
        <span aria-hidden="true">/</span>
        <span>Partecipazioni</span>
      </nav>

      <div className="page-intro">
        <h1>Partecipazioni pubbliche</h1>
        <p>
          Relazioni dichiarate dalle amministrazioni nel censimento MEF, riferite al{" "}
          {longDate(snapshot.referenceDate)}. Una partecipazione non significa automaticamente che
          la società sia oggi controllata dalla PA o operi per essa.
        </p>
      </div>

      <div className="stat-strip">
        <div>
          <span className="stat-label">Partecipazioni dichiarate</span>
          <span className="stat-value">{integer(snapshot.totals.participationRecords)}</span>
          <span className="stat-note">una riga per ogni ente-società</span>
        </div>
        <div>
          <span className="stat-label">Amministrazioni dichiaranti</span>
          <span className="stat-value">{integer(snapshot.totals.declaringAdministrations)}</span>
          <span className="stat-note">enti che hanno risposto</span>
        </div>
        <div>
          <span className="stat-label">Organizzazioni partecipate</span>
          <span className="stat-value">{integer(snapshot.totals.participatedOrganizations)}</span>
          <span className="stat-note">società e altri organismi</span>
        </div>
        <div>
          <span className="stat-label">Quote dirette</span>
          <span className="stat-value">{integer(snapshot.totals.directParticipationRecords)}</span>
          <span className="stat-note">
            {percent(directShare)} del totale, il resto è indiretto
          </span>
        </div>
      </div>

      <div className={styles.split}>
        <section className="panel">
          <h2 className="panel-title">Dirette e indirette</h2>
          <div className={styles.track} aria-hidden="true">
            <i style={{ width: `${directShare}%` }} />
          </div>
          <ul className={styles.legend}>
            <li>
              <i className={styles.direct} aria-hidden="true" />
              Dirette · {integer(snapshot.totals.directParticipationRecords)}
            </li>
            <li>
              <i className={styles.indirect} aria-hidden="true" />
              Indirette · {integer(snapshot.totals.indirectParticipationRecords)}
            </li>
          </ul>
          <p className={styles.note}>
            Composizione delle relazioni nella rilevazione.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">Indicazioni dichiarate nella rilevazione</h2>
          <dl className={styles.evidence}>
            <div>
              <dt>Controllo analogo dichiarato</dt>
              <dd>{integer(snapshot.declaredEvidence.analogControlRecords)}</dd>
            </div>
            <div>
              <dt>Affidamento diretto dichiarato</dt>
              <dd>{integer(snapshot.declaredEvidence.directAwardRecords)}</dd>
            </div>
            <div>
              <dt>Entrambi i segnali</dt>
              <dd>{integer(snapshot.declaredEvidence.bothSignalsRecords)}</dd>
            </div>
          </dl>
          <p className={styles.note}>{snapshot.declaredEvidence.legalMeaning}</p>
        </section>
      </div>

      <IntegratedSurfacePreview preview={participationPreview} />

      <section className="panel">
        <h2 className="panel-title">Organizzazioni dichiarate da più amministrazioni</h2>
        <p className={styles.tableHint} id="participations-table-hint">
          Scorri lateralmente per codice fiscale e numero di amministrazioni. Da tastiera usa
          Freccia sinistra e Freccia destra.
        </p>
        <div className="table-scroll" role="region" aria-label="Organizzazioni partecipate da più amministrazioni" aria-describedby="participations-table-hint" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Società</th>
                <th scope="col">Codice fiscale</th>
                <th scope="col" className="num">Amministrazioni</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.topCompaniesByDeclaringAdministrations.map((company, index) => (
                <tr key={company.taxCode}>
                  <td>{index + 1}</td>
                  <th scope="row">{company.name}</th>
                  <td>
                    <code>{company.taxCode}</code>
                  </td>
                  <td className="num">{integer(company.declaringAdministrations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Conteggio delle amministrazioni con una relazione nel CSV MEF {snapshot.referenceYear}.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Da dove arrivano i dati</h2>
        <dl className={styles.sourceGrid}>
          <div>
            <dt>Data del dato</dt>
            <dd>{longDate(snapshot.referenceDate)}</dd>
          </div>
          <div>
            <dt>Pubblicato dal MEF</dt>
            <dd>{longDate(snapshot.publishedAt)}</dd>
          </div>
          <div>
            <dt>Scaricato da noi</dt>
            <dd>{longDate(snapshot.generatedAt)}</dd>
          </div>
          <div>
            <dt>Formato del testo</dt>
            <dd>{snapshot.source.detectedEncoding}</dd>
          </div>
          <div>
            <dt>Licenza</dt>
            <dd>{snapshot.source.license}</dd>
          </div>
          <div>
            <dt>SHA-256 originale</dt>
            <dd>
              <code>{snapshot.source.rawSha256}</code>
            </dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <a className="btn btn-secondary" href={snapshot.source.assetUrl} target="_blank" rel="noreferrer">
            Scarica il CSV originale ↗
          </a>
          <a className="btn btn-secondary" href={snapshot.source.landingUrl} target="_blank" rel="noreferrer">
            Apri la rilevazione MEF ↗
          </a>
        </div>
      </section>
    </main>
  );
}
