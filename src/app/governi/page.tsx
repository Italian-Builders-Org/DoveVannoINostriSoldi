import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import { getGovernmentScorecardView } from "@/lib/government-scorecard";
import { CitizenScoreModel } from "./citizen-score-model";
import { formatScore as score, rawChangeLabel, signed, sourceValue } from "./government-scorecard-format";
import styles from "./governi.module.css";

export const revalidate = 86_400;
export const metadata: Metadata = {
  title: "Pagella economica dei governi italiani",
  description: "Benessere dei cittadini, risultati macroeconomici, confronto internazionale, contesto storico, manovre e scenario corrente dei governi italiani.",
};

export default function GovernmentsPage() {
  const data = getGovernmentScorecardView();
  const current = data.current;
  const currentScore = current.calculation.status === "scored" ? current.calculation : null;
  const currentNotScoredReason = current.calculation.status === "not-scored" ? current.calculation.reason : "Dati insufficienti.";
  const forecast = current.forecast.status === "scored" ? current.forecast : null;
  const forecastNotScoredReason = current.forecast.status === "not-scored" ? current.forecast.reason : "Scenario non disponibile.";
  const positive = currentScore ? [...currentScore.indicators].sort((left, right) => right.contributionPoints - left.contributionPoints).filter((item) => item.contributionPoints > 0).slice(0, 3) : [];
  const negative = currentScore ? [...currentScore.indicators].sort((left, right) => left.contributionPoints - right.contributionPoints).filter((item) => item.contributionPoints < 0).slice(0, 3) : [];

  return (
    <main className="shell page">
      <header className="page-intro">
        <span className={styles.kicker}>Risultati, contesto e responsabilità separate</span>
        <h1>Pagella economica dei governi</h1>
        <p>
          Come sono cambiate la vita economica dei cittadini e la capacità del Paese durante ogni governo,
          rispetto all’eredità ricevuta e a economie esposte allo stesso periodo.
        </p>
      </header>

      <div className={`notice warning-notice ${styles.methodNotice}`}>
        <strong>Il numero disponibile oggi non è ancora il voto sul benessere degli italiani.</strong>
        <p>
          È un Core macro provvisorio basato su sei indicatori annuali AMECO. Non contiene ancora risparmio,
          casa, NEET, natalità, migrazione dei laureati o distribuzione della ricchezza. Lo manteniamo visibile
          per rendere auditabile il prototipo, ma non lo presentiamo come pagella completa.
        </p>
      </div>

      <CitizenScoreModel />

      <section className={styles.currentSection} aria-labelledby="governo-in-carica">
        <div className={styles.currentHeader}>
          <div>
            <span className={styles.eyebrow}>Governo in carica · risultato provvisorio</span>
            <h2 id="governo-in-carica">{current.name}</h2>
            <p>Dal {longDate(current.startDate)} · dati osservati comuni fino al {data.sources.ameco.observedThrough}</p>
          </div>
          <span className={styles.reliability} data-grade={current.reliability.grade}>
            Affidabilità {current.reliability.grade} · {current.reliability.label}
          </span>
        </div>

        {currentScore ? (
          <div className={styles.heroGrid}>
            <article className={styles.scoreCard} aria-label={`Core macro provvisorio ${score(currentScore.score)} su 100`}>
              <span>Core macro provvisorio · non è il voto cittadino</span>
              <strong>{score(currentScore.score)}<small>/100</small></strong>
              <b>{current.scoreLabel}</b>
              <p>50% confronto con finestre storiche italiane, 50% confronto contemporaneo con Francia, Germania e Spagna.</p>
              <p><Link href={`/governi/${current.id}`}>Apri grafici, manovre e scheda completa →</Link></p>
            </article>
            <div className={styles.heroDetail}>
              <dl className={`stat-strip ${styles.scoreStrip}`}>
                <div>
                  <dt>Andamento osservato</dt>
                  <dd>{score(currentScore.observedScore)}</dd>
                  <span className="stat-note">Italia · {currentScore.baselineYear}→{currentScore.endYear}</span>
                </div>
                <div>
                  <dt>Rispetto ai peer</dt>
                  <dd>{score(currentScore.relativeScore)}</dd>
                  <span className="stat-note">Francia · Germania · Spagna</span>
                </div>
                <div>
                  <dt>Attribuzione</dt>
                  <dd>{current.reliability.grade}</dd>
                  <span className="stat-note">non modifica il voto</span>
                </div>
              </dl>
              <p className={styles.boundary}>{current.reliability.reason}</p>
            </div>
          </div>
        ) : (
          <p className="notice">{currentNotScoredReason}</p>
        )}
      </section>

      {currentScore && (
        <section className={`panel ${styles.section}`} aria-labelledby="perche-voto">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Leggi il voto, non fidarti del solo numero</span>
              <h2 id="perche-voto">Perché il Core vale {score(currentScore.score)}?</h2>
            </div>
            <p>Il contributo indica di quanti punti ciascuno dei sei indicatori sposta il Core rispetto al valore neutro 50.</p>
          </div>
          <div className={styles.whyGrid}>
            <div>
              <h3>Ha spinto verso l’alto</h3>
              <ol className={styles.contributionList}>
                {positive.map((indicator) => (
                  <li key={indicator.id}>
                    <span><strong>{indicator.label}</strong><small>{rawChangeLabel(indicator)} · rispetto ai peer {signed(indicator.relativeChange)}</small></span>
                    <b>+{indicator.contributionPoints.toLocaleString("it-IT")} pt</b>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3>Ha frenato il voto</h3>
              {negative.length > 0 ? (
                <ol className={styles.contributionList}>
                  {negative.map((indicator) => (
                    <li key={indicator.id}>
                      <span><strong>{indicator.label}</strong><small>{rawChangeLabel(indicator)} · rispetto ai peer {signed(indicator.relativeChange)}</small></span>
                      <b>{indicator.contributionPoints.toLocaleString("it-IT")} pt</b>
                    </li>
                  ))}
                </ol>
              ) : <p>Nessun indicatore sotto il valore neutro nella finestra osservata.</p>}
            </div>
          </div>
          <p className={styles.causalBoundary}>
            Questi contributi spiegano il calcolo. Non attribuiscono automaticamente al governo ripresa post-pandemica,
            decisioni BCE, PNRR ereditato o conseguenze di misure approvate in precedenza.
          </p>
        </section>
      )}

      {currentScore && (
        <section className={`panel ${styles.section}`} aria-labelledby="cinque-aree">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Cinque aree, pesi dichiarati</span>
              <h2 id="cinque-aree">Da cosa è composto il Core provvisorio</h2>
            </div>
            <p>I pesi non cambiano da un governo all’altro. Queste cinque aree non coincidono ancora con il paniere cittadino mostrato sopra.</p>
          </div>
          <ul className={styles.categoryList}>
            {currentScore.categories.map((category) => (
              <li key={category.id}>
                <div><strong>{category.label}</strong><span>{category.weightBasisPoints / 100}% del voto · {score(category.score)}/100</span></div>
                <span className={styles.bar} aria-hidden="true"><span style={{ width: `${category.score}%` }} /></span>
              </li>
            ))}
          </ul>

          <div className={styles.tableWrap} role="region" aria-label="Indicatori del governo Meloni" tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">Indicatore</th><th scope="col" className="num">Baseline</th><th scope="col" className="num">{currentScore.endYear}</th><th scope="col" className="num">Variazione</th><th scope="col" className="num">Italia vs peer</th><th scope="col" className="num">Indice /100</th></tr></thead>
              <tbody>
                {currentScore.indicators.map((indicator) => (
                  <tr key={indicator.id}>
                    <th scope="row"><span className={styles.indicatorName}>{indicator.label}</span><small>{indicator.weightBasisPoints / 100}% del voto</small></th>
                    <td className="num">{sourceValue(indicator.baselineValue, indicator.id)}</td>
                    <td className="num">{sourceValue(indicator.endValue, indicator.id)}</td>
                    <td className="num">{rawChangeLabel(indicator)}</td>
                    <td className="num">{signed(indicator.relativeChange)}</td>
                    <td className="num"><strong>{score(indicator.score)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.causalBoundary}>
            “Italia vs peer” non indica lo spread. Un valore positivo significa che l’Italia è migliorata più della mediana dei tre paesi;
            un valore negativo significa che è andata peggio, dopo aver orientato ogni indicatore nel verso favorevole.
          </p>
          <details className={styles.details}>
            <summary>Definizioni e limiti dei sei indicatori</summary>
            <ul>{currentScore.indicators.map((indicator) => <li key={indicator.id}><strong>{indicator.label}:</strong> {indicator.limitations}</li>)}</ul>
          </details>
        </section>
      )}

      <section className={`panel ${styles.section}`} aria-labelledby="previsione">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Previsioni separate dai dati osservati</span>
            <h2 id="previsione">Come potrebbe andare</h2>
          </div>
          <p>Scenario Commissione europea, AMECO Spring 2026. Non è una previsione prodotta dal sito.</p>
        </div>
        {forecast ? (
          <div className={styles.forecastGrid}>
            <div className={styles.forecastScore}>
              <span>Scenario Core al 2027</span>
              <strong>{score(forecast.score)}<small>/100</small></strong>
              <p>Solo se le proiezioni AMECO si realizzano e la finestra resta confrontabile.</p>
            </div>
            <div>
              <p>
                Lo scenario sale da <strong>{currentScore ? score(currentScore.score) : "n.d."}</strong> a <strong>{score(forecast.score)}</strong>.
                Non è un voto anticipato: il 2025-2027 contiene stime, può essere rivisto e non dice quale governo sarà in carica fino alla fine della finestra.
              </p>
              <ul className={styles.forecastList}>
                {forecast.indicators.map((indicator) => (
                  <li key={indicator.id}><span>{indicator.label}</span><strong>{sourceValue(indicator.endValue, indicator.id)}</strong></li>
                ))}
              </ul>
            </div>
          </div>
        ) : <p>Scenario non calcolabile: {forecastNotScoredReason}</p>}
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="misure">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Atti, meccanismo ed evidenza</span>
            <h2 id="misure">Cosa ha fatto il governo Meloni</h2>
          </div>
          <p>Le misure restano separate dal voto: approvare una legge non prova che abbia prodotto un indicatore macro.</p>
        </div>
        <div className={styles.measureGrid}>
          {current.measures.map((measure) => (
            <article key={measure.title}>
              <span>{measure.status === "enacted" ? "Approvata" : "Attuazione condivisa tra governi"}</span>
              <h3>{measure.title}</h3>
              <p><strong>Atto:</strong> {measure.act}</p>
              <p><strong>Come dovrebbe incidere:</strong> {measure.mechanism}</p>
              <p><strong>Cosa sappiamo:</strong> {measure.evidence}</p>
              <a href={measure.sourceUrl} target="_blank" rel="noreferrer">Apri la fonte ufficiale <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="contesto-attuale">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Nessun bonus o malus deciso a mano</span>
            <h2 id="contesto-attuale">Il contesto del mandato</h2>
          </div>
          <p>Gli shock sono mostrati e affrontati tramite i peer; non diventano scuse matematiche aggiunte dopo aver visto il risultato.</p>
        </div>
        <div className={styles.contextGrid}>
          {current.contexts.map((item) => (
            <article key={item.id}>
              <span>{item.startYear}-{item.endYear}</span>
              <h3>{item.label}</h3>
              <p>{item.summary}</p>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">Contesto ufficiale <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="tutti-governi">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Dal 1995, dati permettendo</span>
            <h2 id="tutti-governi">Tutti i governi nella serie comparabile</h2>
          </div>
          <p>La posizione ordina solo i governi conclusi con un intervallo osservabile; ogni nome apre la scheda con eredità, contesto, azioni e risultati. “prov.” identifica il governo in carica.</p>
        </div>
        <div className={styles.tableWrap} role="region" aria-label="Pagella macroeconomica dei governi dal 1995" tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">Governo</th><th scope="col">Mandato</th><th scope="col" className="num">Pos.</th><th scope="col" className="num">Core provv.</th><th scope="col" className="num">Osservato</th><th scope="col" className="num">Peer</th><th scope="col">Affidabilità</th></tr></thead>
            <tbody>
              {data.governments.map((government) => (
                <tr key={government.id}>
                  <th scope="row"><Link className={styles.governmentLink} href={`/governi/${government.id}`}>{government.name}</Link>{government.status === "current" && <small> in carica</small>}</th>
                  <td>{government.startDate.slice(0, 4)}-{government.endDate?.slice(0, 4) ?? "oggi"}</td>
                  {government.calculation.status === "scored" ? <>
                    <td className="num">{government.rank ?? "prov."}</td>
                    <td className="num"><strong>{score(government.calculation.score)}</strong></td>
                    <td className="num">{score(government.calculation.observedScore)}</td>
                    <td className="num">{score(government.calculation.relativeScore)}</td>
                    <td><span className={styles.tableReliability}>{government.reliability.grade}</span> {government.reliability.label}</td>
                  </> : <>
                    <td className="num">n.d.</td><td className="num">ND</td><td className="num">n.d.</td><td className="num">n.d.</td>
                    <td><span className={styles.noDataReason}>{government.calculation.reason}</span></td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="prima-1995">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Prima del Core comparabile</span>
            <h2 id="prima-1995">I governi storici non spariscono</h2>
          </div>
          <p>Prima del 1995 mostriamo dati e regimi storici, ma non li mescoliamo nella classifica moderna.</p>
        </div>
        <div className={styles.timeline}>
          {data.historicalContexts.map((item) => (
            <article key={item.id}>
              <time>{item.startYear}-{item.endYear}</time>
              <div><h3>{item.label}</h3><p>{item.summary}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte <span aria-hidden="true">↗</span></a></div>
            </article>
          ))}
        </div>
        <p className={styles.nextStep}>La cronologia completa dal 1946 sarà collegata alle serie storiche di Banca d’Italia senza assegnare un voto unico non confrontabile.</p>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="misure-storiche">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Per tutti i governi coperti, senza riscrivere la storia</span>
            <h2 id="misure-storiche">Manovre e riforme economiche principali</h2>
          </div>
          <p>Una selezione documentata di atti ad alto impatto potenziale. Sono spiegati, non accreditati automaticamente come causa del voto.</p>
        </div>
        <div className={styles.governmentMeasures}>
          {data.governments.filter((government) => government.measures.length > 0).map((government) => (
            <details key={government.id} open={government.status === "current"}>
              <summary><strong>{government.name}</strong><span>{government.measures.length} {government.measures.length === 1 ? "misura" : "misure"}</span></summary>
              <div>
                {government.measures.map((measure) => (
                  <article key={measure.title}>
                    <h3>{measure.title}</h3>
                    <p><strong>{measure.act}</strong></p>
                    <p>{measure.mechanism}</p>
                    <p className={styles.evidence}>{measure.evidence}</p>
                    <a href={measure.sourceUrl} target="_blank" rel="noreferrer">Fonte ufficiale <span aria-hidden="true">↗</span></a>
                  </article>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="metodo">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Metodo {data.methodologyVersion}</span>
            <h2 id="metodo">Come viene deciso il voto</h2>
          </div>
          <p>Codice e snapshot sono versionati: a parità di vintage il risultato è riproducibile.</p>
        </div>
        <ol className={styles.methodSteps}>
          <li><strong>Misuriamo la variazione.</strong> Livelli reali in log-percentuale; tassi e rapporti in punti percentuali.</li>
          <li><strong>Confrontiamo finestre della stessa durata.</strong> Il risultato italiano viene normalizzato sulla storia dal 1995.</li>
          <li><strong>Confrontiamo i peer.</strong> Per ogni indicatore sottraiamo la mediana di Francia, Germania e Spagna nello stesso periodo.</li>
          <li><strong>Riduciamo il peso degli estremi.</strong> Usiamo mediana, MAD robusto e z-score limitato tra −3 e +3.</li>
          <li><strong>Combiniamo senza nascondere.</strong> 50% storia italiana + 50% peer; poi pesi fissi 25/20/20/20/15.</li>
        </ol>
        <div className={styles.formula}>Score = 50% andamento storico + 50% risultato relativo ai peer</div>
        <div className={styles.spreadExplainer}>
          <strong>Il confronto internazionale non è lo spread.</strong>
          <p>
            Lo spread BTP-Bund è la differenza fra il rendimento dei titoli italiani e quello dei Bund tedeschi.
            La Germania è il riferimento, quindi non ha uno “spread BTP-Bund tedesco” confrontabile con quello italiano.
            Rendimento sovrano, interessi sul debito e condizioni del credito entreranno come indicatori di stabilità separati.
          </p>
        </div>
        <details className={styles.details}>
          <summary>Regole che impediscono un voto fuorviante</summary>
          <ul>
            <li>{data.method.missingDataRule}</li>
            <li>{data.method.endpointRule}</li>
            <li>{data.method.attributionRule}</li>
            <li>Una finestra annuale è indicativa e ha affidabilità C; senza un intervallo annuale il voto resta sospeso, ma la scheda del governo è comunque pubblicata.</li>
          </ul>
        </details>
        <p>Per formule, fonti candidate e roadmap della versione completa leggi la <Link href="/metodologia">metodologia generale</Link>.</p>
      </section>

      <section className={styles.sources} aria-labelledby="fonti-pagella">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Provenienza verificabile</span><h2 id="fonti-pagella">Apri i dati originali</h2></div>
          <p>Ogni refresh conserva data di accesso, dimensione e SHA-256 del payload usato.</p>
        </div>
        <div className={styles.sourceRows}>
          <article>
            <div><strong>{data.sources.ameco.owner}</strong><span>{data.sources.ameco.release} · osservazioni fino al {data.sources.ameco.observedThrough}</span></div>
            <p>{data.sources.ameco.title} · annuale · Italia, Francia, Germania, Spagna · accesso {longDate(data.sources.ameco.retrievedAt.slice(0, 10))}</p>
            <div><a href={data.sources.ameco.landingUrl} target="_blank" rel="noreferrer">Dataset</a><a href={data.sources.ameco.termsUrl} target="_blank" rel="noreferrer">Riuso</a></div>
          </article>
          <article>
            <div><strong>{data.sources.governmentChronology.owner}</strong><span>Aggiornamento a ogni cambio di governo</span></div>
            <p>{data.sources.governmentChronology.title} · cronologia istituzionale dal 1995 nella pagella</p>
            <div><a href={data.sources.governmentChronology.pageUrl} target="_blank" rel="noreferrer">Cronologia</a><a href={data.sources.governmentChronology.termsUrl} target="_blank" rel="noreferrer">Note legali</a></div>
          </article>
        </div>
        <ul className={styles.caveats}>{data.caveats.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </main>
  );
}
