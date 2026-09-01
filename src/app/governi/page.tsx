import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { getGovernmentCurrentSignalsView } from "@/lib/government-current-signals";
import { getGovernmentScorecardView } from "@/lib/government-scorecard";
import { CitizenScoreModel } from "./citizen-score-model";
import { CurrentGovernmentOverview, CurrentGovernmentPeerComparison } from "./current-government-overview";
import { GovernmentArchive } from "./government-archive";
import { formatScore as score, sourceValue } from "./government-scorecard-format";
import styles from "./governi.module.css";

export const revalidate = 86_400;
export const metadata: Metadata = {
  title: "Come sta andando l’economia con il governo in carica",
  description: "Dati del governo in carica, andamento per i cittadini, confronto con Francia, Germania e Spagna e storico dei governi italiani.",
};

export default function GovernmentsPage() {
  const data = getGovernmentScorecardView();
  const currentSignals = getGovernmentCurrentSignalsView();
  const current = data.current;
  const currentScore = current.calculation.status === "scored" ? current.calculation : null;
  const forecast = current.forecast.status === "scored" ? current.forecast : null;

  return (
    <main className="shell page">
      <header className={`page-intro ${styles.compactIntro}`}>
        <span className={styles.kicker}>Pagella economica · governo in carica</span>
        <h1>Economia italiana: cosa sta migliorando e cosa no</h1>
        <p>Dati osservati, confronto internazionale e misure del governo. Prima il presente; lo storico è disponibile su richiesta.</p>
      </header>

      <section aria-label="Dati del governo attualmente in carica">
        {currentScore ? (
          <CurrentGovernmentOverview governmentName={current.name} calculation={currentScore} currentSignals={currentSignals} ameco={data.sources.ameco} />
        ) : (
          <div className="notice warning-notice">
            <strong>{current.name}: risultato non disponibile.</strong>
            <p>{current.calculation.status === "not-scored" ? current.calculation.reason : "Dati insufficienti."}</p>
          </div>
        )}

        <div className={styles.dataBoundary}>
          <strong>Risultati annuali al {data.sources.ameco.observedThrough} · prezzi a {currentSignals.latestPeriod}</strong>
          <span>I sei indicatori annuali permettono lo storico. I prezzi mensili sono più recenti, ma non vengono sommati al numero.</span>
          <Link href={`/governi/${current.id}`}>Scheda completa di {current.name} →</Link>
        </div>

        <details className={styles.explorer} id="scenario">
          <summary>
            <span>
              <small>Scenario Commissione europea</small>
              <strong>{forecast ? `Se le previsioni si realizzano: ${score(forecast.score)}/100 nel ${forecast.endYear}` : "Previsioni non pubblicabili: copertura incompleta"}</strong>
            </span>
            <b aria-hidden="true">Apri lo scenario</b>
          </summary>
          <div className={styles.explorerBody}>
            <p className={styles.explorerIntro}>Il 2025-2027 è una previsione AMECO, non un dato osservato e non un risultato anticipato.</p>
            {forecast ? (
              <div className={styles.forecastCompact}>
                <div>
                  <span>Risultato osservato</span>
                  <strong>{currentScore ? score(currentScore.score) : "n.d."}<small>/100</small></strong>
                  <small>Indice calcolato da AMECO fino al {data.sources.ameco.observedThrough}</small>
                </div>
                <span className={styles.forecastArrow} aria-hidden="true">→</span>
                <div>
                  <span>Scenario al {forecast.endYear}</span>
                  <strong>{score(forecast.score)}<small>/100</small></strong>
                  <small>Previsione AMECO {data.sources.ameco.release}, non osservata</small>
                </div>
                <ul>
                  {forecast.indicators.slice(0, 3).map((indicator) => (
                    <li key={indicator.id}>
                      <span>{indicator.label}</span>
                      <strong>{sourceValue(indicator.endValue, indicator.id)}</strong>
                    </li>
                  ))}
                </ul>
                <p className={styles.forecastSource}>
                  Fonte dei tre valori {forecast.endYear}: AMECO {data.sources.ameco.release}.{" "}
                  <a href={data.sources.ameco.landingUrl} target="_blank" rel="noreferrer">Dataset AMECO <span aria-hidden="true">↗</span></a>
                </p>
              </div>
            ) : <p>Scenario non disponibile.</p>}
          </div>
        </details>
      </section>

      <nav className={styles.pageJumps} aria-label="Sezioni della pagella">
        <a href="#eredita-governo">Cosa ha ereditato</a>
        <a href="#contesto-governo">Contesto</a>
        <a href="#azioni-governo">Cosa ha fatto</a>
        <a href="#confronto-governi">Archivio governi</a>
        <a href="#confronto-diretto">Confronta due governi</a>
        <a href="#metodo-dati">Metodo e dati mancanti</a>
      </nav>

      <section className={`panel ${styles.section}`} id="eredita-governo" aria-labelledby="eredita-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Situazione di partenza</span>
            <h2 id="eredita-title">Cosa ha ereditato il governo attuale</h2>
          </div>
          <p>La baseline descrive ciò che era già presente all’insediamento. Non diventa automaticamente merito o colpa del governo precedente.</p>
        </div>
        <div className={styles.inheritanceGrid}>
          <article>
            <span>Governo precedente</span>
            {current.inheritance.previousGovernment ? (
              <h3><Link href={`/governi/${current.inheritance.previousGovernment.id}`}>{current.inheritance.previousGovernment.name}</Link></h3>
            ) : <h3>Inizio della serie comparabile</h3>}
            <p>Baseline statistica: {current.inheritance.baselineYear}. Il dato annuale approssima la situazione disponibile all’insediamento.</p>
          </article>
          <article>
            <span>Traiettoria precedente</span>
            {current.inheritance.trend.status === "scored" ? (
              <>
                <h3>{score(current.inheritance.trend.score)}/100</h3>
                <p>Andamento nei due anni precedenti, mostrato separatamente dal risultato del governo attuale. Indice calcolato da AMECO {data.sources.ameco.release}, stessa formula.</p>
                <p><a href={data.sources.ameco.landingUrl} target="_blank" rel="noreferrer">Fonte: AMECO <span aria-hidden="true">↗</span></a></p>
              </>
            ) : <><h3>Non calcolabile</h3><p>{current.inheritance.trend.reason}</p></>}
          </article>
          <article>
            <span>Fattori già attivi</span>
            <h3>{current.inheritance.activeContexts.length || "Nessuno registrato"}</h3>
            {current.inheritance.activeContexts.length > 0
              ? <ul>{current.inheritance.activeContexts.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
              : <p>Nessuno shock precedente ancora attivo nel registro.</p>}
          </article>
        </div>
      </section>

      <section className={`panel ${styles.section}`} id="contesto-governo" aria-labelledby="contesto-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Periodo economico e geopolitico</span>
            <h2 id="contesto-title">In quale situazione ha operato</h2>
          </div>
          <p>Shock globali, decisioni europee e condizioni finanziarie sono mostrati come contesto, senza bonus o penalità manuali al risultato.</p>
        </div>
        <div className={styles.contextGrid}>
          {current.contexts.map((item) => (
            <article key={item.id}>
              <span>{item.startYear}-{item.endYear}</span>
              <h3>{item.label}</h3>
              <p>{item.summary}</p>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte del contesto <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.section}`} id="azioni-governo" aria-labelledby="azioni-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Azioni del governo in carica</span>
            <h2 id="azioni-title">Cosa ha fatto e cosa possiamo verificare</h2>
          </div>
          <p>Una legge è collegata al risultato solo quando esiste evidenza: non basta averla approvata.</p>
        </div>
        <div className={styles.measureGrid}>
          {current.measures.map((measure) => (
            <article key={measure.title}>
              <span>{measure.status === "enacted" ? "Approvata" : "Attuazione condivisa"}</span>
              <h3>{measure.title}</h3>
              <p><strong>Obiettivo:</strong> {measure.mechanism}</p>
              <p><strong>Risultato verificabile:</strong> {measure.evidence}</p>
              <details>
                <summary>Atto e fonte</summary>
                <p>{measure.act}</p>
                <a href={measure.sourceUrl} target="_blank" rel="noreferrer">Fonte ufficiale <span aria-hidden="true">↗</span></a>
              </details>
            </article>
          ))}
        </div>
      </section>

      <GovernmentArchive id="confronto-governi" selectedGovernmentId={current.id} ameco={data.sources.ameco} />

      <section className={styles.comparisonCallout} id="confronto-diretto" aria-labelledby="confronto-title">
        <div>
          <span>Confronto diretto</span>
          <h2 id="confronto-title">Scegli due governi e sovrapponi i dati</h2>
          <p>Il confronto usa la stessa formula, mostra le traiettorie dei sei indicatori e non decreta un vincitore.</p>
        </div>
        <Link href={`/governi/confronta?x=${current.id}`}>Apri il confronto</Link>
      </section>

      {currentScore && (
        <CurrentGovernmentPeerComparison
          indicators={currentScore.indicators}
          baselineYear={currentScore.baselineYear}
        />
      )}

      <details className={styles.explorer} id="metodo-dati">
        <summary>
          <span><small>Trasparenza</small><strong>Quali dati mancano e come viene calcolato il risultato</strong></span>
          <b aria-hidden="true">Apri il metodo</b>
        </summary>
        <div className={styles.explorerBody}>
          <CitizenScoreModel />
          <section className={styles.methodCompact} aria-labelledby="metodo-title">
            <h2 id="metodo-title">Come leggiamo i confronti</h2>
            <ol>
              <li><strong>Andamento:</strong> misuriamo la variazione italiana tra inizio e fine della finestra.</li>
              <li><strong>Italia rispetto ai peer:</strong> confrontiamo la variazione italiana con la mediana di Francia, Germania e Spagna. 50 significa andamento in linea; sopra 50 migliore, sotto 50 peggiore.</li>
              <li><strong>Core:</strong> 50% storia italiana e 50% confronto con i peer, con pesi fissi.</li>
            </ol>
          </section>
          <section className={styles.sources} aria-labelledby="fonti-pagella">
            <div className={styles.sectionHeading}>
              <div><span className={styles.eyebrow}>Provenienza</span><h2 id="fonti-pagella">Dati originali</h2></div>
            </div>
            <div className={styles.sourceRows}>
              <article>
                <div><strong>{data.sources.ameco.owner}</strong><span>{data.sources.ameco.release}</span></div>
                <p>{data.sources.ameco.title} · osservazioni fino al {data.sources.ameco.observedThrough} · accesso {longDate(data.sources.ameco.retrievedAt.slice(0, 10))}</p>
                <div><a href={data.sources.ameco.landingUrl} target="_blank" rel="noreferrer">Dataset</a><a href={data.sources.ameco.termsUrl} target="_blank" rel="noreferrer">Riuso</a></div>
              </article>
              <article>
                <div><strong>{currentSignals.source.owner}</strong><span>Aggiornamento mensile</span></div>
                <p>Prezzi armonizzati · ultimo mese {currentSignals.latestPeriod} · controllo automatico settimanale, senza inventare nuovi dati fra due pubblicazioni</p>
                <div><a href={currentSignals.source.landingUrl} target="_blank" rel="noreferrer">Dataset</a><a href={currentSignals.source.informationUrl} target="_blank" rel="noreferrer">Metodo</a></div>
              </article>
              <article>
                <div><strong>{data.sources.governmentChronology.owner}</strong><span>Cronologia istituzionale</span></div>
                <p>{data.sources.governmentChronology.title}</p>
                <div><a href={data.sources.governmentChronology.pageUrl} target="_blank" rel="noreferrer">Cronologia</a></div>
              </article>
            </div>
          </section>
        </div>
      </details>

      <details className={`${styles.explorer} ${styles.limitDetails}`}>
        <summary>
          <span><small>Avvertenze</small><strong>Cosa il risultato non dimostra</strong></span>
          <b aria-hidden="true">Apri</b>
        </summary>
        <div className={styles.explorerBody}>
          <ul className={styles.caveats}>
            <li>Descrive ciò che è successo nel periodo, ma non prova che il governo abbia causato tutta la variazione.</li>
            <li>Non assegna automaticamente al predecessore l’intera situazione ereditata.</li>
            <li>Non considera efficace una misura solo perché è stata approvata.</li>
            <li>I dati annuali approssimano i mesi esatti di insediamento e fine mandato.</li>
          </ul>
        </div>
      </details>
    </main>
  );
}
