import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ACCESS_LABELS,
  THEME_LABELS,
  getDocumentoDeclassificato,
  getDocumentiDeclassificati,
} from "@/lib/documenti-declassificati";
import styles from "../documenti.module.css";

type Params = Promise<{ id: string }>;

export async function generateStaticParams() {
  return getDocumentiDeclassificati().documents.map((doc) => ({ id: doc.id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const doc = getDocumentoDeclassificato(id);
  if (!doc) return { title: "Documento non trovato" };
  return {
    title: doc.title,
    description: doc.summary.slice(0, 160),
  };
}

export default async function DocumentoPage({ params }: { params: Params }) {
  const { id } = await params;
  const doc = getDocumentoDeclassificato(id);
  if (!doc) notFound();
  const primaryUrl = doc.sourceUrls[0]!;

  return (
    <main className={`shell page ${styles.shell}`} data-testid="documenti-detail">
      <p>
        <Link href="/documenti" className={styles.back}>
          ← Documenti declassificati
        </Link>
      </p>
      <div className="page-intro">
        <h1>{doc.title}</h1>
        <p className={styles.lead}>{doc.summary}</p>
      </div>

      <div className={styles.detail}>
        <div className={styles.meta}>
          <span className={styles.badge}>{THEME_LABELS[doc.theme] ?? doc.theme}</span>
          <span className={styles.badge}>
            {doc.classificationBefore} → {doc.classificationAfter}
          </span>
          <span className={styles.badge}>
            {ACCESS_LABELS[doc.accessStatus] ?? doc.accessStatus}
          </span>
        </div>

        <dl className={styles.dl}>
          <div>
            <dt>Ente</dt>
            <dd>{doc.issuingBodyLabel}</dd>
          </div>
          <div>
            <dt>Periodo del fatto / documento</dt>
            <dd>{doc.eventPeriodLabel}</dd>
          </div>
          <div>
            <dt>Declassifica / rilascio</dt>
            <dd>
              {doc.declassifiedAt
                ? `Declassificato: ${doc.declassifiedAt}`
                : "Data di declassifica non dichiarata sulla scheda"}
              {doc.releasedAt ? ` · Pubblicato/rilasciato: ${doc.releasedAt}` : ""}
            </dd>
          </div>
          <div>
            <dt>Verificato da noi</dt>
            <dd>{doc.verifiedAt}</dd>
          </div>
          <div>
            <dt>Soldi</dt>
            <dd>
              {doc.soldi
                ? `${doc.soldi.kind}: ${doc.soldi.amountEuroCents} centesimi`
                : "Assente (non e un atto di spesa in questo pilota)"}
            </dd>
          </div>
        </dl>

        <section aria-labelledby="punti-chiave">
          <h2 id="punti-chiave" className="panel-title">
            Punti chiave
          </h2>
          <ul className={styles.points}>
            {doc.keyPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        <p className={styles.summary} role="note">
          {doc.caveat}
        </p>

        <a
          className={styles.cta}
          href={primaryUrl}
          target="_blank"
          rel="noreferrer"
        >
          Leggi sulla fonte ufficiale ↗
        </a>
        {doc.sourceUrls.length > 1 ? (
          <ul className={styles.points}>
            {doc.sourceUrls.slice(1).map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
