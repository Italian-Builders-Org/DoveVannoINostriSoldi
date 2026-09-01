import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { longDate } from "@/lib/format";
import {
  getGovernmentScorecardGovernmentView,
  getGovernmentScorecardView,
} from "@/lib/government-scorecard";
import {
  formatScore,
  rawChangeLabel,
  relativeChangeLabel,
  sourceValue,
} from "../government-scorecard-format";
import { GovernmentIndicatorChart } from "../government-indicator-chart";
import { GovernmentArchive } from "../government-archive";
import styles from "../governi.module.css";

type GovernmentPageProps = {
  params: Promise<{ id: string }>;
};

export const revalidate = 86_400;
export const dynamicParams = false;

export function generateStaticParams() {
  return getGovernmentScorecardView().governments.map((government) => ({ id: government.id }));
}

export async function generateMetadata({ params }: GovernmentPageProps): Promise<Metadata> {
  const { id } = await params;
  const government = getGovernmentScorecardGovernmentView(id);
  if (!government) return { title: "Governo non trovato" };
  return {
    title: `${government.name}: pagella economica e contesto`,
    description: `Situazione ereditata, contesto economico e geopolitico, misure e risultati osservati durante il governo ${government.name}.`,
  };
}

function contextKind(kind: string) {
  if (kind === "external-shock") return "Shock esterno";
  if (kind === "financial-shock") return "Shock finanziario";
  if (kind === "shared-policy-context") return "Decisioni condivise o sovranazionali";
  return "Regime economico";
}

export default async function GovernmentDetailPage({ params }: GovernmentPageProps) {
  const { id } = await params;
  const government = getGovernmentScorecardGovernmentView(id);
  if (!government) notFound();
  const sources = getGovernmentScorecardView().sources;

  const calculation = government.calculation.status === "scored" ? government.calculation : null;
  const calculationReason = government.calculation.status === "not-scored" ? government.calculation.reason : null;
  const inheritedTrend = government.inheritance.trend.status === "scored" ? government.inheritance.trend : null;
  const inheritedTrendReason = government.inheritance.trend.status === "not-scored" ? government.inheritance.trend.reason : null;
  const positive = calculation
    ? [...calculation.indicators].sort((left, right) => right.contributionPoints - left.contributionPoints).filter((item) => item.contributionPoints > 0).slice(0, 3)
    : [];
  const negative = calculation
    ? [...calculation.indicators].sort((left, right) => left.contributionPoints - right.contributionPoints).filter((item) => item.contributionPoints < 0).slice(0, 3)
    : [];
  const maximumContribution = calculation
    ? Math.max(...calculation.indicators.map((item) => Math.abs(item.contributionPoints)), 1)
    : 1;
  const peerDirection = calculation
    ? calculation.relativeScore > 50
      ? "migliore della"
      : calculation.relativeScore < 50
        ? "peggiore della"
        : "in linea con la"
    : null;

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/governi">Pagella dei governi</Link>
        <span aria-hidden="true">/</span>
        <span>{government.name}</span>
      </nav>

      <header className={styles.detailIntro}>
        <div>
          <span className={styles.kicker}>Scheda economica del mandato</span>
          <h1>{government.name}</h1>
          <p>
            {longDate(government.startDate)} · {government.endDate ? longDate(government.endDate) : "in carica"}
          </p>
        </div>
        <span className={styles.comparability} data-grade={government.comparability.grade}>
          Dati annuali · {government.comparability.label}
        </span>
      </header>

      <p className={styles.sourceNote}>
        Indicatori annuali: <a href={sources.ameco.landingUrl} target="_blank" rel="noreferrer">Commissione europea · AMECO</a>,
        osservazioni fino al {sources.ameco.observedThrough}, accesso {longDate(sources.ameco.retrievedAt.slice(0, 10))}.
      </p>

      <section className={styles.detailScore} aria-labelledby="valutazione-sintesi">
        <div>
          <span>Risultato economico nel periodo · 6 indicatori</span>
          {calculation ? (
            <><strong>{formatScore(calculation.score)}<small>/100</small></strong><b>{government.scoreLabel}</b></>
          ) : (
            <><strong className={styles.documentedScore}>Scheda</strong><b>valutazione documentale</b></>
          )}
        </div>
        <div>
          <span className={styles.metricLabel}>Italia rispetto ai peer</span>
          {calculation ? (
            <>
              <h2 id="valutazione-sintesi">{formatScore(calculation.relativeScore)}<small>/100</small></h2>
              <strong>Andamento Italia {peerDirection} mediana dei peer</strong>
              <p>50 indica un andamento in linea. Il numero valuta l’Italia rispetto a Francia, Germania e Spagna nello stesso periodo; non è il voto dei tre Paesi.</p>
            </>
          ) : (
            <><h2 id="valutazione-sintesi">Non calcolabile</h2><p>{calculationReason}</p></>
          )}
        </div>
      </section>

      {calculation && (
        <section className={styles.topResultSummary} aria-label="Dati principali del periodo">
          <dl className={`stat-strip ${styles.resultStrip}`}>
            <div><dt>Andamento Italia</dt><dd>{formatScore(calculation.observedScore)}</dd><span className="stat-note">dal {calculation.baselineYear} al {calculation.endYear}</span></div>
            <div><dt>Italia rispetto ai peer</dt><dd>{formatScore(calculation.relativeScore)}</dd><span className="stat-note">50 = andamento in linea</span></div>
            <div><dt>Periodo osservato</dt><dd>{calculation.windowYears}</dd><span className="stat-note">{calculation.windowYears === 1 ? "anno · lettura indicativa" : "anni tra gli endpoint"}</span></div>
          </dl>
          <div className={styles.robustnessPanel}>
            <div>
              <span>Intervallo dopo {calculation.robustness.checks.length} stress test</span>
              <strong>da {formatScore(calculation.robustness.minimumScore)} a {formatScore(calculation.robustness.maximumScore)}<small>/100</small></strong>
            </div>
            <div>
              <span>Sensibilità</span>
              <strong>{calculation.robustness.label}</strong>
              <small>Scarto massimo ±{formatScore(calculation.robustness.maximumDeviation)} punti</small>
            </div>
            <div>
              <span>Attribuzione al governo</span>
              <strong>{government.attribution.label}</strong>
              <small>{government.attribution.reason}</small>
            </div>
          </div>
        </section>
      )}

      <section className={`panel ${styles.section}`} aria-labelledby="eredita">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Il punto di partenza</span><h2 id="eredita">Cosa ha ereditato</h2></div>
          <p>La baseline e il trend precedente vengono mostrati separatamente: non diventano automaticamente merito o colpa del predecessore.</p>
        </div>
        <div className={styles.inheritanceGrid}>
          <article>
            <span>Governo precedente</span>
            {government.inheritance.previousGovernment ? (
              <h3><Link href={`/governi/${government.inheritance.previousGovernment.id}`}>{government.inheritance.previousGovernment.name}</Link></h3>
            ) : <h3>Inizio della serie comparabile</h3>}
            <p>Baseline statistica: {government.inheritance.baselineYear}. Il dato annuale approssima la situazione disponibile all’insediamento.</p>
          </article>
          <article>
            <span>Traiettoria nei due anni precedenti</span>
            {inheritedTrend ? (
              <><h3>{formatScore(inheritedTrend.score)}/100</h3><p>Andamento fino alla baseline, confrontato con storia italiana e peer. Non è un voto al governo precedente.</p></>
            ) : <><h3>Non calcolabile</h3><p>{inheritedTrendReason}</p></>}
          </article>
          <article>
            <span>Fattori già attivi all’arrivo</span>
            <h3>{government.inheritance.activeContexts.length || "Nessuno registrato"}</h3>
            {government.inheritance.activeContexts.length > 0
              ? <ul>{government.inheritance.activeContexts.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
              : <p>Il registro non segnala uno shock iniziato prima dell’insediamento e ancora attivo.</p>}
          </article>
        </div>
        {government.inheritance.indicators.length > 0 && (
          <div className={styles.tableWrap} role="region" aria-label={`Indicatori ereditati dal governo ${government.name}`} tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">Indicatore alla baseline</th><th scope="col" className="num">Anno</th><th scope="col" className="num">Valore</th><th scope="col">Limite</th></tr></thead>
              <tbody>{government.inheritance.indicators.map((indicator) => (
                <tr key={indicator.id}>
                  <th scope="row">{indicator.label}</th>
                  <td className="num">{government.inheritance.baselineYear}</td>
                  <td className="num">{sourceValue(indicator.value, indicator.id)}</td>
                  <td><span className={styles.noDataReason}>{indicator.limitations}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="contesto">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Periodo economico e geopolitico</span><h2 id="contesto">In quale situazione ha governato</h2></div>
          <p>I confronti con paesi esposti allo stesso periodo aiutano a leggere gli shock comuni; il registro rende visibili quelli non catturati bene dal solo indice.</p>
        </div>
        <div className={styles.contextGrid}>
          {government.contexts.map((item) => (
            <article key={item.id}>
              <span>{contextKind(item.kind)} · {item.startYear}-{item.endYear}</span>
              <h3>{item.label}</h3>
              <p>{item.summary}</p>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">Apri la fonte <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="risposta">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Atti, meccanismi, prove</span><h2 id="risposta">Cosa ha fatto per intervenire</h2></div>
          <p>Una legge prova che una decisione è stata presa. L’effetto viene accreditato soltanto quando esiste una valutazione indipendente adeguata.</p>
        </div>
        <div className={styles.measureGrid}>
          {government.measures.map((measure) => (
            <article key={measure.title}>
              <span>{measure.status === "enacted" ? "Approvata" : "Eredità o attuazione condivisa"}</span>
              <h3>{measure.title}</h3>
              <p><strong>Atto:</strong> {measure.act}</p>
              <p><strong>Meccanismo:</strong> {measure.mechanism}</p>
              <p><strong>Valutazione disponibile:</strong> {measure.evidence}</p>
              <a href={measure.sourceUrl} target="_blank" rel="noreferrer">Apri la fonte ufficiale <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="risultati">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Durante il mandato, non necessariamente a causa del mandato</span><h2 id="risultati">Risultati osservati e situazione lasciata</h2></div>
          <p>{government.status === "current" ? "Il risultato è provvisorio e si ferma all’ultimo anno interamente osservato." : "L’endpoint annuale è un’approssimazione della situazione al passaggio di governo."}</p>
        </div>
        {calculation ? (
          <>
            <div className={styles.scoreBreakdown}>
              <div className={styles.breakdownHeading}>
                <h3>Come i sei indicatori formano il numero</h3>
                <p>Ogni barra mostra i punti aggiunti o sottratti al valore neutro 50. Sommandoli si ottiene il Core finale.</p>
              </div>
              <div className={styles.contributionChart}>
                {calculation.indicators.map((indicator) => {
                  const width = Math.abs(indicator.contributionPoints) / maximumContribution * 46;
                  const positiveContribution = indicator.contributionPoints >= 0;
                  return (
                    <div className={styles.contributionRow} key={indicator.id}>
                      <div><strong>{indicator.label}</strong><small>{indicator.weightBasisPoints / 100}% del Core · indice {formatScore(indicator.score)}/100</small></div>
                      <div
                        className={styles.contributionTrack}
                        role="img"
                        aria-label={`${indicator.label}: ${indicator.contributionPoints >= 0 ? "più" : "meno"} ${Math.abs(indicator.contributionPoints).toLocaleString("it-IT")} punti`}
                      >
                        <span
                          data-direction={positiveContribution ? "positive" : "negative"}
                          style={positiveContribution ? { left: "50%", width: `${width}%` } : { left: `${50 - width}%`, width: `${width}%` }}
                        />
                      </div>
                      <b>{indicator.contributionPoints > 0 ? "+" : ""}{indicator.contributionPoints.toLocaleString("it-IT")} pt</b>
                    </div>
                  );
                })}
              </div>
            </div>

            <GovernmentIndicatorChart indicators={calculation.indicators} />

            <div className={styles.tableWrap} role="region" aria-label={`Risultati economici del governo ${government.name}`} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">Indicatore</th><th scope="col" className="num">Inizio</th><th scope="col" className="num">Fine</th><th scope="col" className="num">Variazione</th><th scope="col" className="num">Italia vs peer</th><th scope="col" className="num">Indice /100</th></tr></thead>
                <tbody>{calculation.indicators.map((indicator) => (
                  <tr key={indicator.id}>
                    <th scope="row"><span className={styles.indicatorName}>{indicator.label}</span><small>{indicator.weightBasisPoints / 100}% dell’indice</small></th>
                    <td className="num">{sourceValue(indicator.baselineValue, indicator.id)}</td>
                    <td className="num">{sourceValue(indicator.endValue, indicator.id)}</td>
                    <td className="num">{rawChangeLabel(indicator)}</td>
                    <td className="num">{relativeChangeLabel(indicator)}</td>
                    <td className="num"><strong>{formatScore(indicator.score)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className={styles.causalBoundary}>
              “Italia vs peer” è lo scarto dell’indicatore rispetto alla mediana di Francia, Germania e Spagna: non è lo spread.
              Il confronto assorbe parte degli shock comuni, ma non corregge ancora differenze di esposizione come dipendenza energetica, struttura industriale o spazio fiscale ereditato.
            </p>
            <div className={styles.whyGrid}>
              <div><h3>Risultati che hanno alzato l’indice</h3><ul className={styles.contributionList}>{positive.map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{rawChangeLabel(item)}</small></span><b>+{item.contributionPoints.toLocaleString("it-IT")} pt</b></li>)}</ul></div>
              <div><h3>Risultati che hanno abbassato l’indice</h3>{negative.length > 0 ? <ul className={styles.contributionList}>{negative.map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{rawChangeLabel(item)}</small></span><b>{item.contributionPoints.toLocaleString("it-IT")} pt</b></li>)}</ul> : <p>Nessun indicatore sotto il valore neutro in questa finestra.</p>}</div>
            </div>
          </>
        ) : <p className="notice">{calculationReason}</p>}
        {government.successorGovernment && (
          <p className={styles.transitionNote}>
            Il governo successivo è <Link href={`/governi/${government.successorGovernment.id}`}>{government.successorGovernment.name}</Link>,
            insediato il {longDate(government.successorGovernment.startDate)}. La sua scheda riparte da una baseline coerente con la frequenza dei dati.
          </p>
        )}
      </section>

      <GovernmentArchive id="altri-governi" selectedGovernmentId={government.id} ameco={sources.ameco} />

      <section className={styles.comparisonCallout} aria-labelledby="confronta-governo">
        <div>
          <span>Confronto diretto</span>
          <h2 id="confronta-governo">Confronta {government.name} con un altro governo</h2>
          <p>Scegli il secondo governo e sovrapponi risultati, categorie e andamento dei sei indicatori.</p>
        </div>
        <Link href={`/governi/confronta?x=${government.id}`}>Apri il confronto</Link>
      </section>

      <section className={styles.explanationStack} aria-label="Spiegazioni del risultato">
        <details className={styles.explorer}>
          <summary>
            <span><small>Metodo</small><strong>Come viene calcolato il risultato</strong></span>
            <b aria-hidden="true">Apri</b>
          </summary>
          <div className={styles.explorerBody}>
            <p className={styles.explorerIntro}>Il risultato combina l’andamento dell’Italia e il confronto con i peer. Le spiegazioni non precedono più i dati, ma restano verificabili qui.</p>
            <div className={styles.assessmentPath} aria-label="Passaggi della valutazione">
              <article><span>1</span><strong>Eredità</strong><p>Punto di partenza e traiettoria ricevuta.</p></article>
              <article><span>2</span><strong>Contesto</strong><p>Economia mondiale, geopolitica, banche ed Europa.</p></article>
              <article><span>3</span><strong>Risposta</strong><p>Manovre e riforme realmente approvate.</p></article>
              <article><span>4</span><strong>Risultati</strong><p>Cosa è cambiato durante il mandato e rispetto ai peer.</p></article>
              <article><span>5</span><strong>Attribuzione</strong><p>Quanto è prudente collegare risultati e governo.</p></article>
            </div>
            <div className={styles.scoreLayers}>
              <div><span>1</span><h2>Benessere del cittadino</h2><p>Reddito, costi essenziali, lavoro, risparmio, casa e opportunità. Il paniere completo è in integrazione e oggi non riceve punti.</p></div>
              <div><span>2</span><h2>Performance nel contesto</h2><p>Andamento rispetto alla storia italiana e agli stessi anni nei peer. È il livello coperto, solo in parte, dal Core macro.</p></div>
              <div><span>3</span><h2>Impatto delle politiche</h2><p>Una manovra riceve merito o colpa soltanto con una valutazione indipendente; altrimenti mostriamo atto, obiettivo e risultato senza causalità.</p></div>
            </div>
          </div>
        </details>

        <details className={styles.explorer}>
          <summary>
            <span><small>Confronto internazionale</small><strong>Cosa significa “Italia rispetto ai peer”</strong></span>
            <b aria-hidden="true">Apri</b>
          </summary>
          <div className={styles.explorerBody}>
            <p className={styles.explorerIntro}>Non è una valutazione di Francia, Germania e Spagna e non è lo spread. Misura come sono variati in Italia i sei indicatori rispetto alla mediana degli stessi Paesi e degli stessi anni. Un risultato pari a 50 è in linea con i peer; sopra 50 indica un andamento relativo migliore, sotto 50 peggiore.</p>
          </div>
        </details>

        <details className={styles.explorer}>
          <summary>
            <span><small>Precisione dei dati</small><strong>Perché questi dati sono indicativi</strong></span>
            <b aria-hidden="true">Apri</b>
          </summary>
          <div className={styles.explorerBody}>
            <p className={styles.explorerIntro}>{government.comparability.reason} La lettera tecnica non viene mostrata perché non aiuta a interpretare il risultato. “Indicativo” segnala una finestra breve o ancora aperta; “confrontabile” segnala un mandato concluso con una finestra più ampia. In entrambi i casi gli endpoint annuali approssimano i mesi esatti del mandato.</p>
          </div>
        </details>
      </section>

      <details className={`${styles.explorer} ${styles.limitDetails}`}>
        <summary>
          <span><small>Avvertenze</small><strong>Cosa i dati non dimostrano</strong></span>
          <b aria-hidden="true">Apri</b>
        </summary>
        <div className={styles.explorerBody}>
          <p className={styles.explorerIntro}>Il risultato macro, il confronto col contesto e la valutazione delle singole politiche sono livelli distinti.</p>
          <ul className={styles.caveats}>
            <li>Non dimostra che il governo abbia causato l’intera variazione osservata.</li>
            <li>Non attribuisce automaticamente al predecessore tutto ciò che era presente alla baseline.</li>
            <li>Non trasforma una misura approvata in una misura efficace senza evidenza indipendente.</li>
            <li>Per le finestre brevi, i dati annuali riducono la precisione temporale del confronto.</li>
          </ul>
        </div>
      </details>
    </main>
  );
}
