import Link from "next/link";
import { InfoTooltip } from "@/components/info-tooltip";
import { PeriodSelector } from "@/components/period-selector";
import { getHomeAnomalySignals, type AuditSignal } from "@/lib/audit-data";
import { billions, compactEuro, exactEuro, percent } from "@/lib/format";
import { buildHomeItalyFunnel } from "@/lib/home-italy-funnel";
import { eurostatCofogData } from "@/lib/eurostat-cofog-snapshot";
import styles from "./home.module.css";

const HOME_ANOMALY_PRESENTATION = {
  "procurement-direct-awards-2025": {
    title: "Affidamenti diretti",
    period: "2025 · procedure da 40.000 € in su",
  },
  "gdf-public-spending-fraud": {
    title: "Frodi accertate nei controlli",
    period: "dal 1 gen 2025 al 31 mag 2026",
  },
  "pnrr-beyond-2026": {
    title: "Risorse PNRR oltre il 2026",
    period: "Previsione · febbraio 2026",
  },
} as const;

function anomalyValue(signal: AuditSignal): string {
  let formatted: string;
  if (signal.unit === "percent") {
    formatted = percent(signal.value);
  } else if (signal.unit === "billion-euro") {
    formatted = `${signal.value.toLocaleString("it-IT", {
      maximumFractionDigits: 1,
    })} mld €`;
  } else if (signal.unit === "million-euro") {
    formatted = `${signal.value.toLocaleString("it-IT", {
      maximumFractionDigits: 1,
    })} mln €`;
  } else {
    formatted = signal.value.toLocaleString("it-IT");
  }

  if (signal.valueQualifier === "over") return `oltre ${formatted}`;
  if (signal.valueQualifier === "about") return `circa ${formatted}`;
  return formatted;
}

function selectedYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  const { from, to } = eurostatCofogData.period;
  return Number.isSafeInteger(parsed) && parsed >= from && parsed <= to ? parsed : to;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[] }>;
}) {
  const year = selectedYear((await searchParams).anno);
  const funnel = buildHomeItalyFunnel(year);
  const anomalySignals = getHomeAnomalySignals();
  const maxPaShare = Math.max(...funnel.pa.slices.map((slice) => slice.sharePercent), 0);
  const maxStateShare = Math.max(...funnel.state.slices.map((slice) => slice.sharePercent), 0);

  return (
    <main className={`shell ${styles.funnel}`}>
      <h1 className={styles.pageTitle}>Dove vanno i nostri soldi pubblici</h1>

      <header className={styles.intro}>
        <p className={styles.eyebrow}>Italia · big picture</p>
        <p className={styles.lede}>
          Prima la spesa pubblica nel complesso, poi il bilancio dello Stato, poi i livelli più
          vicini. Fonti e nature di denaro restano distinte: non si sommano fra loro.
        </p>
        <PeriodSelector
          activeYear={funnel.pa.year}
          years={[...funnel.pa.availableYears]}
          pathname="/"
          label="Anno della spesa pubblica (Eurostat COFOG)"
        />
      </header>

      <section className={`panel ${styles.heroPanel}`} aria-labelledby="pa-total-title">
        <div className={styles.panelHead}>
          <h2 id="pa-total-title" className="panel-title">
            Spesa pubblica totale
          </h2>
          <InfoTooltip id="pa-sec-tip" label="Che tipo di soldi sono?">
            Competenza economica SEC 2010 sulle amministrazioni pubbliche (Stato, Regioni, Comuni,
            enti). Non è un pagamento di cassa e non è solo il bilancio dello Stato.
          </InfoTooltip>
        </div>
        <p className={styles.heroValue}>{billions(funnel.pa.totalEuro)} mld €</p>
        <p className={styles.heroNote}>
          Italia {funnel.pa.year} · {exactEuro(funnel.pa.totalEuro)} · {percent(funnel.pa.gdpSharePercent)} del PIL
        </p>
        <p className={styles.nature}>{funnel.pa.moneyNature}</p>
      </section>

      <section className={`panel ${styles.compositionPanel}`} aria-labelledby="pa-split-title">
        <div className={styles.panelHead}>
          <h2 id="pa-split-title" className="panel-title">
            Dove va, in grandi voci
          </h2>
        </div>
        <p className={styles.lead}>
          Quote sul totale Eurostat. Le etichette sono in linguaggio quotidiano; sotto ogni barra
          resta il perimetro ufficiale.
        </p>
        <ol className={styles.bars} aria-label={`Composizione spesa pubblica Italia ${funnel.pa.year}`}>
          {funnel.pa.slices.map((slice) => (
            <li key={slice.id}>
              <div className={styles.barMeta}>
                <span>
                  {slice.href ? <Link href={slice.href}>{slice.label}</Link> : slice.label}
                  {slice.note ? (
                    <small className={styles.barNote}>{slice.note}</small>
                  ) : null}
                </span>
                <strong>
                  {exactEuro(slice.amountEuro)}
                  <small> · {percent(slice.sharePercent)}</small>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i style={{ width: `${maxPaShare > 0 ? (slice.sharePercent / maxPaShare) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.sourceLine}>
          Fonte:{" "}
          <a href={funnel.pa.source.href} target="_blank" rel="noreferrer">
            {funnel.pa.source.label}
          </a>
          {" · "}
          pubblicato {funnel.pa.source.observedAt}
        </p>
      </section>

      <section className={`panel ${styles.statePanel}`} aria-labelledby="state-title">
        <div className={styles.panelHead}>
          <h2 id="state-title" className="panel-title">
            Di cui bilancio dello Stato
          </h2>
          <InfoTooltip id="state-lb-tip" label="Perché non è lo stesso totale?">
            Qui leggiamo gli stanziamenti della Legge di Bilancio (competenza), non la spesa PA
            Eurostat. Sono due racconti ufficiali diversi sullo stesso Paese.
          </InfoTooltip>
        </div>
        <p className={styles.lead}>
          Anno {funnel.state.year}: {exactEuro(funnel.state.totalWithoutDebtEuro)} di stanziamenti
          senza la missione Debito pubblico ({exactEuro(funnel.state.debtEuro)} esclusi dalle barre).
        </p>
        <p className={styles.nature}>{funnel.state.moneyNature}</p>
        <ol className={styles.bars} aria-label={`Missioni Legge di Bilancio ${funnel.state.year} senza debito`}>
          {funnel.state.slices.map((slice) => (
            <li key={slice.id}>
              <div className={styles.barMeta}>
                <span>
                  {slice.href ? <Link href={slice.href}>{slice.label}</Link> : slice.label}
                  {slice.note ? (
                    <small className={styles.barNote}>{slice.note}</small>
                  ) : null}
                </span>
                <strong>
                  {exactEuro(slice.amountEuro)}
                  <small> · {percent(slice.sharePercent)}</small>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i
                  style={{
                    width: `${maxStateShare > 0 ? (slice.sharePercent / maxStateShare) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.caveat}>{funnel.state.caveat}</p>
        <p className={styles.sourceLine}>
          Fonte:{" "}
          <Link href={funnel.state.source.href}>{funnel.state.source.label}</Link>
          {" · "}
          osservato {funnel.state.source.observedAt}
          {" · "}
          <Link href="/stato">Pagamenti di cassa dello Stato</Link>
        </p>
      </section>

      <section className={styles.doors} aria-labelledby="doors-title">
        <h2 id="doors-title" className="panel-title">
          Scendi nel dettaglio
        </h2>
        <div className={styles.doorGrid}>
          <article className="panel">
            <h3>
              <Link href="/spese/pensioni">Pensioni</Link>
            </h3>
            <p>Casellario e stock INPS: chi riceve cosa, oltre la voce «protezione sociale».</p>
          </article>
          <article className="panel">
            <h3>
              <Link href="/spese/sanita">Sanità</Link>
            </h3>
            <p>Costi del SSN e storico: perimetro diverso dalla missione «Tutela della salute».</p>
          </article>
          <article className="panel">
            <h3>
              <Link href="/debito">Debito</Link>
            </h3>
            <p>Stock, scadenze e interessi: non confonderli con i rimborsi in Legge di Bilancio.</p>
          </article>
          <article className="panel">
            <h3>
              <Link href={funnel.comuni.href}>Comuni</Link>
            </h3>
            <p>
              {compactEuro(funnel.comuni.totalEuro)} di cassa SIOPE da gennaio a{" "}
              {funnel.comuni.latestMonthLabel.toLocaleLowerCase("it-IT")} {funnel.comuni.year}.{" "}
              {funnel.comuni.moneyNature}
            </p>
          </article>
        </div>
      </section>

      <section className={`panel ${styles.anomaliesPanel}`} aria-labelledby="anomalies-title">
        <div className={styles.panelHead}>
          <h2 id="anomalies-title" className="panel-title">
            Anomalie da approfondire
          </h2>
          <Link href="/controlli">Tutti i controlli</Link>
        </div>
        {anomalySignals.length < 3 ? (
          <p className={styles.note}>
            Alcuni segnali non sono disponibili in questo rilascio.{" "}
            <Link href="/controlli">Esplora gli altri controlli</Link>.
          </p>
        ) : (
          <ul className={styles.anomalyGallery}>
            {anomalySignals.map((signal) => {
              const presentation = HOME_ANOMALY_PRESENTATION[signal.id as keyof typeof HOME_ANOMALY_PRESENTATION];
              return (
                <li key={signal.id} className={styles.anomalyItem} data-signal={signal.id}>
                  <p className={styles.anomalyEyebrow}>{presentation?.period ?? signal.coverage}</p>
                  <strong>{presentation?.title ?? signal.label}</strong>
                  <p className={styles.anomalyValue}>{anomalyValue(signal)}</p>
                  <p className={styles.note}>{signal.plainMeaning}</p>
                  <p className={styles.sourceLine}>
                    <a
                      href={signal.source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Fonte ${signal.source.institution}: ${signal.source.title}`}
                    >
                      {signal.source.institution}
                    </a>
                    {" · "}
                    Segnale da verificare, non prova
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className={styles.readingPanel} aria-labelledby="reading-title">
        <h2 id="reading-title" className="panel-title">
          Come leggere questi numeri
        </h2>
        <ul className={styles.readingRules}>
          {funnel.pa.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
          <li>
            Per dati più recenti sullo Stato usa Legge di Bilancio e pagamenti OpenBDAP: Eurostat
            COFOG per l’Italia si ferma al {eurostatCofogData.period.to}.
          </li>
        </ul>
        <Link className={styles.readingLink} href="/metodologia">
          Come leggiamo i dati →
        </Link>
      </aside>
    </main>
  );
}
