import type { Metadata } from "next";
import Link from "next/link";
import {
  ACCESS_LABELS,
  BODY_LABELS,
  READINESS_LABELS,
  THEME_LABELS,
  getDocumentiDeclassificati,
  listDocumentiDeclassificati,
} from "@/lib/documenti-declassificati";
import styles from "./documenti.module.css";

export const metadata: Metadata = {
  title: "Documenti declassificati",
  description:
    "Schede curate di atti e fondi ufficiali italiani declassificati o desecretati: metadati, punti chiave e link alle fonti (Senato, Camera, ACS).",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function DocumentiPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const theme = one(params.tema);
  const body = one(params.ente);
  const access = one(params.accesso);
  const snapshot = getDocumentiDeclassificati();
  const documents = listDocumentiDeclassificati({
    theme: theme || undefined,
    issuingBody: body || undefined,
    accessStatus: access || undefined,
  });

  return (
    <main className={`shell page ${styles.shell}`} data-testid="documenti-hub">
      <div className="page-intro">
        <h1>Documenti declassificati</h1>
        <p className={styles.lead}>
          In Italia non esiste un portale unico tipo CIA Reading Room. I documenti
          declassificati e desecretati sono sparsi tra Senato, Camera, Archivio Centrale
          dello Stato e altri depositi. Qui pubblichiamo schede verificate: cosa e,
          cosa e stato declassificato, punti chiave, e il link alla fonte ufficiale.
        </p>
      </div>

      <div className={styles.caveatBox} role="note">
        <p>
          <strong>Declassificare non significa pubblicare online.</strong>{" "}
          {snapshot.coverage.documentsPublished} schede nel pilota · controllato il{" "}
          {snapshot.coverage.checkedAt}.{" "}
          {snapshot.caveats[0]}
        </p>
      </div>

      <section aria-labelledby="quadro-normativo">
        <h2 id="quadro-normativo" className="panel-title">
          Quadro normativo, in breve
        </h2>
        <div className={styles.normGrid}>
          <article className={styles.normCard}>
            <h3>Declassifica ordinaria</h3>
            <p>
              Legge 124/2007 art. 42: dopo 5 anni la classifica scende di un livello; dopo
              10 anni cessa di regola, salvo proroghe.
            </p>
          </article>
          <article className={styles.normCard}>
            <h3>Segreto di Stato</h3>
            <p>
              Art. 39: dopo 15 anni si puo chiedere l&apos;accesso; il vincolo ordinario non
              supera 30 anni complessivi.
            </p>
          </article>
          <article className={styles.normCard}>
            <h3>Archivi storici</h3>
            <p>
              d.lgs. 42/2004 art. 122: termini di consultabilita (anche 40/50/70 anni) per
              documenti riservati o con dati sensibili.
            </p>
          </article>
          <article className={styles.normCard}>
            <h3>FOIA italiano</h3>
            <p>
              d.lgs. 97/2016: accesso civico generalizzato ai documenti delle PA, distinto
              dalla declassifica di atti classificati.
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="elenco-documenti">
        <h2 id="elenco-documenti" className="panel-title">
          Schede del pilota
        </h2>
        <form className={styles.filters} method="get">
          <label>
            Tema
            <select name="tema" defaultValue={theme}>
              <option value="">Tutti</option>
              {snapshot.coverage.themes.map((id) => (
                <option key={id} value={id}>
                  {THEME_LABELS[id] ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ente
            <select name="ente" defaultValue={body}>
              <option value="">Tutti</option>
              {snapshot.coverage.issuingBodies.map((id) => (
                <option key={id} value={id}>
                  {BODY_LABELS[id] ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Accesso
            <select name="accesso" defaultValue={access}>
              <option value="">Tutti</option>
              {Object.keys(ACCESS_LABELS).map((id) => (
                <option key={id} value={id}>
                  {ACCESS_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button">
            Filtra
          </button>
        </form>

        {documents.length === 0 ? (
          <p className={styles.lead}>Nessuna scheda per questi filtri.</p>
        ) : (
          <ul className={styles.list}>
            {documents.map((doc) => (
              <li key={doc.id} className={styles.row}>
                <Link href={`/documenti/${doc.id}`} className={styles.rowTitle}>
                  {doc.title}
                </Link>
                <div className={styles.meta}>
                  <span className={styles.badge}>{THEME_LABELS[doc.theme] ?? doc.theme}</span>
                  <span className={styles.badge}>
                    {ACCESS_LABELS[doc.accessStatus] ?? doc.accessStatus}
                  </span>
                  <span>{doc.issuingBodyLabel}</span>
                  <span>
                    {doc.classificationBefore} → {doc.classificationAfter}
                  </span>
                  <span>{doc.eventPeriodLabel}</span>
                  <span>{READINESS_LABELS[doc.readiness] ?? doc.readiness}</span>
                </div>
                <p className={styles.summary}>{doc.summary}</p>
                <p className={styles.note}>
                  {doc.keyPoints.length} punti chiave · verificato {doc.verifiedAt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={styles.lead}>
        Fonti e limiti: vedi la{" "}
        <a href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/blob/main/docs/DOCUMENTI_DECLASSIFICATI.md">
          documentazione del dataset
        </a>
        . Issue di catalogazione:{" "}
        <a href={snapshot.source.issueUrl}>#{snapshot.source.issueUrl.split("/").at(-1)}</a>.
      </p>
    </main>
  );
}
