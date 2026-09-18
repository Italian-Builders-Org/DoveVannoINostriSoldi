import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HomeItalyCompositionChart, HomeItalyTrendChart } from "@/components/home-italy-charts";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { PeriodSelector } from "@/components/period-selector";
import { SpendingComposition, type CompositionFamily } from "@/components/spending-composition";
import { getHomeAnomalySignals, type AuditSignal } from "@/lib/audit-data";
import { eurostatCofogData } from "@/lib/eurostat-cofog-snapshot";
import {
  billions,
  compactEuro,
  exactEuro,
  integer,
  longDate,
  percent,
} from "@/lib/format";
import {
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
} from "@/lib/global-search-contract";
import { buildHomeItalyFunnel } from "@/lib/home-italy-funnel";
import {
  HOME_SPENDING_BUCKETS,
  PASS_THROUGH_TITLE_CODE,
} from "@/lib/siope-titles";
import {
  availableSiopeYears,
  completedMonths,
  getSiopeMunicipalSnapshot,
  partialMonth,
} from "@/lib/siope-snapshot";
import { PUBLIC_POLITICI_URL } from "@/lib/site";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: {
    absolute: "DoveVannoINostriSoldi",
  },
  description:
    "Spesa pubblica, imprese e territori: dati ufficiali italiani con fonti e perimetri espliciti.",
};

const COMPOSITION_FAMILIES: CompositionFamily[] = [
  "services",
  "investment",
  "pass-through",
  "financing",
  "other",
];

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

type Destination = Readonly<{
  href: string;
  title: string;
  description: string;
}>;

const PRIMARY_DESTINATIONS: readonly Destination[] = [
  {
    href: "/imprese",
    title: "Atlante Imprese Italia",
    description: "Imprese attive, addetti e valore della produzione per regione.",
  },
  {
    href: "/territori",
    title: "Territori",
    description: "Pagamenti dei Comuni per abitante, per km² e confronti.",
  },
  {
    href: "/spese",
    title: "Soldi",
    description: "Pagamenti comunali, sanità, pensioni e bilancio dello Stato.",
  },
  {
    href: PUBLIC_POLITICI_URL,
    title: "Mappa della politica",
    description: "Presidenza, Governo, Camera e Senato: chi c’è e come si collega.",
  },
];

const SECONDARY_DESTINATIONS: readonly Destination[] = [
  {
    href: "/istruzione",
    title: "Atlante Istruzione",
    description: "Scuola, università e ricerca sul territorio.",
  },
  {
    href: "/territori/irpef",
    title: "Redditi e IRPEF",
    description: "Reddito e imposta netta dichiarata per territorio.",
  },
  {
    href: "/coesione",
    title: "Fondi e progetti",
    description: "Coesione, PNRR e progetti con fondi pubblici.",
  },
  {
    href: "/territori/confronto",
    title: "Spesa e fabbisogno dei Comuni",
    description: "Confronto tra Comuni su spesa e fabbisogno.",
  },
  {
    href: "/mcp",
    title: "MCP per i dati pubblici",
    description: "Catalogo per interrogare i dataset ufficiali.",
  },
  {
    href: "/cerca",
    title: "Cerca nel sito",
    description: "Pagine, dataset, enti e strumenti.",
  },
];

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
    formatted = integer(signal.value);
  }

  if (signal.valueQualifier === "over") return `oltre ${formatted}`;
  if (signal.valueQualifier === "about") return `circa ${formatted}`;
  return formatted;
}

function selectedSiopeYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

function selectedPaYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  const { from, to } = eurostatCofogData.period;
  return Number.isSafeInteger(parsed) && parsed >= from && parsed <= to ? parsed : to;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[]; comuni?: string | string[] }>;
}) {
  const params = await searchParams;
  const paYear = selectedPaYear(params.anno);
  const year = selectedSiopeYear(params.comuni ?? params.anno);
  const funnel = buildHomeItalyFunnel(paYear);
  const yearQuery = {
    anno: String(paYear),
    comuni: String(year),
  };
  const siope = getSiopeMunicipalSnapshot(year);
  const monthLabel = siope.latestMonthLabel.toLocaleLowerCase("it-IT");
  const period = `da gennaio a ${monthLabel} ${siope.year}`;
  const passThrough =
    siope.titles.find((title) => title.code === PASS_THROUGH_TITLE_CODE)?.value ?? 0;
  const netPayments = siope.totalPaid - passThrough;
  const settledMonths = completedMonths(siope);
  const lastCompleted = settledMonths[settledMonths.length - 1] ?? null;
  const runningMonth = partialMonth(siope);
  const maxFlow = Math.max(...siope.monthly.map((point) => point.flow), 0);
  const valueByCode = new Map(siope.titles.map((title) => [title.code, title.value]));
  const buckets = HOME_SPENDING_BUCKETS.map((bucket, index) => {
    const value = bucket.codes.reduce((sum, code) => sum + (valueByCode.get(code) ?? 0), 0);
    return {
      ...bucket,
      id: bucket.codes.join("-"),
      value,
      family: COMPOSITION_FAMILIES[index],
    };
  });
  const anomalySignals = getHomeAnomalySignals();

  return (
    <main className={`shell ${styles.hub}`}>
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Dove vanno i nostri soldi pubblici</h1>
        <p className={styles.lead}>
          Spesa pubblica, imprese e territori dai dati ufficiali.
        </p>

        <form className={styles.searchForm} action="/cerca" method="get" role="search">
          <label className={styles.searchLabel} htmlFor="home-search-query">
            Cerca nel sito
          </label>
          <div className={styles.searchRow}>
            <input
              className={`input ${styles.searchInput}`}
              id="home-search-query"
              name="q"
              type="search"
              minLength={GLOBAL_SEARCH_MIN_QUERY_LENGTH}
              maxLength={GLOBAL_SEARCH_MAX_QUERY_LENGTH}
              placeholder="es. pagamenti comuni, PNRR o Ministero dell’Interno"
              autoComplete="off"
            />
            <button className="btn btn-primary" type="submit">
              <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.7} aria-hidden="true" />
              Cerca
            </button>
          </div>
        </form>
      </header>

      <section className={styles.exploreSection} aria-labelledby="explore-title">
        <h2 id="explore-title" className={styles.sectionTitle}>
          Sezioni
        </h2>
        <ul className={styles.primaryGrid}>
          {PRIMARY_DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <Link className={styles.primaryCard} href={destination.href}>
                <span className={styles.cardTitle}>{destination.title}</span>
                <span className={styles.cardCopy}>{destination.description}</span>
                <span className={styles.cardCta}>
                  Apri
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <ul className={styles.secondaryGrid}>
          {SECONDARY_DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <Link className={styles.secondaryCard} href={destination.href}>
                <span className={styles.cardTitle}>{destination.title}</span>
                <span className={styles.cardCopy}>{destination.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.italyBand} aria-labelledby="italy-band-title">
        <section className={`panel ${styles.italySummary}`}>
          <div className={styles.panelHead}>
            <div className={styles.headingWithTooltip}>
              <h2 id="italy-band-title" className="panel-title">
                Spesa pubblica totale
              </h2>
              <InfoTooltip id="pa-sec-tip" label="Che tipo di soldi sono?">
                Competenza economica SEC 2010 sulle amministrazioni pubbliche (Stato, Regioni,
                Comuni, enti). Non è un pagamento di cassa e non è solo il bilancio dello Stato.
              </InfoTooltip>
            </div>
            <Link className={styles.inlineLink} href="/spese">
              Soldi
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className={styles.italySummaryBody}>
            <div className={styles.italySummaryFacts}>
              <p className={styles.freshness}>
                <i aria-hidden="true" />
                Eurostat COFOG Italia: snapshot fino al {eurostatCofogData.period.to}
              </p>
              <strong className={styles.headline}>{billions(funnel.pa.totalEuro)} mld €</strong>
              <p className={styles.headlineNote}>
                Italia {funnel.pa.year}, tutta la pubblica amministrazione
              </p>
              <dl className={styles.factRows}>
                <div>
                  <dt>Quota del PIL</dt>
                  <dd>{percent(funnel.pa.gdpSharePercent)}</dd>
                </div>
                <div>
                  <dt>Bilancio dello Stato</dt>
                  <dd>{billions(funnel.state.totalWithoutDebtEuro)} mld €</dd>
                </div>
                <div>
                  <dt>Debito escluso dalle barre</dt>
                  <dd>{billions(funnel.state.debtEuro)} mld €</dd>
                </div>
              </dl>
            </div>
            <HomeItalyTrendChart points={funnel.pa.trend} selectedYear={funnel.pa.year} />
          </div>

          <div className={styles.italySummaryPeriod}>
            <PeriodSelector
              activeYear={funnel.pa.year}
              years={[...funnel.pa.availableYears]}
              pathname="/"
              query={yearQuery}
              yearParam="anno"
              recentLimit={4}
              label="Anno della spesa pubblica (Eurostat COFOG)"
              className={styles.periodSelector}
            />
          </div>
        </section>

        <div className={styles.italySplit}>
          <section className={`panel ${styles.italyChartPanel}`} aria-labelledby="pa-split-title">
            <div className={styles.panelHead}>
              <h3 id="pa-split-title" className="panel-title">
                Dove va, in grandi voci
              </h3>
              <span className={styles.headNote}>Eurostat COFOG · {funnel.pa.year}</span>
            </div>
            <HomeItalyCompositionChart
              slices={funnel.pa.slices}
              ariaLabel={`Composizione spesa pubblica Italia ${funnel.pa.year}`}
            />
            <p className={styles.attribution}>
              Fonte:{" "}
              <a href={funnel.pa.source.href} target="_blank" rel="noreferrer">
                {funnel.pa.source.label}
              </a>
              {" · "}
              pubblicato {funnel.pa.source.observedAt}
            </p>
          </section>

          <section className={`panel ${styles.italyChartPanel}`} aria-labelledby="cash-title">
            <div className={styles.panelHead}>
              <div className={styles.headingWithTooltip}>
                <h3 id="cash-title" className="panel-title">
                  Pagamenti effettuati dai Comuni
                </h3>
                <InfoTooltip id="cash-payments-tip" label="Che cosa sono i pagamenti di cassa?">
                  Uscite di cassa registrate dai Comuni, mese per mese. Il totale riguarda i Comuni;
                  restano fuori Stato centrale, Regioni e sanità.
                </InfoTooltip>
              </div>
            </div>
            <p className={styles.freshness}>
              <i aria-hidden="true" />
              Aggiornati al {longDate(siope.source.siopeMovementsLastModified)}
            </p>
            <strong className={styles.headline}>{compactEuro(siope.totalPaid)}</strong>
            <p className={styles.headlineNote}>
              Da gennaio a {monthLabel} {siope.year}, in tutta Italia
            </p>
            <dl className={styles.factRows}>
              <div>
                <dt>In media per abitante</dt>
                <dd>
                  {siope.nationalPerCapita === null
                    ? "Non disponibile"
                    : exactEuro(siope.nationalPerCapita)}
                </dd>
              </div>
              <div>
                <dt>Al netto delle partite di giro</dt>
                <dd>{compactEuro(netPayments)}</dd>
              </div>
              <div>
                <dt>Ultimo mese completo</dt>
                <dd>
                  {lastCompleted
                    ? compactEuro(lastCompleted.flow)
                    : "Non disponibile"}
                </dd>
              </div>
            </dl>
            <div className={styles.panelHead}>
              <h3 className="panel-title">Come si compone il totale</h3>
            </div>
            <SpendingComposition
              state={{
                kind: "ready",
                totalEuro: siope.totalPaid,
                items: buckets.map((bucket) => ({
                  id: bucket.id,
                  label: bucket.name,
                  shortLabel: bucket.shortName,
                  valueEuro: bucket.value,
                  explanation: bucket.explanation,
                  family: bucket.family,
                })),
              }}
              period={`Da gennaio a ${siope.latestMonthLabel.toLocaleLowerCase("it-IT")} ${siope.year}`}
              scope="Pagamenti di cassa dei Comuni in tutta Italia"
              denominator="totale dei pagamenti SIOPE dei Comuni nel periodo"
              source={{
                label: "SIOPE · RGS / Banca d’Italia",
                href: siope.source.siopeMovementsUrl,
                observedAt: longDate(siope.source.observedAt),
              }}
            />
            <Link className={`btn btn-block ${styles.detailLink}`} href={`/spese?anno=${year}`}>
              Dettaglio delle spese
            </Link>
          </section>
        </div>

        <section className={`panel ${styles.monthsPanel}`}>
          <div className={styles.panelHead}>
            <h3 className="panel-title">Mese per mese</h3>
            <span className={styles.headNote}>miliardi di €</span>
            <InfoTooltip id="monthly-bars-tip" label="Come si leggono le barre mensili?">
              Ogni barra mostra i pagamenti registrati nel singolo mese, non il totale cumulato.
              Il mese in corso è grigio perché può ancora cambiare.
            </InfoTooltip>
          </div>
          <ul className={styles.monthList}>
            {siope.monthly.map((point) => {
              const running = point.month === runningMonth;
              return (
                <li key={point.month}>
                  <span>{point.label}</span>
                  <i aria-hidden="true">
                    <b
                      className={running ? styles.running : undefined}
                      style={{ width: maxFlow > 0 ? `${(point.flow / maxFlow) * 100}%` : "0%" }}
                    />
                  </i>
                  <b className="num-tabular">{billions(point.flow)}</b>
                </li>
              );
            })}
          </ul>
          {runningMonth === null ? (
            <p className={styles.note}>Anno chiuso: tutti i mesi sono definitivi.</p>
          ) : (
            <p className={styles.note}>
              {siope.latestMonthLabel} è parziale: il dato può cambiare.
            </p>
          )}
        </section>
      </section>

      <section className={`panel ${styles.mapPanel}`} aria-labelledby="regional-map-panel-title">
        <div className={styles.mapStage}>
          <ItalyRegionsMap
            heading="Pagamenti dei Comuni per regione"
            headingId="regional-map-panel-title"
            periodSelector={
              <PeriodSelector
                activeYear={year}
                years={availableSiopeYears}
                pathname="/"
                query={yearQuery}
                yearParam="comuni"
                label="Anno dei pagamenti SIOPE dei Comuni"
                className={styles.periodSelector}
              />
            }
            regions={siope.regions}
            period={period}
            aside={
              <div className={styles.mapStats}>
                <div>
                  <span>Da gennaio a {monthLabel}</span>
                  <strong>{compactEuro(siope.totalPaid)}</strong>
                  <small>
                    Italia · {compactEuro(siope.coverage.paymentsWithoutRegion)} senza regione IPA,
                    esclusi dalla mappa
                  </small>
                </div>
                <div>
                  <span>In media per abitante</span>
                  <strong>
                    {siope.nationalPerCapita === null
                      ? "Non disponibile"
                      : exactEuro(siope.nationalPerCapita)}
                  </strong>
                  <small>
                    <Link href={`/territori?anno=${year}`}>Apri Territori</Link>
                  </small>
                </div>
              </div>
            }
          />
        </div>
      </section>

      <section className={`panel ${styles.anomaliesPanel}`} aria-labelledby="anomalies-title">
        <div className={`${styles.panelHead} ${styles.compactHeader}`}>
          <h2 id="anomalies-title" className="panel-title">
            Anomalie da approfondire
          </h2>
          <Link className={styles.anomaliesLink} href="/controlli">
            Tutti i controlli
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
          </Link>
          <InfoTooltip id="anomalies-tip" label="Che cosa chiamiamo anomalia?">
            Un valore insolito rispetto a enti simili o a una soglia statistica. Da verificare
            con le fonti: non dimostra sprechi o illeciti.
          </InfoTooltip>
        </div>
        <div className={styles.anomalyGallery}>
          {anomalySignals.map((signal) => {
            const presentation =
              HOME_ANOMALY_PRESENTATION[signal.id as keyof typeof HOME_ANOMALY_PRESENTATION];
            if (!presentation) return null;

            return (
              <article
                className={styles.anomalyItem}
                data-signal={signal.id}
                key={signal.id}
              >
                <div className={styles.anomalyItemHead}>
                  <span className={styles.anomalyArea}>{signal.area}</span>
                </div>
                <h3>{presentation.title}</h3>
                <strong className={styles.anomalyValue}>{anomalyValue(signal)}</strong>
                <p className={styles.anomalyMeta}>
                  <span>{presentation.period}</span>
                  <a
                    href={signal.source.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Fonte ${signal.source.institution}: ${signal.source.title}`}
                  >
                    {signal.source.institution} ↗
                  </a>
                </p>
              </article>
            );
          })}
        </div>
        <p className={styles.anomalyCaveat}>Segnale da verificare, non prova.</p>
        {anomalySignals.length < 3 ? (
          <p className={styles.anomalyFallback}>
            Mostriamo solo i segnali con fonte verificata.{" "}
            <Link href="/controlli">Esplora gli altri controlli</Link>.
          </p>
        ) : null}
      </section>

      <aside className={styles.readingPanel} aria-labelledby="reading-title">
        <div className={styles.readingIntro}>
          <h2 id="reading-title" className="panel-title">
            Perimetri diversi
          </h2>
          <p className={styles.readingNote}>
            Spesa PA (Eurostat) e bilancio dello Stato non si sommano alla cassa dei Comuni.
            Nel confronto territoriale considera popolazione e servizi gestiti da ciascun
            Comune.
          </p>
        </div>
        <dl className={styles.readingRules}>
          <div>
            <dt>Spesa PA</dt>
            <dd>Competenza SEC 2010, tutte le pubbliche amministrazioni</dd>
          </div>
          <div>
            <dt>Stato</dt>
            <dd>Stanziamenti Legge di Bilancio, missione Debito esclusa dalle barre</dd>
          </div>
          <div>
            <dt>Comuni</dt>
            <dd>Pagamenti di cassa SIOPE; per abitante = importo / popolazione</dd>
          </div>
        </dl>
        <p className={styles.readingMore}>
          <Link href="/metodologia">Come leggiamo i dati</Link>
        </p>
      </aside>
    </main>
  );
}
