import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { getGovernmentCurrentSignalsView } from "@/lib/government-current-signals";
import { getGovernmentScorecardView } from "@/lib/government-scorecard";
import { CitizenScoreModel } from "./citizen-score-model";
import { CurrentGovernmentOverview } from "./current-government-overview";
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

      {currentScore ? (
        <CurrentGovernmentOverview governmentName={current.name} calculation={currentScore} currentSignals={currentSignals} />
      ) : (
        <div className="notice warning-notice">
          <strong>{current.name}: voto non disponibile.</strong>
          <p>{current.calculation.status === "not-scored" ? current.calculation.reason : "Dati insufficienti."}</p>
        </div>
      )}

      <div className={styles.dataBoundary}>
        <strong>Core al {data.sources.ameco.observedThrough} · costo della vita a {currentSignals.latestPeriod}</strong>
        <span>Il Core usa sei indicatori annuali. I segnali mensili sono più recenti, ma restano separati dal voto storico.</span>
        <Link href={`/governi/${current.id}`}>Scheda completa di {current.name} →</Link>
      </div>

      <nav className={styles.pageJumps} aria-label="Sezioni della pagella">
        <a href="#azioni-governo">Cosa ha fatto</a>
        <a href="#scenario">Previsione</a>
        <Link href="/governi/confronta">Confronta due governi</Link>
        <a href="#confronto-governi">Classifica completa</a>
        <a href="#metodo-dati">Metodo e dati mancanti</a>
      </nav>

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
        <details className={styles.inlineDetails}>
          <summary>Vedi il contesto economico e geopolitico del mandato</summary>
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
        </details>
      </section>

      <section className={`panel ${styles.section}`} id="scenario" aria-labelledby="scenario-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Scenario Commissione europea</span>
            <h2 id="scenario-title">Se le previsioni si realizzano</h2>
          </div>
          <p>Il 2025-2027 è una previsione AMECO, non un dato osservato e non un voto anticipato.</p>
        </div>
        {forecast ? (
          <div className={styles.forecastCompact}>
            <div>
              <span>Core osservato</span>
              <strong>{currentScore ? score(currentScore.score) : "n.d."}<small>/100</small></strong>
              <small>fino al {data.sources.ameco.observedThrough}</small>
            </div>
            <span className={styles.forecastArrow} aria-hidden="true">→</span>
            <div>
              <span>Scenario al {forecast.endYear}</span>
              <strong>{score(forecast.score)}<small>/100</small></strong>
              <small>se le stime si realizzano</small>
            </div>
            <ul>
              {forecast.indicators.slice(0, 3).map((indicator) => (
                <li key={indicator.id}><span>{indicator.label}</span><strong>{sourceValue(indicator.endValue, indicator.id)}</strong></li>
              ))}
            </ul>
          </div>
        ) : <p>Scenario non disponibile.</p>}
      </section>

      <details className={styles.explorer} id="confronto-governi">
        <summary>
          <span><small>Archivio dei governi</small><strong>Apri una scheda oppure confronta due governi</strong></span>
          <b>Apri l’archivio</b>
        </summary>
        <div className={styles.explorerBody}>
          <div className={styles.archiveIntro}>
            <p className={styles.explorerIntro}>Ogni nome apre la scheda completa del governo. Le barre usano lo stesso paniere; “ND” indica che la finestra annuale non è sufficiente.</p>
            <Link href="/governi/confronta">Sovrapponi i dati di due governi →</Link>
          </div>
          <ol className={styles.governmentBars}>
            {[...data.governments].reverse().map((government) => (
              <li key={government.id} data-current={government.status === "current" || undefined}>
                <div className={styles.governmentBarLabel}>
                  <Link href={`/governi/${government.id}`}>{government.name}</Link>
                  <span>{government.startDate.slice(0, 4)}-{government.endDate?.slice(0, 4) ?? "oggi"}</span>
                </div>
                {government.calculation.status === "scored" ? (
                  <>
                    <span className={styles.governmentBar} aria-hidden="true"><i style={{ width: `${government.calculation.score}%` }} /></span>
                    <strong>{score(government.calculation.score)}</strong>
                    <small>Italia {score(government.calculation.observedScore)} · peer {score(government.calculation.relativeScore)}</small>
                  </>
                ) : (
                  <><span className={styles.governmentBar} aria-hidden="true" /><strong>ND</strong><small>{government.calculation.reason}</small></>
                )}
              </li>
            ))}
          </ol>
          <details className={styles.inlineDetails}>
            <summary>Vedi anche il contesto economico prima del 1995</summary>
            <div className={styles.timeline}>
              {data.historicalContexts.map((item) => (
                <article key={item.id}>
                  <time>{item.startYear}-{item.endYear}</time>
                  <div><h3>{item.label}</h3><p>{item.summary}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte <span aria-hidden="true">↗</span></a></div>
                </article>
              ))}
            </div>
          </details>
        </div>
      </details>

      <details className={styles.explorer} id="metodo-dati">
        <summary>
          <span><small>Trasparenza</small><strong>Quali dati mancano e come viene calcolato il voto</strong></span>
          <b>Apri il metodo</b>
        </summary>
        <div className={styles.explorerBody}>
          <CitizenScoreModel />
          <section className={styles.methodCompact} aria-labelledby="metodo-title">
            <h2 id="metodo-title">Come leggiamo i confronti</h2>
            <ol>
              <li><strong>Andamento:</strong> misuriamo la variazione italiana tra inizio e fine della finestra.</li>
              <li><strong>Peer:</strong> confrontiamo la stessa variazione con la mediana di Francia, Germania e Spagna.</li>
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
                <div><strong>{data.sources.governmentChronology.owner}</strong><span>Cronologia istituzionale</span></div>
                <p>{data.sources.governmentChronology.title}</p>
                <div><a href={data.sources.governmentChronology.pageUrl} target="_blank" rel="noreferrer">Cronologia</a></div>
              </article>
            </div>
          </section>
        </div>
      </details>
    </main>
  );
}
