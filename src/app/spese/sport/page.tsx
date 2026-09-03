import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import { buildSportPublicSpendingView } from "@/lib/sport-public-spending";
import styles from "./sport.module.css";

export const metadata: Metadata = {
  title: "Sport e grandi eventi: cosa sappiamo già",
  description:
    "Missione Giovani e sport in Legge di Bilancio, rendiconto PCM e RGS, e società partecipate legate allo sport. Senza totali inventati sugli eventi.",
};

function euroFromCents(cents: number): number {
  return cents / 100;
}

export default function SportSpendingPage() {
  const view = buildSportPublicSpendingView();
  const { budgetLaw, pcm, rgs } = view;
  const maxEnacted = Math.max(...budgetLaw.series.map((point) => point.enactedEur));

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Soldi · Sport</p>
        <h1>Sport: missione di bilancio, Palazzo Chigi e società partecipate</h1>
        <p>
          Prima verticale dedicata allo sport pubblico. Usiamo solo numeri già in piattaforma:
          stanziamenti della missione <strong>{view.missionLabel}</strong>, impegni e pagamenti
          di Palazzo Chigi e del MEF, più tre società partecipate legate allo sport e a Milano
          Cortina. Non sommiamo queste fonti in un totale unico.
        </p>
        <p className={styles.leadLinks}>
          <Link href="/spese/legge-di-bilancio">Legge di Bilancio →</Link>
          <Link href="/palazzo-chigi">Palazzo Chigi →</Link>
          <Link href="/partecipazioni">Partecipazioni →</Link>
          <Link href="/ministeri">Ministeri →</Link>
        </p>
      </header>

      <div className="notice">
        <strong>Cosa non è questa pagina</strong>
        <p>
          Non è il totale della spesa sportiva italiana, né un bilancio di Taranto 2026 o di
          Milano Cortina 2026. Quei pezzi richiedono fonti strutturate ancora da integrare
          (issue{" "}
          <a
            href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/83"
            target="_blank"
            rel="noreferrer"
          >
            #83
          </a>
          ). Qui partiamo da ciò che è già verificabile.
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

      <section className={`panel ${styles.section}`} aria-labelledby="pcm-rgs-title">
        <h2 id="pcm-rgs-title" className="panel-title">
          2. Impegni e pagamenti (due rendiconti diversi)
        </h2>
        <p className={styles.sectionLead}>
          Stessa etichetta di missione, due perimetri. Non vanno sommati tra loro né con lo
          stanziamento della Legge di Bilancio.
        </p>

        <div className={styles.compare}>
          <article>
            <h3>Palazzo Chigi · {pcm.referenceYear}</h3>
            <p className={styles.compareLabel}>Missione {pcm.missionCode} · {pcm.missionLabel}</p>
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
          3. Società partecipate legate allo sport
        </h2>
        <p className={styles.sectionLead}>
          Fatti di partecipazione MEF già nel dataset delle partecipate statali in focus. Servono
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
              </p>
            </li>
          ))}
        </ul>
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
