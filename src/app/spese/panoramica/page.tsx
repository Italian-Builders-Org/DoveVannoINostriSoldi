import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HomeItalyCompositionChart, HomeItalyTrendChart } from "@/components/home-italy-charts";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { PeriodSelector } from "@/components/period-selector";
import { SpendingComposition, type CompositionFamily } from "@/components/spending-composition";
import { eurostatCofogData } from "@/lib/eurostat-cofog-snapshot";
import {
  billions,
  compactEuro,
  exactEuro,
  longDate,
  percent,
} from "@/lib/format";
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
  settledNationalPerCapita,
  settledTotalPaid,
} from "@/lib/siope-snapshot";
import styles from "./panoramica.module.css";

export const metadata: Metadata = {
  title: "Spesa pubblica",
  description: "Spesa della pubblica amministrazione, pagamenti dei Comuni e confronti regionali, con fonti e anni di riferimento.",
};

const COMPOSITION_FAMILIES: CompositionFamily[] = [
  "services",
  "investment",
  "pass-through",
  "financing",
  "other",
];

function selectedSiopeYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

function selectedPaYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  const { from, to } = eurostatCofogData.period;
  return Number.isSafeInteger(parsed) && parsed >= from && parsed <= to ? parsed : to;
}

export default async function SpendingOverviewPage({
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
  const settledTotal = settledTotalPaid(siope);
  const settledPerCapita = settledNationalPerCapita(siope);
  const partialSuffix = runningMonth === null ? "" : " (parziale)";
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

  return (
    <main className={`shell ${styles.hub}`} data-spending-page="true">
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Spesa pubblica</h1>
        <p className={styles.lead}>La spesa della pubblica amministrazione e i pagamenti dei Comuni, con i rispettivi periodi e criteri di misura.</p>
      </header>
      <section className={styles.italyBand} aria-labelledby="italy-band-title">
        <div className={styles.sectionHeading}>
          <div>
            <div className={styles.headingWithTooltip}>
              <h2 id="italy-band-title" className="panel-title">
                Spesa pubblica totale
              </h2>
              <InfoTooltip id="pa-sec-tip" label="Che tipo di soldi sono?">
                Competenza economica SEC 2010 sulle amministrazioni pubbliche (Stato, Regioni,
                Comuni, enti). Non è un pagamento di cassa e non è solo il bilancio dello Stato.
              </InfoTooltip>
            </div>
            <p className={styles.sectionNote}>Competenza economica · tutte le amministrazioni pubbliche</p>
          </div>
            <PeriodSelector
              activeYear={funnel.pa.year}
              years={[...funnel.pa.availableYears]}
              pathname="/spese/panoramica"
              query={yearQuery}
              yearParam="anno"
              recentLimit={4}
              label="Anno della spesa pubblica (Eurostat COFOG)"
              className={styles.periodSelector}
            />
        </div>
        <div className={styles.italySplit}>
        <section className={`panel ${styles.italySummary}`}>
          <div className={styles.italySummaryBody}>
            <div className={styles.italySummaryFacts}>
              <p className={styles.freshness}>
                <i aria-hidden="true" />
                Eurostat COFOG · {funnel.pa.year}
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
              </dl>
            </div>
            <HomeItalyTrendChart points={funnel.pa.trend} selectedYear={funnel.pa.year} />
          </div>

        </section>
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

        </div>
        <aside className={styles.stateSummary} aria-labelledby="state-budget-title">
          <div>
            <h3 id="state-budget-title">Bilancio dello Stato · {funnel.state.year}</h3>
            <p className={styles.note}>Stanziamenti della Legge di Bilancio.</p>
          </div>
          <dl className={styles.factRows}>
                <div>
                  <dt>Stanziamenti senza debito</dt>
                  <dd>{billions(funnel.state.totalWithoutDebtEuro)} mld €</dd>
                </div>
                <div>
                  <dt>Stanziamenti per il debito</dt>
                  <dd>{billions(funnel.state.debtEuro)} mld €</dd>
                </div>
          </dl>
          <Link prefetch={false} className={styles.inlineLink} href="/spese/legge-di-bilancio">
            Legge di Bilancio
            <HugeiconsIcon icon={ArrowRight01Icon} data-link-arrow="true" size={16} aria-hidden="true" />
          </Link>
        </aside>
      </section>

      <section className={styles.italyBand} aria-labelledby="cash-title">
        <div className={styles.sectionHeading}>
          <div>
              <div className={styles.headingWithTooltip}>
                <h2 id="cash-title" className="panel-title">
                  Pagamenti effettuati dai Comuni
                </h2>
                <InfoTooltip id="cash-payments-tip" label="Che cosa sono i pagamenti di cassa?">
                  Uscite di cassa registrate dai Comuni, mese per mese. Il totale riguarda i Comuni;
                  restano fuori Stato centrale, Regioni e sanità.
                </InfoTooltip>
              </div>
            <p className={styles.sectionNote}>Cassa · uscite registrate dai Comuni</p>
          </div>
              <PeriodSelector
                activeYear={year}
                years={availableSiopeYears}
                pathname="/spese/panoramica"
                query={yearQuery}
                yearParam="comuni"
                label="Anno dei pagamenti SIOPE dei Comuni"
                className={styles.periodSelector}
              />
        </div>
        <div className={styles.italySplit}>
          <section className={`panel ${styles.italyChartPanel}`}>
            <p className={styles.freshness}>
              <i aria-hidden="true" />
              Aggiornati al {longDate(siope.source.siopeMovementsLastModified)}
            </p>
            <strong className={styles.headline}>{compactEuro(settledTotal ?? siope.totalPaid)}</strong>
            <p className={styles.headlineNote}>
              {runningMonth !== null && lastCompleted
                ? `Da gennaio a ${lastCompleted.label.toLocaleLowerCase("it-IT")} ${siope.year}, in tutta Italia. ${siope.latestMonthLabel}, ancora parziale, è escluso.`
                : `Da gennaio a ${monthLabel} ${siope.year}, in tutta Italia${partialSuffix}`}
            </p>
            <dl className={styles.factRows}>
              <div>
                <dt>In media per abitante</dt>
                <dd>
                  {settledPerCapita !== null
                    ? exactEuro(settledPerCapita)
                    : siope.nationalPerCapita === null
                      ? "Non disponibile"
                      : `${exactEuro(siope.nationalPerCapita)}${partialSuffix}`}
                </dd>
              </div>
              <div>
                <dt>Al netto delle partite di giro</dt>
                <dd>{compactEuro(netPayments)}{partialSuffix}</dd>
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
            <Link prefetch={false} className={`btn btn-block ${styles.detailLink}`} href={`/spese?anno=${year}`}>
              Dettaglio delle spese
            </Link>
          </section>
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
        </div>
      <section className={`panel ${styles.mapPanel}`} aria-labelledby="regional-map-panel-title">
        <div className={styles.mapStage}>
          <ItalyRegionsMap
            heading="Pagamenti dei Comuni per regione"
            headingId="regional-map-panel-title"
            periodSelector={null}
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
                    <Link prefetch={false} href={`/territori?anno=${year}`}>Apri Territori</Link>
                  </small>
                </div>
              </div>
            }
          />
        </div>
      </section>

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
            <dd>Stanziamenti Legge di Bilancio, missione Debito indicata separatamente</dd>
          </div>
          <div>
            <dt>Comuni</dt>
            <dd>Pagamenti di cassa SIOPE; per abitante = importo / popolazione</dd>
          </div>
        </dl>
        <p className={styles.readingMore}>
          <Link prefetch={false} href="/metodologia">Come leggiamo i dati</Link>
        </p>
      </aside>
    </main>
  );
}
