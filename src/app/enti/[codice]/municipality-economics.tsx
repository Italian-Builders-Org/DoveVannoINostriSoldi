import Link from "next/link";
import type { CSSProperties } from "react";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import type { MunicipalityProfile } from "@/lib/municipality-profile";
import { buildMunicipalitySpendingRows } from "@/lib/municipality-spending-view";
import type { ReportedMeasure } from "@/lib/mef-irpef-snapshot";
import styles from "./scheda.module.css";

function amount(measure: ReportedMeasure): number {
  return measure.coverage === "complete" ? measure.amountCents : measure.knownAmountCents;
}

function coverageLabel(measure: ReportedMeasure): string | null {
  return measure.coverage === "partial" ? "subtotale noto; alcune celle sono soppresse" : null;
}

function monthName(month: number): string {
  return new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );
}

function observedMonths(month: number): string {
  const name = monthName(month);
  return `Da gennaio ${/^[aeiou]/i.test(name) ? "ad" : "a"} ${name}`;
}

function signedEuro(cents: number): string {
  if (cents === 0) return "In linea con la spesa standard";
  return `${compactEuro(Math.abs(cents) / 100)} ${cents > 0 ? "in più" : "in meno"}`;
}

function roundedEuro(cents: number): string {
  return `${integer(Math.round(cents / 100))} €`;
}

const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function signedPerCapita(cents: number): string {
  if (cents === 0) return "Nessuno scostamento per abitante";
  return `${roundedEuro(Math.abs(cents))} ${cents > 0 ? "in più" : "in meno"} per abitante`;
}

function servicesComparison(basisPoints: number): string {
  if (basisPoints === 0) return "In linea con Comuni simili";
  return `${percent(Math.abs(basisPoints) / 100)} ${basisPoints > 0 ? "in più" : "in meno"}`;
}

const titleExplanations: Readonly<Record<string, string>> = {
  "0": "Pagamenti ancora da classificare nella voce contabile definitiva.",
  "1": "Servizi, personale, acquisti e altre spese di funzionamento.",
  "2": "Opere pubbliche, investimenti e acquisto di beni durevoli.",
  "3": "Acquisizioni di partecipazioni, crediti e altre attività finanziarie.",
  "4": "Restituzione della quota capitale di prestiti e mutui.",
  "5": "Restituzione di anticipazioni ricevute dal tesoriere.",
  "7": "Somme incassate o pagate per conto di terzi e partite di giro.",
};

function coverageText(year: MunicipalityProfile["siope"]["data"]["years"][number]): string {
  return year.completeness === "partial"
    ? `${observedMonths(year.latestMonth)} · dati parziali`
    : "Anno completo";
}

export function MunicipalityEconomics({ profile }: { profile: MunicipalityProfile }) {
  const latestSiope = profile.siope.data.years[0];
  const irpef = profile.irpef.status === "available" ? profile.irpef.data : null;
  const openCivitas = profile.openCivitas.status === "available" ? profile.openCivitas.data : null;
  const irpefUnavailable = profile.irpef.status === "available" ? null : profile.irpef.message;
  const openCivitasUnavailable = profile.openCivitas.status === "available" ? null : profile.openCivitas.message;
  const pnrr = profile.pnrrChildcare.data;
  const spendingRows = buildMunicipalitySpendingRows(latestSiope.titles, latestSiope.totalCents);
  const trendYears = profile.siope.data.years.slice().reverse();
  const geography = latestSiope.geography;
  const peer = profile.siope.peerBenchmark;
  const trendMaximum = Math.max(1, ...trendYears.map((year) => year.totalCents ?? 0));
  const openCivitasMaximum = openCivitas
    ? Math.max(openCivitas.record.historicalSpendingCents, openCivitas.record.standardSpendingCents, 1)
    : 1;
  const openCivitasPerCapitaMaximum = openCivitas
    ? Math.max(openCivitas.record.historicalPerCapitaCents, openCivitas.record.standardPerCapitaCents, 1)
    : 1;

  return (
    <>
      <nav className={styles.sectionNav} aria-label="Sezioni della scheda comunale">
        <a href="#dati-economici">Pagamenti</a>
        <a href="#dati-opencivitas">Confronto</a>
        <a href="#dati-pnrr-asili">PNRR</a>
        <a href="#dati-irpef">IRPEF</a>
        <a href="#dati-anac-aggiudicazioni">Appalti</a>
      </nav>

      <section className={`panel ${styles.economicSection}`} aria-labelledby="siope-title" id="dati-economici">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>SIOPE · pagamenti di cassa</span>
            <h2 className={styles.sectionTitle} id="siope-title">Quanto ha pagato il Comune</h2>
          </div>
        </div>

        <dl className={styles.paymentSummary} aria-label={`Sintesi dei pagamenti ${latestSiope.year}`}>
          <div className={styles.paymentTotal}>
            <dt>Totale pagato nel periodo</dt>
            <dd>
              {latestSiope.totalCents === null
                ? "Nessun movimento osservato"
                : compactEuro(latestSiope.totalCents / 100)}
            </dd>
            <small className={styles.paymentPeriod}>
              {latestSiope.completeness === "partial"
                ? `${observedMonths(latestSiope.latestMonth)} ${latestSiope.year}`
                : `Anno ${latestSiope.year}`}
            </small>
          </div>
          <div className={styles.paymentFacts}>
            <div>
              <dt>Per abitante</dt>
              <dd>
                {latestSiope.perCapitaCents === null
                  ? "Non disponibile"
                  : roundedEuro(latestSiope.perCapitaCents)}
              </dd>
            </div>
            <div>
              <dt>Per km²</dt>
              <dd>
                {latestSiope.perSquareKmCents === null
                  ? "Non disponibile"
                  : exactEuro(latestSiope.perSquareKmCents / 100)}
              </dd>
              {geography ? <small>Superficie ISTAT {decimal.format(geography.surfaceSquareKilometres)} km²</small> : null}
            </div>
            <div>
              <dt>Copertura</dt>
              <dd>
                <span className={latestSiope.completeness === "partial" ? styles.partialStatus : styles.completeStatus}>
                  {latestSiope.completeness === "partial" ? "Dati parziali" : "Anno completo"}
                </span>
              </dd>
              {latestSiope.completeness === "partial" ? <small>L’anno è ancora in corso</small> : null}
            </div>
          </div>
        </dl>

        {peer && latestSiope.perSquareKmCents !== null ? (
          <section className={styles.peerBenchmark} aria-labelledby="peer-benchmark-title">
            <div className={styles.sectionHeading}>
              <div>
                <h3 id="peer-benchmark-title">Confronto con Comuni simili</h3>
                <p>
                  {peer.peers} Comuni confrontabili · {peer.criteria.join(", ")} · dati SIOPE {peer.year};{" "}
                  {peer.populationYear === null
                    ? "ultima popolazione ISTAT disponibile, anno non dichiarato"
                    : `Popolazione ISTAT ${peer.populationYear}`}.
                </p>
              </div>
              <span className="tag tag-neutral">{peer.year}</span>
            </div>
            <div
              className={styles.peerTrack}
              style={{
                "--peer-start": `${Math.min(100, peer.perSquareKmCents.p25 / Math.max(peer.perSquareKmCents.p75, latestSiope.perSquareKmCents) * 100)}%`,
                "--peer-width": `${Math.max(2, (peer.perSquareKmCents.p75 - peer.perSquareKmCents.p25) / Math.max(peer.perSquareKmCents.p75, latestSiope.perSquareKmCents) * 100)}%`,
                "--municipality-position": `${Math.min(100, latestSiope.perSquareKmCents / Math.max(peer.perSquareKmCents.p75, latestSiope.perSquareKmCents) * 100)}%`,
              } as CSSProperties}
              aria-label={`Il Comune registra ${exactEuro(latestSiope.perSquareKmCents / 100)} per km²; mediana dei territori simili ${exactEuro(peer.perSquareKmCents.median / 100)}`}
            >
              <span aria-hidden="true"><i /><b /></span>
            </div>
            <dl className={styles.peerValues}>
              <div><dt>Comune</dt><dd>{exactEuro(latestSiope.perSquareKmCents / 100)} / km²</dd></div>
              <div><dt>Mediana dei pari</dt><dd>{exactEuro(peer.perSquareKmCents.median / 100)} / km²</dd></div>
              <div><dt>Fascia centrale</dt><dd>Da {exactEuro(peer.perSquareKmCents.p25 / 100)} a {exactEuro(peer.perSquareKmCents.p75 / 100)}</dd></div>
            </dl>
            {peer.perCapitaCents && latestSiope.perCapitaCents !== null ? (
              <dl className={styles.peerValues} aria-label="Confronto per abitante con Comuni simili">
                <div><dt>Comune per abitante</dt><dd>{roundedEuro(latestSiope.perCapitaCents)}</dd></div>
                <div><dt>Mediana pari / ab.</dt><dd>{roundedEuro(peer.perCapitaCents.median)}</dd></div>
                <div>
                  <dt>Fascia centrale / ab.</dt>
                  <dd>Da {roundedEuro(peer.perCapitaCents.p25)} a {roundedEuro(peer.perCapitaCents.p75)}</dd>
                </div>
              </dl>
            ) : null}
            <p className={styles.sourceNote}>Il confronto è descrittivo: non misura efficienza, qualità dei servizi o spesa necessaria.</p>
          </section>
        ) : null}

        {latestSiope.hasMovements ? (
          <div className={styles.spendingBreakdown}>
            <h3>Per cosa ha pagato il Comune</h3>
            <p>Le categorie contabili mostrate compongono il totale registrato nel periodo.</p>
            <div aria-label={`Principali pagamenti ${latestSiope.year} per categoria SIOPE`}>
              {spendingRows.map((title) => {
                const share = latestSiope.totalCents
                  ? Math.max(0, Math.min(100, title.amountCents / latestSiope.totalCents * 100))
                  : 0;
                return (
                  <div className={styles.spendingRow} key={title.key}>
                    <div>
                      <strong>{title.label}</strong>
                      <span>{percent(share)}</span>
                    </div>
                    <div className={styles.spendingTrack} aria-hidden="true">
                      <span style={{ "--share": `${share}%` } as CSSProperties} />
                    </div>
                    <b>{compactEuro(title.amountCents / 100)}</b>
                  </div>
                );
              })}
            </div>
            <details className={styles.methodDetails} data-siope-titles>
              <summary>Cosa significano i Titoli SIOPE?</summary>
              <p>I numeri sono codici contabili, non una graduatoria. Il Titolo 6 non appartiene alle uscite.</p>
              <dl>
                {latestSiope.titles
                  .slice()
                  .sort((left, right) => Number(left.code) - Number(right.code))
                  .map((title) => (
                    <div key={title.code}>
                      <dt>Titolo {title.code} · {title.label}</dt>
                      <dd>{titleExplanations[title.code]}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </div>
        ) : (
          <div className="notice warning-notice">
            SIOPE riconosce il Comune, ma non pubblica movimenti nel periodo selezionato. Non trasformiamo l’assenza in zero.
          </div>
        )}

        <section className={styles.paymentTrend} aria-labelledby="payment-trend-title">
          <div>
            <h3 id="payment-trend-title">Pagamenti registrati per anno</h3>
            <p>Il 2026 copre solo i mesi disponibili e non è direttamente confrontabile con gli anni completi.</p>
          </div>
          <ul
            className={styles.trendChart}
            data-siope-history-chart
            aria-label="Pagamenti comunali per anno e copertura"
          >
            {trendYears.map((year) => {
              const barHeight = year.totalCents === null ? 0 : year.totalCents / trendMaximum * 100;
              return (
                <li key={year.year}>
                  <strong>{year.year}</strong>
                  <b>{year.totalCents === null ? "Nessun movimento" : compactEuro(year.totalCents / 100)}</b>
                  <span className={styles.trendPlot} aria-hidden="true">
                    <span
                      className={year.totalCents === null || year.totalCents === 0
                        ? styles.trendBarEmpty
                        : year.completeness === "partial"
                          ? styles.trendBarPartial
                          : styles.trendBarComplete}
                      style={{ "--bar-height": `${barHeight}%` } as CSSProperties}
                    />
                  </span>
                  <small>
                    {year.completeness === "partial"
                      ? `${observedMonths(year.latestMonth)} · parziale`
                      : "Anno completo"}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>

        <details className={styles.secondarySection} data-siope-detail>
          <summary>
            <span>
              <strong>Confronti e dettaglio territoriale</strong>
              <em>Caratteristiche del territorio e importi esatti per anno</em>
            </span>
          </summary>
          <div className={styles.secondaryContent}>
            {geography ? (
              <>
                <h3>Caratteristiche del territorio</h3>
                <dl className={styles.definitions}>
                  <div><dt>Superficie</dt><dd>{decimal.format(geography.surfaceSquareKilometres)} km²</dd></div>
                  <div><dt>Densità</dt><dd>{geography.densityPerSquareKilometre === null ? "n.d." : `${integer(Math.round(geography.densityPerSquareKilometre))} ab./km²`}</dd></div>
                  <div><dt>Altimetria</dt><dd>{geography.altimetricZoneLabel ?? "n.d."}{geography.altitudeMetres === null ? "" : ` · ${integer(geography.altitudeMetres)} m`}</dd></div>
                  <div><dt>Urbanizzazione</dt><dd>{geography.degreeUrbanizationLabel ?? "n.d."}</dd></div>
                  <div><dt>Litoraneità</dt><dd>{geography.coastal ? "Comune litoraneo" : "Non litoraneo"}</dd></div>
                  <div><dt>Insularità</dt><dd>{geography.island ? "Comune isolano" : "Non isolano"}</dd></div>
                </dl>
                <p className={styles.sourceNote}>
                  Fonte: <a href="https://situas.istat.it/web/#/territorio" target="_blank" rel="noreferrer">ISTAT SITUAS ↗</a>, quadro territoriale al {geography.referenceDate}.
                </p>
              </>
            ) : null}

            <details className={styles.paymentHistory} data-payment-history>
              <summary>Vedi importi esatti e periodi coperti</summary>
              <div className={styles.historyTable} role="region" aria-label="Storico dei pagamenti comunali">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Anno</th>
                      <th scope="col">Copertura</th>
                      <th scope="col">Totale</th>
                      <th scope="col">Per abitante</th>
                      <th scope="col">Per km²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.siope.data.years.map((year) => (
                      <tr key={year.year}>
                        <th scope="row">{year.year}</th>
                        <td data-label="Copertura">{coverageText(year)}</td>
                        <td data-label="Totale">{year.totalCents === null ? "Nessun movimento" : compactEuro(year.totalCents / 100)}</td>
                        <td data-label="Per abitante">{year.perCapitaCents === null ? "Non disponibile" : exactEuro(year.perCapitaCents / 100)}</td>
                        <td data-label="Per km²">{year.perSquareKmCents === null ? "Non disponibile" : exactEuro(year.perSquareKmCents / 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </details>

        <p className={styles.sourceNote}>
          Fonte: <a href={profile.siope.sources[0].url} target="_blank" rel="noreferrer">SIOPE · Ragioneria Generale dello Stato e Banca d’Italia ↗</a>.
          Questi dati mostrano quanto il Comune ha pagato, non necessariamente il territorio o il servizio che ne ha beneficiato.
        </p>
      </section>

      <section className={`panel ${styles.economicSection} ${styles.insightSection}`} aria-labelledby="opencivitas-title" id="dati-opencivitas">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>OpenCivitas · fabbisogni e servizi</span>
            <h2 className={styles.sectionTitle} id="opencivitas-title">Spesa e servizi a confronto</h2>
          </div>
          {openCivitas ? <span className="tag tag-neutral">{openCivitas.referenceYear}</span> : null}
        </div>
        {openCivitas ? (
          <>
            <div className={styles.benchmarkBlock}>
              <h3>Spesa registrata e valore di riferimento</h3>
              <p>
                La spesa standard è un valore di riferimento calcolato considerando le caratteristiche del Comune
                e i servizi analizzati dalla fonte.
              </p>
              <ul
                className={styles.benchmarkChart}
                data-opencivitas-chart
                aria-label={`Spesa storica e standard ${openCivitas.referenceYear}`}
              >
                {[
                  {
                    amountCents: openCivitas.record.historicalSpendingCents,
                    key: "historical",
                    label: "Spesa registrata",
                  },
                  {
                    amountCents: openCivitas.record.standardSpendingCents,
                    key: "standard",
                    label: "Valore di riferimento",
                  },
                ].map((row) => (
                  <li key={row.key}>
                    <strong>{row.label}</strong>
                    <span className={styles.benchmarkTrack} aria-hidden="true">
                      <span
                        className={row.key === "historical" ? styles.benchmarkHistorical : styles.benchmarkStandard}
                        style={{ "--share": `${row.amountCents / openCivitasMaximum * 100}%` } as CSSProperties}
                      />
                    </span>
                    <b>{compactEuro(row.amountCents / 100)}</b>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.benchmarkBlock}>
              <h3>Spesa per abitante</h3>
              <ul
                className={styles.benchmarkChart}
                aria-label={`Spesa per abitante storica e standard ${openCivitas.referenceYear}`}
              >
                {[
                  {
                    amountCents: openCivitas.record.historicalPerCapitaCents,
                    key: "historical-pc",
                    label: "Registrata / ab.",
                  },
                  {
                    amountCents: openCivitas.record.standardPerCapitaCents,
                    key: "standard-pc",
                    label: "Riferimento / ab.",
                  },
                ].map((row) => (
                  <li key={row.key}>
                    <strong>{row.label}</strong>
                    <span className={styles.benchmarkTrack} aria-hidden="true">
                      <span
                        className={row.key.startsWith("historical") ? styles.benchmarkHistorical : styles.benchmarkStandard}
                        style={{ "--share": `${row.amountCents / openCivitasPerCapitaMaximum * 100}%` } as CSSProperties}
                      />
                    </span>
                    <b>{roundedEuro(row.amountCents)}</b>
                  </li>
                ))}
              </ul>
            </div>
            <dl className={styles.benchmarkFacts}>
              <div>
                <dt>Differenza rispetto al valore di riferimento</dt>
                <dd>{signedEuro(openCivitas.record.differenceCents)}</dd>
                <small>{signedPerCapita(openCivitas.record.differencePerCapitaCents)}</small>
              </div>
              <div>
                <dt>Differenza per km²</dt>
                <dd>{openCivitas.differencePerSquareKmCents === null ? "Non disponibile" : signedEuro(openCivitas.differencePerSquareKmCents)}</dd>
                <small>Normalizzazione sulla superficie ISTAT {openCivitas.referenceYear}</small>
              </div>
              <div>
                <dt>Servizi rispetto a Comuni simili</dt>
                <dd>{openCivitas.record.serviceDifferenceBasisPoints === null ? "Non valutabile" : servicesComparison(openCivitas.record.serviceDifferenceBasisPoints)}</dd>
                <small>{openCivitas.record.serviceLevel === null ? "Indicatore non disponibile" : `Indicatore OpenCivitas: livello ${openCivitas.record.serviceLevel} su 10`}</small>
              </div>
            </dl>
            <dl className={styles.metricGrid} aria-label="Livelli OpenCivitas">
              <div>
                <dt>Livello spesa</dt>
                <dd>{openCivitas.record.spendingLevel === null ? "n.d." : `${openCivitas.record.spendingLevel} / 10`}</dd>
              </div>
              <div>
                <dt>Livello servizi</dt>
                <dd>{openCivitas.record.serviceLevel === null ? "n.d." : `${openCivitas.record.serviceLevel} / 10`}</dd>
              </div>
            </dl>
            <p className={styles.sourceNote}>
              Fonte: <a href={openCivitas.source.datasetUrl} target="_blank" rel="noreferrer">OpenCivitas ↗</a>.
              La differenza dalla spesa standard non dimostra uno spreco: va letta con servizi, costi e caratteristiche locali.
            </p>
          </>
        ) : (
          <div className="notice warning-notice">{openCivitasUnavailable}</div>
        )}
      </section>

      <section className={`panel ${styles.economicSection} ${styles.insightSection}`} aria-labelledby="pnrr-title" id="dati-pnrr-asili">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>PNRR · asili e prima infanzia</span>
            <h2 className={styles.sectionTitle} id="pnrr-title">Progetti PNRR per asili e prima infanzia</h2>
          </div>
          <span className="tag tag-neutral">Dati al {longDate(pnrr.referenceDate)}</span>
        </div>
        <dl className={styles.metricGrid}>
          <div><dt>Progetti collegati al Comune</dt><dd>{integer(pnrr.totalProjects)}</dd></div>
          <div>
            <dt>Finanziamenti pubblicati</dt>
            <dd>{pnrr.projectsWithKnownFunding === 0 ? "Non disponibile" : compactEuro(pnrr.knownTotalFundingCents / 100)}</dd>
            <small>{integer(pnrr.projectsWithKnownFunding)} progetti con importo disponibile</small>
          </div>
        </dl>
        {pnrr.projects.length > 0 ? (
          <details className={styles.methodDetails} data-pnrr-projects>
            <summary>Vedi i {integer(pnrr.projects.length)} progetti collegati</summary>
            <ul className={styles.projectList}>
              {pnrr.projects.map((project) => (
                <li key={project.cup}>
                  <Link href={`/progetti/${encodeURIComponent(project.cup)}`}>{project.title}</Link>
                  <span>
                    CUP {project.cup}
                    {project.phase ? ` · ${project.phase}` : ""}
                    {project.progress ? ` · ${project.progress}` : ""}
                    {project.totalFundingCents === null ? "" : ` · ${compactEuro(project.totalFundingCents / 100)}`}
                  </span>
                </li>
              ))}
            </ul>
            {pnrr.totalProjects > pnrr.projects.length ? (
              <p className={styles.sourceNote}>
                Elenco limitato ai primi {integer(pnrr.projects.length)} progetti; in totale ne risultano {integer(pnrr.totalProjects)}.
              </p>
            ) : null}
          </details>
        ) : (
          <p className={styles.emptyState}>
            Nessun progetto collegato al Comune in questo specifico ambito. Il risultato non riguarda l’intero PNRR.
          </p>
        )}
        <p className={styles.sourceNote}>
          Fonte: <a href={pnrr.source.landingUrl} target="_blank" rel="noreferrer">Italia Domani ↗</a>.
          L’importo finanziato non corrisponde necessariamente a somme già pagate. Questa sezione copre soltanto
          asili e prima infanzia.
        </p>
      </section>

      <details className={`panel ${styles.secondarySection}`} data-irpef-details id="dati-irpef">
        <summary>
          <span>
            <small>MEF · dichiarazioni fiscali</small>
            <strong>Redditi e imposte dei residenti</strong>
            <em>
              {irpef
                ? `${integer(irpef.record.taxpayers)} contribuenti · addizionale comunale ${compactEuro(amount(irpef.record.measures.municipalSurtaxDue) / 100)}`
                : "Contesto fiscale: non sono entrate o spese del Comune."}
            </em>
          </span>
          {irpef ? <span className="tag tag-neutral">Anno d’imposta {irpef.period.taxYear}</span> : null}
        </summary>
        <div className={styles.secondaryContent}>
          {irpef ? (
            <>
              <dl className={styles.metricGrid}>
                <div><dt>Contribuenti</dt><dd>{integer(irpef.record.taxpayers)}</dd></div>
                <div>
                  <dt>Reddito complessivo</dt>
                  <dd>{compactEuro(amount(irpef.record.measures.comprehensiveIncome) / 100)}</dd>
                  {coverageLabel(irpef.record.measures.comprehensiveIncome) ? <small>{coverageLabel(irpef.record.measures.comprehensiveIncome)}</small> : null}
                </div>
                <div>
                  <dt>Reddito imponibile</dt>
                  <dd>{compactEuro(amount(irpef.record.measures.taxableIncome) / 100)}</dd>
                  {coverageLabel(irpef.record.measures.taxableIncome) ? <small>{coverageLabel(irpef.record.measures.taxableIncome)}</small> : null}
                </div>
                <div>
                  <dt>Imposta netta dichiarata</dt>
                  <dd>{compactEuro(amount(irpef.record.measures.netTaxDeclared) / 100)}</dd>
                  {coverageLabel(irpef.record.measures.netTaxDeclared) ? <small>{coverageLabel(irpef.record.measures.netTaxDeclared)}</small> : null}
                </div>
                <div>
                  <dt>Addizionale regionale dovuta</dt>
                  <dd>{compactEuro(amount(irpef.record.measures.regionalSurtaxDue) / 100)}</dd>
                  {coverageLabel(irpef.record.measures.regionalSurtaxDue) ? <small>{coverageLabel(irpef.record.measures.regionalSurtaxDue)}</small> : null}
                </div>
                <div>
                  <dt>Addizionale comunale dovuta</dt>
                  <dd>{compactEuro(amount(irpef.record.measures.municipalSurtaxDue) / 100)}</dd>
                  {coverageLabel(irpef.record.measures.municipalSurtaxDue) ? <small>{coverageLabel(irpef.record.measures.municipalSurtaxDue)}</small> : null}
                </div>
              </dl>
              <p className={styles.sourceNote}>
                Fonte: <a href={irpef.source.landingUrl} target="_blank" rel="noreferrer">Dipartimento delle Finanze ↗</a>.
                Sono dichiarazioni fiscali dei residenti e non una stima dell’evasione.
              </p>
            </>
          ) : <div className="notice warning-notice">{irpefUnavailable}</div>}
        </div>
      </details>
    </>
  );
}
