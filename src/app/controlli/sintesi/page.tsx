import type { Metadata } from "next";
import Link from "next/link";
import {
  aiStewardshipDisclosure,
  buildAiInterventionMap,
  buildAiNextMoves,
  buildAiStewardshipAgenda,
  buildControlliSintesiPathways,
  sintesiReadingOrder,
  type AiStewardshipMove,
  type SintesiKind,
} from "@/lib/controlli-sintesi";
import styles from "./sintesi.module.css";

export const metadata: Metadata = {
  title: "Sintesi: cosa monitorare",
  description:
    "Quadro leggibile di osservazioni, screening, ipotesi di miglioramento e agenda AI esplicitamente etichettata sulla spesa pubblica. Non attribuisce sprechi o illeciti.",
};

const kindLabels: Record<SintesiKind, string> = {
  osservazione: "Osservazione",
  screening: "Screening",
  ipotesi: "Ipotesi di miglioramento",
};

function barWidthPercent(bars: AiStewardshipMove["bars"], value: number): number {
  const max = Math.max(...bars.map((bar) => bar.value), Number.EPSILON);
  return Math.max(4, Math.round((value / max) * 100));
}

export default function ControlliSintesiPage() {
  const pathways = buildControlliSintesiPathways();
  const aiAgenda = buildAiStewardshipAgenda(pathways);
  const interventionMap = buildAiInterventionMap(aiAgenda);
  const nextMoves = buildAiNextMoves();

  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <p className="eyebrow">Cosa controllare · Sintesi</p>
        <h1>Cosa monitorare, dove approfondire, cosa si può migliorare</h1>
        <p>
          Questa pagina non è una classifica di sprechi. Raccoglie ciò che i dati in piattaforma
          già mostrano, in tre passi: cosa emerge, dove andare a leggere, cosa si può fare per
          verificare o migliorare. Ogni cifra resta legata a fonte, periodo e limiti.
        </p>
        <p className={styles.leadLinks}>
          <Link href="/controlli">Elenco segnali →</Link>
          <Link href="#agenda-ai">Agenda agenti AI →</Link>
          <Link href="/metodologia">Come leggiamo i dati →</Link>
        </p>
      </div>

      <section className={`panel ${styles.howTo}`} aria-labelledby="how-to-title">
        <h2 id="how-to-title" className="panel-title">Come si legge</h2>
        <ol className={styles.steps}>
          {sintesiReadingOrder.map((step) => (
            <li key={step.step}>
              <span className={styles.stepIndex}>{step.step}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.guardrail}>
          Non attribuiamo sprechi, illeciti o responsabilità. Un segnale orienta un controllo;
          le ipotesi di miglioramento non sono risparmi già in cassa.
        </p>
      </section>

      <section className={styles.pathways} aria-labelledby="pathways-title">
        <div className={styles.pathwaysIntro}>
          <h2 id="pathways-title" className="panel-title">
            {pathways.length} percorsi verificabili
          </h2>
          <p>
            Numeri presi da OpenCivitas, ANAC, MEF, Corte dei conti, RGS, Banca d&apos;Italia,
            Eurostat, Guardia di finanza e dagli scenari già pubblicati su Cosa controllare.
            Nulla di nuovo inventato qui.
          </p>
        </div>

        <div className={styles.pathwayList}>
          {pathways.map((pathway, index) => (
            <article
              key={pathway.id}
              className={`panel ${styles.pathway}`}
              data-kind={pathway.kind}
              aria-labelledby={`pathway-${pathway.id}`}
            >
              <header className={styles.pathwayHeader}>
                <span className={styles.pathwayIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <span className={styles.kind}>{kindLabels[pathway.kind]}</span>
                  <span className={styles.area}>{pathway.area}</span>
                  <h3 id={`pathway-${pathway.id}`}>{pathway.headline}</h3>
                </div>
              </header>

              <dl className={styles.blocks}>
                <div>
                  <dt>Cosa emerge</dt>
                  <dd>{pathway.observation}</dd>
                </div>
                <div>
                  <dt>Dove approfondire</dt>
                  <dd>
                    <Link href={pathway.deepenHref}>{pathway.deepenLabel}</Link>
                  </dd>
                </div>
                <div>
                  <dt>Cosa si può fare</dt>
                  <dd>{pathway.action}</dd>
                </div>
              </dl>

              <footer className={styles.meta}>
                <p>
                  <span>Fonte</span>{" "}
                  {pathway.sourceUrl.startsWith("/") ? (
                    <Link href={pathway.sourceUrl}>{pathway.sourceLabel}</Link>
                  ) : (
                    <a href={pathway.sourceUrl} target="_blank" rel="noreferrer">
                      {pathway.sourceLabel} ↗
                    </a>
                  )}
                </p>
                <p>
                  <span>Periodo</span> {pathway.period}
                </p>
                <p>
                  <span>Limiti</span> {pathway.limits}
                </p>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.aiBreak} aria-hidden="true">
        <span>Fine percorsi umani</span>
        <span>Inizia agenda agenti AI</span>
      </div>

      <section className={styles.aiZone} aria-labelledby="agenda-ai-title" id="agenda-ai">
        <header className={styles.aiHero}>
          <p className={styles.aiKicker}>{aiStewardshipDisclosure.kicker}</p>
          <span className={styles.aiBadge}>{aiStewardshipDisclosure.badge}</span>
          <h2 id="agenda-ai-title" className={styles.aiTitle}>{aiStewardshipDisclosure.title}</h2>
          <p className={styles.aiSubtitle}>{aiStewardshipDisclosure.subtitle}</p>
          <p className={styles.aiLead}>{aiStewardshipDisclosure.lead}</p>
          <p className={styles.aiHowTo}>{aiStewardshipDisclosure.howToRead}</p>
        </header>

        <div className={styles.aiBody}>
          <nav className={styles.aiRail} aria-label="Priorità agenda AI">
            {aiAgenda.map((move) => (
              <a key={move.id} href={`#${move.id}`} className={styles.aiRailItem}>
                <span className={styles.aiRailNum}>{move.priority}</span>
                <span className={styles.aiRailMetric}>{move.metric.display}</span>
                <span className={styles.aiRailTitle}>{move.title}</span>
              </a>
            ))}
          </nav>

          <details className={styles.aiRulesDetails}>
            <summary>Regole AI: cosa può e non può fare</summary>
            <div className={styles.aiRules}>
              <div>
                <h3>Cosa può fare l&apos;AI qui</h3>
                <ul>
                  {aiStewardshipDisclosure.allowed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Cosa non può fare</h3>
                <ul>
                  {aiStewardshipDisclosure.prohibited.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>

          <ol className={styles.aiBoard}>
            {aiAgenda.map((move) => {
              const maxBar = Math.max(...move.bars.map((bar) => bar.value), Number.EPSILON);
              return (
                <li key={move.id} id={move.id} className={styles.aiCard}>
                  <div className={styles.aiCardTop}>
                    <span className={styles.aiPriority}>Priorità {move.priority}</span>
                    <h3>{move.title}</h3>
                  </div>

                  <p className={styles.aiProposal}>
                    <span className={styles.aiProposalLabel}>In pratica propone</span>
                    {move.proposal}
                  </p>

                  <dl className={styles.aiBrief}>
                    <div>
                      <dt>Cosa riguarda</dt>
                      <dd>{move.concerns}</dd>
                    </div>
                    <div>
                      <dt>Come lavora</dt>
                      <dd>{move.operation}</dd>
                    </div>
                    <div>
                      <dt>Che effetto avrebbe</dt>
                      <dd>{move.effect}</dd>
                    </div>
                  </dl>

                  <div className={styles.aiMetric}>
                    <span className={styles.aiMetricLabel}>{move.metric.label}</span>
                    <strong className={styles.aiMetricValue}>{move.metric.display}</strong>
                    {move.metric.hint ? (
                      <span className={styles.aiMetricHint}>{move.metric.hint}</span>
                    ) : null}
                  </div>

                  <figure className={styles.aiChart}>
                    <figcaption>{move.chartCaption}</figcaption>
                    <ul
                      className={styles.aiBars}
                      role="img"
                      aria-label={move.chartCaption}
                    >
                      {move.bars.map((bar) => (
                        <li key={`${move.id}-${bar.label}`}>
                          <div className={styles.aiBarMeta}>
                            <span>{bar.label}</span>
                            <span>{bar.display}</span>
                          </div>
                          <div className={styles.aiBarTrack} aria-hidden="true">
                            <span
                              className={styles.aiBarFill}
                              style={{ width: `${barWidthPercent(move.bars, bar.value)}%` }}
                              data-share={Math.round((bar.value / maxBar) * 100)}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </figure>

                  <div className={styles.aiCardBody}>
                    <details className={styles.aiWhyDetails}>
                      <summary>Dato di origine (osservazione)</summary>
                      <p>{move.why}</p>
                    </details>
                    <p className={styles.aiLinks}>
                      <Link href={move.deepenHref}>{move.deepenLabel} →</Link>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <section className={styles.aiMap} aria-labelledby="ai-map-title" id="mappa-interventi">
            <h3 id="ai-map-title" className={styles.aiBlockTitle}>Mappa degli interventi</h3>
            <p className={styles.aiBlockLead}>
              L&apos;ordine che seguirebbe l&apos;agente: dal vincolo del debito fino alle ipotesi
              pubbliche. Tocca un passo per saltare alla priorità.
            </p>
            <ol className={styles.aiMapList}>
              {interventionMap.map((step, index) => (
                <li key={step.moveId}>
                  <a href={`#${step.moveId}`} className={styles.aiMapStep}>
                    <span className={styles.aiMapOrder}>{step.order}</span>
                    <span className={styles.aiMapCopy}>
                      <strong>{step.label}</strong>
                      <span>{step.plain}</span>
                    </span>
                  </a>
                  {index < interventionMap.length - 1 ? (
                    <span className={styles.aiMapArrow} aria-hidden="true">↓</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.aiNext} aria-labelledby="ai-next-title" id="ancora-da-fare">
            <h3 id="ai-next-title" className={styles.aiBlockTitle}>
              Dopo la priorità 7: cosa potremmo ancora fare?
            </h3>
            <p className={styles.aiBlockLead}>
              Check sui conti e sui dati già in piattaforma (debito, manovra, territori, fondi,
              partecipate, incarichi, invalidità, confronti acquisti). Queste non sono nella lista
              delle 7 priorità: sono le prossime mosse più utili, sempre con fonte e senza accuse.
            </p>
            <ol className={styles.aiNextList}>
              {nextMoves.map((move, index) => (
                <li key={move.id} className={styles.aiNextCard}>
                  <span className={styles.aiNextIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.aiNextBody}>
                    <h4>{move.title}</h4>
                    <p className={styles.aiProposal}>
                      <span className={styles.aiProposalLabel}>In pratica propone</span>
                      {move.proposal}
                    </p>
                    <dl className={styles.aiNextMeta}>
                      <div>
                        <dt>Perché ora</dt>
                        <dd>{move.whyNow}</dd>
                      </div>
                      <div>
                        <dt>Che effetto avrebbe</dt>
                        <dd>{move.effect}</dd>
                      </div>
                    </dl>
                    <div className={styles.aiNextMetric}>
                      <span>{move.metricLabel}</span>
                      <strong>{move.metricDisplay}</strong>
                    </div>
                    <p className={styles.aiLinks}>
                      <Link href={move.deepenHref}>{move.deepenLabel} →</Link>
                      <span>{move.sourceNote}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </section>

      <section className={`panel ${styles.next}`} aria-labelledby="next-title">
        <h2 id="next-title" className="panel-title">Cosa non fa ancora questa pagina</h2>
        <ul>
          <li>Non confronta automaticamente lo stesso servizio venduto a prezzi diversi tra enti (serve un join CPV/prezzo ancora da costruire).</li>
          <li>Non pubblica piste investigative senza revisione umana.</li>
          <li>Non propone tagli nominativi a persone, ditte o amministrazioni.</li>
          <li>L&apos;agenda AI non è un modello live: è una proposta deterministica etichettata, rivedibile da un umano.</li>
        </ul>
        <p>
          Per i segnali grezzi e le tabelle complete resta{" "}
          <Link href="/controlli">Cosa controllare</Link>.
        </p>
      </section>
    </main>
  );
}
