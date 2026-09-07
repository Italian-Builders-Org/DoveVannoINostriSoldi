import Link from "next/link";
import { integer, longDate } from "@/lib/format";
import { schoolServicesSource, type MunicipalitySchoolServices } from "@/lib/municipality-school-services";
import styles from "./scheda.module.css";

export function MunicipalitySchools({ services }: { services: MunicipalitySchoolServices }) {
  const data = services.status === "available" ? services.data : null;
  const datasetHref = `/dati/${schoolServicesSource.datasetId}${data ? `?q=${data.istatCode}` : ""}`;
  return (
    <section className={`panel ${styles.economicSection}`} id="dati-scuole" aria-labelledby="schools-title">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>MIM · contesto dei servizi</span>
          <h2 className={styles.sectionTitle} id="schools-title">Scuole statali nel Comune</h2>
        </div>
        <span className="tag tag-neutral">Anno scolastico {schoolServicesSource.schoolYear}</span>
      </div>
      <p className={styles.readingGuide}>
        Sedi censite nell’anagrafe del Ministero dell’Istruzione e del Merito al {longDate(schoolServicesSource.dataAsOf)}.
        Il conteggio descrive la presenza nel file, non la qualità didattica, i posti disponibili o i tempi per raggiungere una scuola.
      </p>
      {data ? (
        <>
          <dl className={styles.metricGrid}>
            <div>
              <dt>Sedi scolastiche statali censite</dt>
              <dd data-school-sites>{integer(data.schoolSites)}</dd>
              <small>Codici scuola indicati come sedi nella fonte; non edifici distinti.</small>
            </div>
          </dl>
          {data.schoolSites === 0 ? (
            <p className={styles.emptyState}>
              I record presenti per questo Comune non includono codici indicati come sedi scolastiche.
              Questo non prova che sul territorio non esistano scuole.
            </p>
          ) : null}
          <details className={styles.methodDetails}>
            <summary className={styles.schoolNotesSummary}>Come leggere il conteggio</summary>
            <p className={styles.readingGuide}>
              Ogni codice scuola compare una sola volta. La fonte distingue i codici indicati come sede
              da altri codici dell’anagrafe: per questo Comune questi ultimi sono {integer(data.otherRegistryCodes)}.
              Il collegamento territoriale usa codici ufficiali verificati, senza confrontare i nomi.
            </p>
            <p className={styles.readingGuide}>
              La sezione copre le sole scuole statali. Scuole paritarie, asili nido e altre strutture restano fuori perimetro.
              Non è un indicatore di spesa o di efficienza dei servizi.
            </p>
          </details>
        </>
      ) : (
        <p className={styles.emptyState}>{services.status !== "available" ? services.message : null}</p>
      )}
      <p className={styles.sourceNote}>
        Fonte: <a href={schoolServicesSource.landingUrl} target="_blank" rel="noreferrer">MIM · anagrafe delle scuole statali ↗</a>
        {" "}(IODL 2.0). <Link href={datasetHref}>Dati, raccordo territoriale e limiti della fonte</Link>.
      </p>
    </section>
  );
}
