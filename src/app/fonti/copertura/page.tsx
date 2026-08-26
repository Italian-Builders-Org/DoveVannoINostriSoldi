import type { Metadata } from "next";
import Link from "next/link";
import { integer } from "@/lib/format";
import { getIntegratedSourceCoverage } from "@/lib/integrated-public-view";
import styles from "./copertura.module.css";

export const metadata: Metadata = {
  title: "Copertura delle fonti integrate",
  description: "Inventario completo, identità di fonte, dataset, disposizioni e famiglie del corpus.",
};

const DISPOSITION_LABELS: Record<string, string> = {
  "manifest-only": "Presente nel registro, senza ripubblicazione del contenuto",
  "non-product": "Materiale tecnico o di lavorazione non usato come dato di prodotto",
  "private-quarantine": "Elemento in quarantena privata",
};

const FAMILY_LABELS: Record<string, string> = {
  administrations: "Amministrazioni",
  assignments: "Incarichi",
  "benchmarks-controls": "Benchmark e controlli",
  "collection-gaps": "Raccolta e buchi documentali",
  "communications-events": "Comunicazione ed eventi",
  participations: "Partecipazioni",
  "personnel-operations": "Personale e operatività",
  procurement: "Appalti",
  projects: "Progetti",
  "prototypes-releases": "Prototipi e versioni",
  transparency: "Trasparenza",
  uncategorized: "Non classificati",
};

function sortedCounts(values: Readonly<Record<string, number>>) {
  return Object.entries(values).sort((left, right) => right[1] - left[1]);
}

function sourceDate(value: string): string {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export default async function SourceCoveragePage() {
  const coverage = await getIntegratedSourceCoverage();

  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <p className={styles.eyebrow}>Copertura verificata</p>
        <h1>Che cosa è stato integrato e contabilizzato</h1>
        <p>
          Questa pagina chiude i denominatori: ogni elemento, ogni identità di fonte e ogni riga dei
          dataset selezionati è contato. Essere nel registro non significa che il contenuto sia
          adatto alla ripubblicazione o che descriva uno spreco.
        </p>
      </div>

      <section className="stat-strip" aria-label="Chiusura dei tre registri">
        <div>
          <span className="stat-label">Elementi inventariati</span>
          <span className="stat-value">
            {integer(coverage.archive.observedEntries)} / {integer(coverage.archive.expectedEntries)}
          </span>
          <span className="stat-note">inventario completo</span>
        </div>
        <div>
          <span className="stat-label">Identità di fonte</span>
          <span className="stat-value">
            {integer(coverage.sources.observedIdentities)} / {integer(coverage.sources.expectedIdentities)}
          </span>
          <span className="stat-note">pubbliche o in quarantena, tutte contate</span>
        </div>
        <div>
          <span className="stat-label">Righe dataset</span>
          <span className="stat-value">{integer(coverage.datasets.sourceRows)}</span>
          <span className="stat-note">equazione di pubblicazione chiusa</span>
        </div>
        <div>
          <span className="stat-label">Stato del rilascio</span>
          <span className={styles.completeValue}>{coverage.complete ? "Completo" : "Non completo"}</span>
          <span className="stat-note">il sito si arresta se le prove divergono</span>
        </div>
      </section>

      <div className="notice">
        <strong>Copertura completa, uso selettivo</strong>
        <p>
          Il registro mostra che niente è stato saltato. Poi si sceglie cosa entra nel prodotto e
          cosa resta in quarantena. “Solo manifesto” non significa dato mancante.
        </p>
      </div>

      <section className={styles.twoColumns}>
        <div className="panel">
          <h2 className="panel-title">Tipi di elemento</h2>
          <dl className={styles.countList}>
            <div><dt>File regolari</dt><dd>{integer(coverage.archive.regular)}</dd></div>
            <div><dt>Hard link</dt><dd>{integer(coverage.archive.hardlink)}</dd></div>
            <div><dt>Link simbolici</dt><dd>{integer(coverage.archive.symlink)}</dd></div>
            <div><dt>Byte memorizzati</dt><dd>{integer(coverage.archive.storedBytes)}</dd></div>
            <div><dt>Byte logici</dt><dd>{integer(coverage.archive.logicalBytes)}</dd></div>
          </dl>
        </div>
        <div className="panel">
          <h2 className="panel-title">Identità di fonte</h2>
          <dl className={styles.countList}>
            <div><dt>Valore pubblico</dt><dd>{integer(coverage.sources.published)}</dd></div>
            <div><dt>Valore in quarantena</dt><dd>{integer(coverage.sources.quarantined)}</dd></div>
            <div><dt>Occorrenze complessive</dt><dd>{integer(coverage.sources.totalOccurrences)}</dd></div>
          </dl>
          <p className={styles.panelNote}>
            Le {integer(coverage.sources.quarantined)} identità in quarantena restano traversabili con
            un ID opaco e uno stato, ma senza esporre il valore sorgente.
          </p>
          <Link href="/fonti/catalogo">Apri il catalogo completo →</Link>
        </div>
      </section>

      <section className="panel" aria-labelledby="dataset-equation-title">
        <h2 id="dataset-equation-title" className="panel-title">Equazione delle righe</h2>
        <div className="table-scroll" role="region" aria-label="Distribuzione delle righe integrate" tabIndex={0}>
          <table className="table">
            <caption>Le tre destinazioni si sommano alle righe sorgente, senza sovrapposizioni</caption>
            <thead>
              <tr>
                <th scope="col">Destinazione</th>
                <th scope="col" className="num">Righe</th>
                <th scope="col">Significato</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Righe pubbliche</th>
                <td className="num">{integer(coverage.datasets.publicRows)}</td>
                <td>Interrogabili come valori pubblici esatti.</td>
              </tr>
              <tr>
                <th scope="row">Solo catalogo</th>
                <td className="num">{integer(coverage.datasets.catalogOnlyRows)}</td>
                <td>Dataset visibile e contato, senza artefatto di righe pubbliche.</td>
              </tr>
              <tr>
                <th scope="row">Solo derivati</th>
                <td className="num">{integer(coverage.datasets.derivedOnlyRows)}</td>
                <td>Materiale derivato contato, non presentato come fonte primaria.</td>
              </tr>
              <tr>
                <th scope="row">Totale sorgente</th>
                <td className="num">{integer(coverage.datasets.sourceRows)}</td>
                <td>{integer(coverage.datasets.datasets)} dataset riconciliati.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="dataset-sources-title">
        <h2 id="dataset-sources-title" className="panel-title">
          Fonte e freschezza dei {integer(coverage.datasets.datasets)} dataset
        </h2>
        <p className={styles.panelNote}>
          Le date non presenti nel materiale restano dichiarate come non disponibili. Il controllo
          indica la verifica dello snapshot integrato, non la data di pubblicazione dell’ente.
        </p>
        <div className="table-scroll" role="region" aria-label="Fonti e freschezza dei dataset integrati" tabIndex={0}>
          <table className={`table ${styles.datasetSources}`}>
            <caption>Titolare, periodo, fonte canonica e data del controllo per ogni dataset</caption>
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Titolare</th>
                <th scope="col">Periodo</th>
                <th scope="col">Fonte</th>
                <th scope="col">Controllo</th>
              </tr>
            </thead>
            <tbody>
              {coverage.datasets.entries.map((dataset) => (
                <tr id={`dataset-${dataset.id}`} key={dataset.id}>
                  <th scope="row"><Link href={`/dati/${dataset.id}`}>{dataset.title}</Link></th>
                  <td>{dataset.sourceMetadata.holder}</td>
                  <td>{dataset.sourceMetadata.referencePeriod ?? "Non disponibile"}</td>
                  <td>
                    {dataset.sourceMetadata.canonicalUrls[0] ? (
                      <a href={dataset.sourceMetadata.canonicalUrls[0]} target="_blank" rel="noreferrer">
                        Portale sorgente
                      </a>
                    ) : (
                      <span>URL canonico non disponibile</span>
                    )}
                  </td>
                  <td>
                    <time dateTime={dataset.sourceMetadata.checkedAt}>
                      {sourceDate(dataset.sourceMetadata.checkedAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="dispositions-title">
        <h2 id="dispositions-title" className="panel-title">Disposizioni di tutti gli elementi</h2>
        <ul className={styles.barList}>
          {sortedCounts(coverage.archive.dispositions).map(([name, count]) => (
            <li key={name}>
              <div>
                <strong>{DISPOSITION_LABELS[name] ?? name}</strong>
                <span>{integer(count)}</span>
              </div>
              <progress
                value={count}
                max={coverage.archive.observedEntries}
                aria-label={`${DISPOSITION_LABELS[name] ?? name}: ${integer(count)} su ${integer(coverage.archive.observedEntries)}`}
              >
                {integer(count)} su {integer(coverage.archive.observedEntries)}
              </progress>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="families-title">
        <h2 id="families-title" className="panel-title">Famiglie del corpus</h2>
        <div className="table-scroll" role="region" aria-label="Famiglie degli elementi inventariati" tabIndex={0}>
          <table className="table">
            <caption className={styles.visuallyHidden}>
              Famiglie e numero degli elementi inventariati
            </caption>
            <thead><tr><th scope="col">Famiglia</th><th scope="col" className="num">Elementi</th></tr></thead>
            <tbody>
              {sortedCounts(coverage.archive.families).map(([name, count]) => (
                <tr key={name}>
                  <th scope="row">{FAMILY_LABELS[name] ?? name}</th>
                  <td className="num">{integer(count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`panel ${styles.nextLinks}`}>
        <h2 className="panel-title">Dal registro ai dati</h2>
        <Link href="/dati">
          Apri tutti i {integer(coverage.datasets.datasets)} dataset →
        </Link>
        <Link href="/fonti/catalogo">
          Controlla tutte le {integer(coverage.sources.observedIdentities)} identità →
        </Link>
      </section>
    </main>
  );
}
