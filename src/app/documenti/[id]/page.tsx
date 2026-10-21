import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ACCESS_HELP,
  ACCESS_LABELS,
  CLASSIFICATION_HELP,
  READINESS_LABELS,
  THEME_LABELS,
  formatClassificationLabel,
  formatIsoDateIt,
  formatLicenseLabel,
  formatProvenanceForReaders,
  formatSoldiForReaders,
  getDocumentoDeclassificato,
  getDocumentiDeclassificati,
  PERIODO_READER_HELP,
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
  const snapshot = getDocumentiDeclassificati();
  const primaryUrl = doc.sourceUrls[0]!;
  const beforeHelp = CLASSIFICATION_HELP[doc.classificationBefore];
  const afterHelp = CLASSIFICATION_HELP[doc.classificationAfter];
  const relatedCards =
    doc.relatedDocuments?.map((link) => {
      const target = getDocumentoDeclassificato(link.id);
      return target ? { ...link, title: target.title } : null;
    }).filter((item): item is NonNullable<typeof item> => item !== null) ?? [];

  return (
    <main className={`shell page ${styles.shell}`} data-testid="documenti-detail">
      <p>
        <Link href="/documenti" className={styles.back}>
          ← Documenti declassificati
        </Link>
      </p>
      <div className="page-intro">
        <p className={styles.kicker}>
          {THEME_LABELS[doc.theme] ?? doc.theme} · {doc.issuingBodyLabel}
        </p>
        <h1>{doc.title}</h1>
        <p className={styles.lead}>{doc.summary}</p>
      </div>

      <div className={styles.detail}>
        <div className={styles.meta}>
          <span className={styles.badge}>{THEME_LABELS[doc.theme] ?? doc.theme}</span>
          <span className={styles.badge}>
            {formatClassificationLabel(doc.classificationBefore)} →{" "}
            {formatClassificationLabel(doc.classificationAfter)}
          </span>
          <span className={styles.badge}>
            {ACCESS_LABELS[doc.accessStatus] ?? doc.accessStatus}
          </span>
          <span className={styles.badge}>
            {READINESS_LABELS[doc.readiness] ?? doc.readiness}
          </span>
        </div>

        <section aria-labelledby="classifica" className={styles.block}>
          <h2 id="classifica" className="panel-title">
            Percorso di classifica
          </h2>
          <div className={styles.classPath}>
            <div>
              <p className={styles.classLabel}>Prima</p>
              <p className={styles.classValue}>{formatClassificationLabel(doc.classificationBefore)}</p>
              {beforeHelp ? <p className={styles.classHelp}>{beforeHelp}</p> : null}
            </div>
            <p className={styles.classArrow} aria-hidden="true">
              →
            </p>
            <div>
              <p className={styles.classLabel}>Dopo</p>
              <p className={styles.classValue}>{formatClassificationLabel(doc.classificationAfter)}</p>
              {afterHelp ? <p className={styles.classHelp}>{afterHelp}</p> : null}
            </div>
          </div>
          {doc.declassificationNote ? (
            <p className={styles.summary} role="note">
              {doc.declassificationNote}
            </p>
          ) : null}
          <p className={styles.note}>
            Declassificare non significa pubblicare online: lo stato di accesso sotto resta
            decisivo.
          </p>
        </section>

        {doc.cameraActRefs && doc.cameraActRefs.length > 0 ? (
          <section aria-labelledby="identificativi-camera" className={styles.block}>
            <h2 id="identificativi-camera" className="panel-title">
              Identificativi atti Camera citati
            </h2>
            <ul className={styles.refList}>
              {doc.cameraActRefs.map((ref) => (
                <li key={ref}>
                  <code>{ref}</code>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              Codici come compaiono nei resoconti ufficiali; i fascicoli integrali vanno cercati
              negli allegati o negli atti della Commissione sulla fonte.
            </p>
          </section>
        ) : null}

        {relatedCards.length > 0 ? (
          <section aria-labelledby="correlate" className={styles.block}>
            <h2 id="correlate" className="panel-title">
              Schede correlate
            </h2>
            <ul className={styles.relatedList}>
              {relatedCards.map((item) => (
                <li key={item.id}>
                  <Link href={`/documenti/${item.id}`}>{item.title}</Link>
                  <span className={styles.relatedRelation}>{item.relation}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="accesso" className={styles.block}>
          <h2 id="accesso" className="panel-title">
            Come si consulta
          </h2>
          <p className={styles.summary}>
            <strong>{ACCESS_LABELS[doc.accessStatus] ?? doc.accessStatus}.</strong>{" "}
            {ACCESS_HELP[doc.accessStatus] ?? ""}
          </p>
        </section>

        <section aria-labelledby="cronologia" className={styles.block}>
          <h2 id="cronologia" className="panel-title">
            Cronologia (date distinte)
          </h2>
          <ol className={styles.timeline}>
            <li>
              <span>Periodo del fatto / documento</span>
              <strong>{doc.eventPeriodLabel}</strong>
              <em>
                {doc.eventPeriodFrom || doc.eventPeriodTo
                  ? `${formatIsoDateIt(doc.eventPeriodFrom)} → ${formatIsoDateIt(doc.eventPeriodTo)}`
                  : "intervallo non dichiarato pezzo per pezzo"}
              </em>
            </li>
            <li>
              <span>Declassifica</span>
              <strong>{formatIsoDateIt(doc.declassifiedAt)}</strong>
              <em>quando l&apos;ente ha abbassato o tolto la classifica</em>
            </li>
            <li>
              <span>Pubblicazione / rilascio online</span>
              <strong>{formatIsoDateIt(doc.releasedAt)}</strong>
              <em>quando compare (o è reso) sulla fonte pubblica</em>
            </li>
            <li>
              <span>Verifica DVNS</span>
              <strong>{formatIsoDateIt(doc.verifiedAt)}</strong>
              <em>ultimo controllo nostro su URL e metadati</em>
            </li>
          </ol>
          <p className={styles.note}>{PERIODO_READER_HELP}</p>
        </section>

        <dl className={styles.dl}>
          <div>
            <dt>Ente emittente</dt>
            <dd>{doc.issuingBodyLabel}</dd>
          </div>
          <div>
            <dt>Identificativo scheda</dt>
            <dd>
              <code>{doc.id}</code>
            </dd>
          </div>
          <div>
            <dt>Prontezza del contenuto</dt>
            <dd>{READINESS_LABELS[doc.readiness] ?? doc.readiness}</dd>
          </div>
          <div>
            <dt>Soldi</dt>
            <dd>{formatSoldiForReaders(doc.soldi)}</dd>
          </div>
          <div>
            <dt>Provenienza</dt>
            <dd>{formatProvenanceForReaders(snapshot.source.authority)}</dd>
          </div>
        </dl>

        <section aria-labelledby="punti-chiave" className={styles.block}>
          <h2 id="punti-chiave" className="panel-title">
            Punti chiave
          </h2>
          <ul className={styles.points}>
            {doc.keyPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="limiti" className={styles.block}>
          <h2 id="limiti" className="panel-title">
            Limiti di questa scheda
          </h2>
          <p className={styles.summary} role="note">
            {doc.caveat}
          </p>
          <ul className={styles.points}>
            {snapshot.caveats.slice(0, 3).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="fonti" className={styles.block}>
          <h2 id="fonti" className="panel-title">
            Fonti ufficiali
          </h2>
          <a className={styles.cta} href={primaryUrl} target="_blank" rel="noreferrer">
            Leggi sulla fonte ufficiale ↗
          </a>
          <ul className={styles.sourceList}>
            {doc.sourceUrls.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Regola di evidenza: {snapshot.source.evidenceRule} Acquisizione catalogo:{" "}
            {formatIsoDateIt(snapshot.source.acquisitionDate)}. Licenza dichiarata:{" "}
            {formatLicenseLabel(snapshot.source.license)}
            {snapshot.source.licenseNote ? `. ${snapshot.source.licenseNote}` : ""}.
          </p>
        </section>
      </div>
    </main>
  );
}
