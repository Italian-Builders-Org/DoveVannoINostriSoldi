import type { Metadata } from "next";
import Link from "next/link";
import IntegratedSectionPreview from "@/components/integrated-section-preview";
import type { EvidenceObservation } from "@/lib/data/public-spending-evidence-contract";
import { exactEuro, longDate, percent } from "@/lib/format";
import {
  restorationBenchmarkReference,
  restorationComparisonSnapshot,
  restorationPublishableAnomalies,
} from "@/lib/vive-restoration-snapshot";
import styles from "./confronti.module.css";

export const metadata: Metadata = {
  title: "Confronti verificati sulla spesa pubblica",
  description:
    "Tre affidamenti ufficiali per restauri destinati alla stessa mostra, confrontati con importi, perimetro e limiti espliciti.",
};

function euros(cents: number): number {
  return cents / 100;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return sign + percent(Math.abs(value));
}

function benchmarkDeltaPercent(observation: EvidenceObservation): number {
  const value = observation.benchmark?.targetDeltaPercent;
  if (value === null || value === undefined) {
    throw new Error("Snapshot confronti non valido: scostamento percentuale assente");
  }
  return value;
}

const observations = [...restorationComparisonSnapshot.observations].sort(
  (left, right) => (right.amount?.valueCents ?? 0) - (left.amount?.valueCents ?? 0),
);
const sourceById = new Map(
  restorationComparisonSnapshot.sources.map((source) => [source.id, source]),
);
const highest = observations[0];
const lowest = observations.at(-1)!;
const highestCents = highest.amount!.valueCents;
const lowestCents = lowest.amount!.valueCents;
const medianCents = restorationBenchmarkReference.amount!.valueCents;
const rangeCents = highestCents - lowestCents;
const highToLowRatio = highestCents / lowestCents;

export default function ConfrontiPage() {
  return (
    <main className={"shell page " + styles.page}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/controlli">Cosa controllare</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Confronti verificati</span>
      </nav>

      <div className="page-intro">
        <h1>Tre restauri, importi da 280 € a 6.270 €</h1>
        <p>
          Stesso ente, stessa mostra e stesso tipo di affidamento. Il valore più alto è{" "}
          {highToLowRatio.toLocaleString("it-IT", { maximumFractionDigits: 1 })} volte quello più
          basso. La differenza è reale; i dati disponibili non ne spiegano la causa.
        </p>
      </div>

      <div className={styles.scopeBand} role="group" aria-label="Perimetro del confronto">
        <div>
          <span>Ente</span>
          <strong>{highest.subject.spendingEntity.name}</strong>
        </div>
        <div>
          <span>Procedura</span>
          <strong>Affidamento diretto</strong>
        </div>
        <div>
          <span>Oggetto confrontato</span>
          <strong>Restauro di un singolo dipinto</strong>
        </div>
        <div>
          <span>Importi</span>
          <strong>Netti IVA · totale affidamento</strong>
        </div>
      </div>

      <section className={"panel " + styles.finding} aria-labelledby="finding-title">
        <div>
          <h2 id="finding-title">Il divario che merita una spiegazione</h2>
          <p>
            Tra l&apos;affidamento più basso e quello più alto ci sono{" "}
            <strong>{exactEuro(euros(rangeCents))}</strong>. Rispetto alla mediana della piccola
            coorte, l&apos;importo più alto è {signedPercent(benchmarkDeltaPercent(highest))} e
            quello più basso è {signedPercent(benchmarkDeltaPercent(lowest))}.
          </p>
        </div>
        <dl>
          <div>
            <dt>Mediana</dt>
            <dd>{exactEuro(euros(medianCents))}</dd>
          </div>
          <div>
            <dt>Differenza massimo-minimo</dt>
            <dd>{exactEuro(euros(rangeCents))}</dd>
          </div>
          <div>
            <dt>Atti ufficiali confrontati</dt>
            <dd>3</dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="amounts-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="amounts-title">Gli importi, dal più alto al più basso</h2>
            <p>La lunghezza delle barre usa 6.270 € come massimo. I numeri esatti restano il riferimento.</p>
          </div>
          <span className="tag tag-neutral">Coorte: 3 affidamenti</span>
        </div>
        <ol className={styles.amountList}>
          {observations.map((observation) => {
            const amountCents = observation.amount!.valueCents;
            const isReference = observation.id === restorationBenchmarkReference.id;
            return (
              <li key={observation.id}>
                <div className={styles.amountHeading}>
                  <div>
                    <span>{observation.title.replace(" per la mostra Roma in moneta", "")}</span>
                    <small>{isReference ? "Mediana della coorte" : "Segnale comparativo"}</small>
                  </div>
                  <strong>{exactEuro(euros(amountCents))}</strong>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <i style={{ width: String((amountCents / highestCents) * 100) + "%" }} />
                  <b style={{ left: String((medianCents / highestCents) * 100) + "%" }} />
                </div>
                <div className={styles.amountFoot}>
                  <span>{signedPercent(benchmarkDeltaPercent(observation))} rispetto alla mediana</span>
                  <span>{sourceById.get(observation.sourceIds[0])?.identifier}</span>
                </div>
              </li>
            );
          })}
        </ol>
        <p className={styles.legend}>
          La tacca verticale indica la mediana di {exactEuro(euros(medianCents))}. Il colore e la
          posizione mostrano la differenza rispetto a quella mediana.
        </p>
      </section>

      <section className={styles.signalGrid} aria-labelledby="signals-title">
        <h2 id="signals-title" className={styles.visuallyHidden}>I due segnali pubblicabili</h2>
        {restorationPublishableAnomalies.map((observation) => {
          const source = sourceById.get(observation.sourceIds[0])!;
          const isAbove = observation.benchmark!.targetDeltaCents > 0;
          return (
            <article className="panel" key={observation.id}>
              <h3 className="panel-title">{isAbove ? "Importo sopra la mediana" : "Importo sotto la mediana"}</h3>
              <strong className={styles.signalValue}>
                {signedPercent(benchmarkDeltaPercent(observation))}
              </strong>
              <p>{observation.title}</p>
              <dl>
                <div>
                  <dt>Importo netto IVA</dt>
                  <dd>{exactEuro(euros(observation.amount!.valueCents))}</dd>
                </div>
                <div>
                  <dt>Differenza dalla mediana</dt>
                  <dd>{exactEuro(euros(Math.abs(observation.benchmark!.targetDeltaCents)))}</dd>
                </div>
              </dl>
              <a href={source.url} target="_blank" rel="noreferrer">
                Verifica {source.identifier} ↗
              </a>
            </article>
          );
        })}
      </section>

      <section className={"notice " + styles.interpretation} aria-labelledby="interpretation-title">
        <h2 id="interpretation-title">Cosa possiamo dire</h2>
        <p>
          Tre affidamenti simili hanno importi molto diversi. Con questi soli atti non possiamo dire
          che uno sia uno spreco: dimensioni e tecnica possono cambiare il lavoro. La domanda utile
          è: <strong>quali elementi tecnici giustificano il divario?</strong>
        </p>
      </section>

      <section className="panel" aria-labelledby="exact-table-title">
        <h2 id="exact-table-title" className="panel-title">Tabella esatta</h2>
        <p className={styles.tableHint}>Scorri la tabella verso destra per leggere tutti i campi.</p>
        <div className="table-scroll" role="region" aria-label="Tabella esatta dei tre affidamenti" tabIndex={0}>
          <table className={"table " + styles.exactTable}>
            <caption>Tre restauri destinati alla stessa mostra, importi netti IVA</caption>
            <thead>
              <tr>
                <th scope="col">Restauro</th>
                <th scope="col">Atto e CIG</th>
                <th scope="col" className="num">Importo</th>
                <th scope="col" className="num">Scostamento dalla mediana</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((observation) => {
                const source = sourceById.get(observation.sourceIds[0])!;
                return (
                  <tr key={observation.id}>
                    <th scope="row">{observation.title}</th>
                    <td>{source.identifier}</td>
                    <td className="num">{exactEuro(euros(observation.amount!.valueCents))}</td>
                    <td className="num">{signedPercent(benchmarkDeltaPercent(observation))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <IntegratedSectionPreview
        section="confronti"
        title="Altri confronti da rendere omogenei"
        description="Il catalogo aggiuntivo non viene confuso con questo confronto già verificato: ogni caso dichiara se unità, durata e perimetro sono davvero comparabili."
        hubHref="/confronti/catalogo"
        limit={1}
      />

      <section className="panel" aria-labelledby="method-title">
        <h2 id="method-title" className="panel-title">Metodo e limiti</h2>
        <ul className={styles.methodList}>
          <li>Mediana e percentili calcolati su tre soli affidamenti: confronto descrittivo su una coorte piccola.</li>
          <li>Dentro la coorte restano fissi ente, mostra, categoria, periodo, procedura, unità e base IVA.</li>
          <li>Un atto di trasporto per la stessa mostra è escluso perché misura un servizio diverso.</li>
          <li>Atto e CIG permettono la verifica alla fonte; i nomi dei contraenti restano pubblicati lì.</li>
        </ul>
      </section>

      <section className={"panel " + styles.sources} aria-labelledby="sources-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="sources-title">Fonti ufficiali</h2>
            <p>
              Atti dell&apos;Istituto Vittoriano e Palazzo Venezia, acquisiti il{" "}
              {longDate(restorationComparisonSnapshot.generatedAt + "T00:00:00Z")}.
            </p>
          </div>
          <a href="https://vive.cultura.gov.it/it/bandi-di-gara-procedura-sotto-soglia" target="_blank" rel="noreferrer">
            Apri l&apos;indice ufficiale ↗
          </a>
        </div>
        <ul>
          {restorationComparisonSnapshot.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.identifier} ↗</a>
              <span>{source.title}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
