import type { Metadata } from "next";
import Link from "next/link";
import type { SourceHealth } from "@/lib/data/source-health";
import { getCachedSourceHealthOverview } from "@/lib/data/cached-live-views";
import styles from "./stato.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stato delle fonti",
  description:
    "Disponibilità e aggiornamento delle fonti ufficiali collegate a DoveVannoINostriSoldi.",
};

const numberFormatter = new Intl.NumberFormat("it-IT", { useGrouping: "always" });
const dateFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

function duration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} g`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

function sourceAge(seconds: number | null): string {
  if (seconds === null) return "età non disponibile";
  if (seconds < 3_600) return `${Math.max(0, Math.floor(seconds / 60))} min fa`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} h fa`;
  return `${Math.floor(seconds / 86_400)} g fa`;
}

function sourceDate(value: string | null): string {
  if (!value) return "timestamp non disponibile";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function reachabilityLabel(source: SourceHealth): string {
  if (source.reachability === "up") return "Raggiungibile";
  if (source.reachability === "down") return "Non raggiungibile";
  return "Non ancora controllato";
}

function reachabilityClass(source: SourceHealth): string {
  if (source.reachability === "up") return styles.up;
  if (source.reachability === "down") return styles.down;
  return styles.notProbed;
}

function freshnessLabel(source: SourceHealth): string {
  if (source.freshness.state === "fresh") return "Nei tempi attesi";
  if (source.freshness.state === "stale") return "Aggiornamento atteso";
  return "Data non valutabile";
}

function freshnessClass(source: SourceHealth): string {
  if (source.freshness.state === "fresh") return styles.fresh;
  if (source.freshness.state === "stale") return styles.stale;
  return styles.unknown;
}

export default async function SourceStatusPage() {
  const { checkedAt, sources } = await getCachedSourceHealthOverview();
  const active = sources.filter((source) => source.integration === "active");
  const reachable = sources.filter((source) => source.reachability === "up");
  const unreachable = sources.filter((source) => source.reachability === "down");

  return (
    <main className={`shell ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <Link href="/fonti">Fonti</Link>
        <span>→</span>
        <span>Stato</span>
      </nav>

      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>STATO DELLE FONTI</span>
          <h1 className={styles.title}>Quando sono stati aggiornati i dati.</h1>
          <p className={styles.lead}>
            Mostriamo tre cose diverse: se abbiamo collegato la fonte, come risultava all&apos;ultimo
            controllo e a quando risale il dato. Un sito temporaneamente irraggiungibile non rende
            falso l&apos;ultimo dato già acquisito.
          </p>
        </div>

        <div className={styles.summary} aria-label="Riepilogo stato fonti">
          <div>
            <strong>{sources.length}</strong>
            <span>fonti controllate</span>
          </div>
          <div>
            <strong>{active.length}</strong>
            <span>fonti collegate</span>
          </div>
          <div>
            <strong>{reachable.length}</strong>
            <span>raggiungibili all&apos;ultimo controllo</span>
          </div>
          <div>
            <strong>{unreachable.length}</strong>
            <span>controlli non riusciti</span>
          </div>
        </div>
      </header>

      <p className={styles.footerNote}>Ultimo controllo delle fonti: {sourceDate(checkedAt)}.</p>

      <section className={styles.explainer}>
        <div>
          <h2>Controllare spesso non rende il dato in tempo reale.</h2>
          <p>
            Se IPA aggiorna ogni giorno, possiamo ricontrollarlo ogni ora. Se una fonte è mensile,
            controllarlo più volte al giorno ci aiuta a trovare presto il nuovo rilascio,
            ma il dato resta mensile.
          </p>
        </div>
        <div>
          <h2>Disponibilità e aggiornamento sono cose diverse.</h2>
          <p>
            Una fonte può rispondere ma avere dati vecchi, oppure essere momentaneamente offline
            mentre l&apos;ultimo dato acquisito è ancora valido. Se non abbiamo abbastanza informazioni,
            lo diciamo senza inventare un semaforo.
          </p>
        </div>
      </section>

      <section className={styles.table} aria-label="Stato delle fonti ufficiali">
        <div className={styles.tableHeader}>
          <span>Fonte</span>
          <span>Collegamento</span>
          <span>Ultimo controllo</span>
          <span>Data del dato</span>
        </div>

        {sources.map((source) => (
          <article className={styles.row} key={source.sourceId}>
            <div className={styles.source}>
              <strong>{source.label}</strong>
              <span>{source.owner}</span>
              <a href={source.policy.sourceUrl} target="_blank" rel="noreferrer">
                apri fonte ufficiale ↗
              </a>
            </div>

            <div className={styles.meta}>
              <strong>Collegata</strong>
              <span>Cadenza: {source.policy.cadence}</span>
              <span>Cerchiamo nuovi dati ogni {duration(source.policy.discoveryRevalidateSeconds)}</span>
            </div>

            <div className={styles.health}>
              <span className={`${styles.status} ${reachabilityClass(source)}`}>
                {reachabilityLabel(source)}
              </span>
              <strong>
                {source.latencyMs !== null ? `${numberFormatter.format(source.latencyMs)} ms` : "Non disponibile"}
              </strong>
              <span>{source.detail ?? "Nessun dettaglio disponibile"}</span>
              {source.recordCount !== null && (
                <span>{numberFormatter.format(source.recordCount)} elementi rilevati dal controllo</span>
              )}
            </div>

            <div className={styles.policy}>
              <span className={`${styles.status} ${freshnessClass(source)}`}>
                {freshnessLabel(source)}
              </span>
              <strong>{sourceDate(source.freshness.sourceTimestamp)}</strong>
              <span>{sourceAge(source.freshness.ageSeconds)}</span>
              <span>dati ricontrollati ogni {duration(source.policy.dataRevalidateSeconds)}</span>
              <span>{source.policy.cadenceNote}</span>
            </div>
          </article>
        ))}
      </section>

      <p className={styles.footerNote}>
        “Non ancora controllato” non significa che il sito ufficiale sia offline. “Data non valutabile”
        non significa che il dato sia vecchio. Significa che non abbiamo abbastanza informazioni.
        Preferiamo lasciare un dubbio visibile invece di inventare una certezza.
      </p>
    </main>
  );
}
