import type { Metadata } from "next";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Building06Icon,
  Database02Icon,
  HierarchyIcon,
  LegalDocument01Icon,
} from "@hugeicons/core-free-icons";
import { mefParticipationsSnapshot as snapshot } from "@/lib/mef-participations-snapshot";
import styles from "./partecipazioni.module.css";

export const metadata: Metadata = {
  title: "Partecipazioni pubbliche",
  description: "Quadro verificabile del censimento MEF delle partecipazioni pubbliche.",
};

const number = new Intl.NumberFormat("it-IT");
const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "Europe/Rome" });

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed);
}

export default function ParticipationsPage() {
  const directShare = snapshot.totals.participationRecords > 0
    ? (snapshot.totals.directParticipationRecords / snapshot.totals.participationRecords) * 100
    : 0;

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Quadro</Link><span>→</span><Link href="/enti">Organizzazioni</Link><span>→</span><span>Partecipazioni</span>
      </nav>

      <header className={styles.header}>
        <div>
          <h1>Partecipazioni pubbliche</h1>
          <p>
            Relazioni dichiarate dalle amministrazioni nel censimento MEF, riferite al 31 dicembre {snapshot.referenceYear}.
            Una partecipazione non significa automaticamente che la società sia oggi controllata dalla PA o operi per essa.
          </p>
        </div>
        <a href={snapshot.source.landingUrl} target="_blank" rel="noreferrer">
          Apri la rilevazione MEF <span>↗</span>
        </a>
      </header>

      <section className={styles.metrics} aria-label="Dimensione del censimento MEF">
        <article className={styles.primaryMetric}>
          <span><HugeiconsIcon icon={HierarchyIcon} size={19} strokeWidth={1.5} aria-hidden="true" /> Partecipazioni dichiarate</span>
          <strong>{number.format(snapshot.totals.participationRecords)}</strong>
          <p>Ogni riga collega un&apos;amministrazione a una società o organizzazione partecipata per l&apos;anno indicato.</p>
        </article>
        <dl>
          <div><dt>Amministrazioni dichiaranti</dt><dd>{number.format(snapshot.totals.declaringAdministrations)}</dd></div>
          <div><dt>Organizzazioni partecipate</dt><dd>{number.format(snapshot.totals.participatedOrganizations)}</dd></div>
          <div><dt>Partecipazioni dirette</dt><dd>{number.format(snapshot.totals.directParticipationRecords)}</dd></div>
          <div><dt>Partecipazioni indirette</dt><dd>{number.format(snapshot.totals.indirectParticipationRecords)}</dd></div>
        </dl>
      </section>

      <section className={styles.analysisGrid}>
        <article className={styles.composition}>
          <header>
            <div><h2>Dirette e indirette</h2><p>Composizione delle relazioni nella rilevazione, non quote di capitale aggregate.</p></div>
            <span>{directShare.toLocaleString("it-IT", { maximumFractionDigits: 1 })}% dirette</span>
          </header>
          <div className={styles.compositionBar} aria-hidden="true"><i style={{ width: `${directShare}%` }} /></div>
          <div className={styles.legend}>
            <span><i /> Dirette · {number.format(snapshot.totals.directParticipationRecords)}</span>
            <span><i /> Indirette · {number.format(snapshot.totals.indirectParticipationRecords)}</span>
          </div>
        </article>

        <aside className={styles.evidence}>
          <HugeiconsIcon icon={LegalDocument01Icon} size={24} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <h2>Indicazioni dichiarate, non sentenze</h2>
            <p>{snapshot.declaredEvidence.legalMeaning}</p>
            <dl>
              <div><dt>Controllo analogo dichiarato</dt><dd>{number.format(snapshot.declaredEvidence.analogControlRecords)}</dd></div>
              <div><dt>Affidamento diretto dichiarato</dt><dd>{number.format(snapshot.declaredEvidence.directAwardRecords)}</dd></div>
              <div><dt>Entrambi i segnali</dt><dd>{number.format(snapshot.declaredEvidence.bothSignalsRecords)}</dd></div>
            </dl>
          </div>
        </aside>
      </section>

      <section className={styles.ranking} aria-labelledby="partecipate-diffuse">
        <header>
          <div>
            <h2 id="partecipate-diffuse">Organizzazioni dichiarate da più amministrazioni</h2>
            <p>Conteggio delle amministrazioni con una relazione nel CSV MEF {snapshot.referenceYear}; non misura valore, qualità o controllo.</p>
          </div>
          <HugeiconsIcon icon={Building06Icon} size={24} strokeWidth={1.5} aria-hidden="true" />
        </header>
        <div className={styles.rows}>
          {snapshot.topCompaniesByDeclaringAdministrations.map((company, index) => (
            <article key={company.taxCode}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{company.name}</strong><code>CF {company.taxCode}</code></div>
              <b>{number.format(company.declaringAdministrations)} <small>amministrazioni</small></b>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.provenance}>
        <HugeiconsIcon icon={Database02Icon} size={23} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <h2>Da dove arrivano i dati</h2>
          <dl>
            <div><dt>Data del dato</dt><dd>{formatDate(snapshot.referenceDate)}</dd></div>
            <div><dt>Pubblicato dal MEF</dt><dd>{formatDate(snapshot.publishedAt)}</dd></div>
            <div><dt>Scaricato da noi</dt><dd>{formatDate(snapshot.generatedAt)}</dd></div>
            <div><dt>Formato del testo</dt><dd>{snapshot.source.detectedEncoding}</dd></div>
            <div><dt>Licenza</dt><dd>{snapshot.source.license}</dd></div>
            <div><dt>SHA-256 originale</dt><dd><code>{snapshot.source.rawSha256}</code></dd></div>
          </dl>
          <a href={snapshot.source.assetUrl} target="_blank" rel="noreferrer">Scarica il CSV originale <span>↗</span></a>
        </div>
      </section>
    </main>
  );
}
