import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import { buildSportPublicSpendingView } from "@/lib/sport-public-spending";
import styles from "./sport.module.css";

export const metadata: Metadata = {
  title: "Sport e grandi eventi: cosa sappiamo già",
  description:
    "Missione Giovani e sport in Legge di Bilancio, capitoli MEF su Cortina e Taranto, rendiconto PCM e RGS, partecipate e affidamenti AT di Sport e Salute.",
};

function euroFromCents(cents: number): number {
  return cents / 100;
}

function kindLabel(kind: "ente" | "evento" | "fondo"): string {
  if (kind === "evento") return "Evento";
  if (kind === "fondo") return "Fondo";
  return "Ente";
}

export default async function SportSpendingPage() {
  const view = await buildSportPublicSpendingView();
  const { budgetLaw, pcm, rgs, chapters, procurement } = view;
  const maxEnacted = Math.max(...budgetLaw.series.map((point) => point.enactedEur));
  const maxProgramForecast = Math.max(
    ...chapters.programs2026Forecast.map((point) => point.amountEur),
    1,
  );

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Soldi · Sport</p>
        <h1>Sport: missione di bilancio, capitoli MEF e società partecipate</h1>
        <p>
          Verticale dedicata allo sport pubblico. Usiamo solo numeri già in piattaforma:
          stanziamenti della missione <strong>{view.missionLabel}</strong>, dettaglio capitoli
          OpenBDAP (inclusi trasferimenti a Cortina e Taranto), impegni e pagamenti di Palazzo
          Chigi e del MEF, partecipate e affidamenti AT di Sport e Salute. Non sommiamo queste
          fonti in un totale unico.
        </p>
        <p className={styles.leadLinks}>
          <Link href="/spese/legge-di-bilancio">Legge di Bilancio →</Link>
          <Link href="/palazzo-chigi">Palazzo Chigi →</Link>
          <Link href="/partecipazioni">Partecipazioni →</Link>
          <Link href="/ministeri">Ministeri →</Link>
          <Link href="/dati/openbdap-capitoli-2024-2026">Capitoli OpenBDAP →</Link>
        </p>
      </header>

      <div className="notice">
        <strong>Cosa non è questa pagina</strong>
        <p>
          Non è il totale della spesa sportiva italiana, né il bilancio completo di Taranto 2026
          o di Milano Cortina 2026. I capitoli MEF mostrano trasferimenti contabili verso
          commissari ed enti, non le opere CUP né i bilanci dei comitati (issue{" "}
          <a
            href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/83"
            target="_blank"
            rel="noreferrer"
          >
            #83
          </a>
          ).
        </p>
      </div>

      <dl className={`stat-strip ${styles.stats}`}>
        <div>
          <dt>Stanziamento LdB {budgetLaw.latest.year}</dt>
          <dd>{compactEuro(budgetLaw.latest.enactedEur)}</dd>
          <span className="stat-note">
            Missione {view.missionLabel}
            {budgetLaw.deltaEur !== null && budgetLaw.previous
              ? ` · ${budgetLaw.deltaEur >= 0 ? "+" : ""}${compactEuro(budgetLaw.deltaEur)} vs ${budgetLaw.previous.year}`
              : null}
          </span>
        </div>
        <div>
          <dt>Pagato PCM {pcm.referenceYear}</dt>
          <dd>{compactEuro(euroFromCents(pcm.paymentsCents))}</dd>
          <span className="stat-note">
            Solo Presidenza del Consiglio · missione {pcm.missionCode}
          </span>
        </div>
        <div>
          <dt>Pagato MEF {rgs.referenceYear}</dt>
          <dd>{compactEuro(euroFromCents(rgs.paymentsCompetenceCpCents))}</dd>
          <span className="stat-note">
            Competenza CP · missione {rgs.missionCode} nel rendiconto ministeri
          </span>
        </div>
        {procurement ? (
          <div>
            <dt>Affidamenti AT Sport e Salute</dt>
            <dd>{compactEuro(procurement.totalEur)}</dd>
            <span className="stat-note">
              {integer(procurement.uniqueCig)} CIG unici · non è il bilancio della società
            </span>
          </div>
        ) : null}
      </dl>

      <section className={`panel ${styles.section}`} aria-labelledby="ldb-title">
        <h2 id="ldb-title" className="panel-title">
          1. Stanziamenti della missione Giovani e sport
        </h2>
        <p className={styles.sectionLead}>
          Valori di Legge di Bilancio pubblicata (competenza A1). È denaro autorizzato in
          manovra, non denaro già uscito.
        </p>

        <figure className={styles.chart}>
          <figcaption>
            Serie dal {budgetLaw.series[0]?.year} al {budgetLaw.latest.year} · OpenBDAP
          </figcaption>
          <ul className={styles.bars} role="img" aria-label="Stanziamenti annuali Giovani e sport">
            {budgetLaw.series.map((point) => {
              const width = Math.max(4, Math.round((point.enactedEur / maxEnacted) * 100));
              return (
                <li key={point.year}>
                  <div className={styles.barMeta}>
                    <span>{point.year}</span>
                    <span>{compactEuro(point.enactedEur)}</span>
                  </div>
                  <div className={styles.barTrack} aria-hidden="true">
                    <span className={styles.barFill} style={{ width: `${width}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </figure>

        {budgetLaw.deltaPct !== null && budgetLaw.previous ? (
          <p className={styles.deltaNote}>
            Dal {budgetLaw.previous.year} al {budgetLaw.latest.year} lo stanziamento è cambiato di{" "}
            {percent(budgetLaw.deltaPct, 1)} ({exactEuro(budgetLaw.deltaEur!)}).
          </p>
        ) : null}

        <footer className={styles.meta}>
          <p>
            <span>Fonte</span>{" "}
            <a href={budgetLaw.datasetUrl} target="_blank" rel="noreferrer">
              {budgetLaw.sourceTitle} ↗
            </a>
          </p>
          <p>
            <span>Licenza</span> {budgetLaw.license}
          </p>
          <p>
            <span>Acquisito</span> {longDate(budgetLaw.observedAt)}
          </p>
        </footer>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="chapters-title">
        <h2 id="chapters-title" className="panel-title">
          2. Programmi e capitoli MEF (OpenBDAP)
        </h2>
        <p className={styles.sectionLead}>
          Stesso perimetro missione, grano capitolo. Amministrazione:{" "}
          {chapters.administrationLabel}. {integer(chapters.missionRows)} righe nel corpus{" "}
          <Link href={`/dati/${chapters.datasetId}`}>{chapters.datasetTitle}</Link>.
        </p>

        <div className={styles.compare}>
          <article>
            <h3>Programmi · previsione 2026</h3>
            <p className={styles.compareLabel}>Legge di bilancio · previsioni definitive CP</p>
            <ul className={styles.programList}>
              {chapters.programs2026Forecast.map((point) => {
                const width = Math.max(
                  4,
                  Math.round((point.amountEur / maxProgramForecast) * 100),
                );
                return (
                  <li key={point.program}>
                    <div className={styles.barMeta}>
                      <span>{point.program}</span>
                      <span>{compactEuro(point.amountEur)}</span>
                    </div>
                    <div className={styles.barTrack} aria-hidden="true">
                      <span className={styles.barFill} style={{ width: `${width}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </article>
          <article>
            <h3>Programmi · pagato 2025</h3>
            <p className={styles.compareLabel}>Rendiconto · pagato</p>
            <ul className={styles.programList}>
              {chapters.programs2025Paid.map((point) => (
                <li key={point.program}>
                  <div className={styles.barMeta}>
                    <span>{point.program}</span>
                    <span>{compactEuro(point.amountEur)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>

        <h3 className={styles.subheading}>Trasferimenti con destinatario riconoscibile</h3>
        <p className={styles.sectionLead}>
          Selezione curata di capitoli già etichettati nella fonte (enti, fondi, commissari di
          eventi). Un trasferimento non è il bilancio dell&apos;evento.
        </p>
        <div className="table-scroll" role="region" aria-label="Capitoli focus sport">
          <table className={styles.chapterTable}>
            <thead>
              <tr>
                <th scope="col">Capitolo</th>
                <th scope="col">Destinatario / oggetto</th>
                <th scope="col" className="num">
                  Pagato 2025
                </th>
                <th scope="col" className="num">
                  Previsione 2026
                </th>
              </tr>
            </thead>
            <tbody>
              {chapters.focus.map((row) => (
                <tr key={row.number}>
                  <td>
                    <span className={styles.chapterNumber}>{row.number}</span>
                    <span className={styles.chapterKind}>{kindLabel(row.kind)}</span>
                  </td>
                  <td>
                    <strong>{row.shortLabel}</strong>
                    <span className={styles.chapterDetail}>{row.chapterLabel}</span>
                  </td>
                  <td className="num">
                    {row.paid2025Eur === null ? "n/d" : compactEuro(row.paid2025Eur)}
                  </td>
                  <td className="num">
                    {row.forecast2026Eur === null ? "n/d" : compactEuro(row.forecast2026Eur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.tableNote}>
          “n/d” indica che la fonte non espone quel valore per quell&apos;esercizio o quel
          capitolo.
        </p>

        <ul className={styles.notes}>
          {chapters.caveats.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="pcm-rgs-title">
        <h2 id="pcm-rgs-title" className="panel-title">
          3. Impegni e pagamenti (due rendiconti diversi)
        </h2>
        <p className={styles.sectionLead}>
          Stessa etichetta di missione, due perimetri. Non vanno sommati tra loro né con lo
          stanziamento della Legge di Bilancio né con i capitoli sopra.
        </p>

        <div className={styles.compare}>
          <article>
            <h3>Palazzo Chigi · {pcm.referenceYear}</h3>
            <p className={styles.compareLabel}>
              Missione {pcm.missionCode} · {pcm.missionLabel}
            </p>
            <dl className={styles.compareStats}>
              <div>
                <dt>Impegnato</dt>
                <dd>{compactEuro(euroFromCents(pcm.commitmentsCents))}</dd>
              </div>
              <div>
                <dt>Pagato</dt>
                <dd>{compactEuro(euroFromCents(pcm.paymentsCents))}</dd>
              </div>
            </dl>
            <p className={styles.compareNote}>
              Solo la Presidenza del Consiglio. Dettaglio in{" "}
              <Link href="/palazzo-chigi">Palazzo Chigi</Link>.
            </p>
            <p className={styles.metaLine}>
              Fonte:{" "}
              <a href={pcm.sourceUrl} target="_blank" rel="noreferrer">
                {pcm.sourceTitle} ↗
              </a>{" "}
              · acquisito {longDate(pcm.acquiredAt)}
            </p>
          </article>

          <article>
            <h3>MEF · rendiconto {rgs.referenceYear}</h3>
            <p className={styles.compareLabel}>
              Missione {rgs.missionCode} · {rgs.missionLabel}
            </p>
            <dl className={styles.compareStats}>
              <div>
                <dt>Impegnato (CP)</dt>
                <dd>{compactEuro(euroFromCents(rgs.commitmentsCpCents))}</dd>
              </div>
              <div>
                <dt>Pagato competenza (CP)</dt>
                <dd>{compactEuro(euroFromCents(rgs.paymentsCompetenceCpCents))}</dd>
              </div>
              <div>
                <dt>Residuo CP</dt>
                <dd>{compactEuro(euroFromCents(rgs.remainingCpCents))}</dd>
              </div>
            </dl>
            <p className={styles.compareNote}>
              Amministrazione: {rgs.administrationLabel}. Vista ministeri in{" "}
              <Link href="/ministeri">Ministeri</Link>.
            </p>
            <p className={styles.metaLine}>
              Fonte:{" "}
              <a href={rgs.sourceUrl} target="_blank" rel="noreferrer">
                {rgs.sourceTitle} ↗
              </a>{" "}
              · acquisito {longDate(rgs.acquiredAt)}
            </p>
          </article>
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="entities-title">
        <h2 id="entities-title" className="panel-title">
          4. Società partecipate e trasparenza
        </h2>
        <p className={styles.sectionLead}>
          Fatti di partecipazione MEF e indici Amministrazione Trasparente già nel corpus. Servono
          a capire chi c&apos;è nel perimetro, non a stimare la spesa di un evento.
        </p>

        <ul className={styles.entityList}>
          {view.entities.map((entity) => (
            <li key={entity.id}>
              <h3>{entity.name}</h3>
              <p>{entity.role}</p>
              <dl className={styles.entityMeta}>
                <div>
                  <dt>Quota MEF</dt>
                  <dd>{entity.mefShare}</dd>
                </div>
                <div>
                  <dt>IPA</dt>
                  <dd>{entity.ipa}</dd>
                </div>
                <div>
                  <dt>Socio</dt>
                  <dd>{entity.parent}</dd>
                </div>
              </dl>
              <p className={styles.entityLinks}>
                <a href={entity.siteUrl} target="_blank" rel="noreferrer">
                  Sito ufficiale ↗
                </a>
                <a href={entity.sourceUrl} target="_blank" rel="noreferrer">
                  Fonte MEF partecipazioni ↗
                </a>
                {entity.at.hubUrl ? (
                  <a href={entity.at.hubUrl} target="_blank" rel="noreferrer">
                    Amministrazione Trasparente ↗
                  </a>
                ) : null}
                {entity.at.bandiUrl ? (
                  <a href={entity.at.bandiUrl} target="_blank" rel="noreferrer">
                    Bandi ↗
                  </a>
                ) : null}
                {entity.at.affidamentiUrl ? (
                  <a href={entity.at.affidamentiUrl} target="_blank" rel="noreferrer">
                    Affidamenti diretti ↗
                  </a>
                ) : null}
              </p>
              {entity.at.note ? <p className={styles.atNote}>{entity.at.note}</p> : null}
            </li>
          ))}
        </ul>

        {procurement ? (
          <div className={styles.procurementBox}>
            <h3 className={styles.subheading}>Affidamenti diretti · Sport e Salute</h3>
            <p className={styles.sectionLead}>
              Estratto dal dataset hashed degli affidamenti delle partecipate. Deduplica per CIG
              prima della somma.
            </p>
            <dl className={styles.compareStats}>
              <div>
                <dt>Importo sommato</dt>
                <dd>{compactEuro(procurement.totalEur)}</dd>
              </div>
              <div>
                <dt>CIG unici</dt>
                <dd>{integer(procurement.uniqueCig)}</dd>
              </div>
              <div>
                <dt>Con importo</dt>
                <dd>{integer(procurement.rowsWithAmount)}</dd>
              </div>
              <div>
                <dt>Max singolo</dt>
                <dd>
                  {procurement.maxSingleEur === null
                    ? "n/d"
                    : compactEuro(procurement.maxSingleEur)}
                </dd>
              </div>
            </dl>
            <ul className={styles.notes}>
              {procurement.caveats.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className={styles.metaLine}>
              Fonte corpus: {procurement.sourceTitle} · IPA {procurement.ipa}
            </p>
          </div>
        ) : null}
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="next-title">
        <h2 id="next-title" className="panel-title">
          Cosa manca ancora (e perché)
        </h2>
        <ul className={styles.outOfScope}>
          {view.outOfScope.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3 className={styles.subheading}>Come leggere i numeri</h3>
        <ul className={styles.notes}>
          {view.readingNotes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className={styles.follow}>
          Prossimi passi possibili: riparti strutturati del Fondo unico, CUP OpenCoesione /
          OpenBDAP per le opere degli eventi, bilanci hashati di Sport e Salute. Discussione su{" "}
          <a
            href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/83"
            target="_blank"
            rel="noreferrer"
          >
            issue #83 ↗
          </a>
          .
        </p>
      </section>
    </main>
  );
}
