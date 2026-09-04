import Link from "next/link";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { PeriodSelector } from "@/components/period-selector";
import { RegionCrest, RegionCrestAttribution } from "@/components/region-crest";
import { SpendingComposition, type CompositionFamily } from "@/components/spending-composition";
import { getHomeAnomalySignals, type AuditSignal } from "@/lib/audit-data";
import {
  billions,
  compactEuro,
  compactEuroLike,
  exactEuro,
  integer,
  longDate,
  percent,
} from "@/lib/format";
import { municipalityName } from "@/lib/municipality-name";
import { openCoesioneSnapshot as cohesion } from "@/lib/opencoesione-snapshot";
import {
  HOME_SPENDING_BUCKETS,
  PASS_THROUGH_TITLE_CODE,
} from "@/lib/siope-titles";
import { istatCodeOfRegion } from "@/lib/italy-regions";
import {
  availableSiopeYears,
  completedMonths,
  getSiopeMunicipalSnapshot,
  municipalitiesByPerCapita,
  regionsByPerCapita,
  partialMonth,
} from "@/lib/siope-snapshot";
import styles from "./home.module.css";

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

function selectedYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[] }>;
}) {
  const year = selectedYear((await searchParams).anno);
  const siope = getSiopeMunicipalSnapshot(year);
  const monthLabel = siope.latestMonthLabel.toLocaleLowerCase("it-IT");
  const period = `da gennaio a ${monthLabel} ${siope.year}`;

  const passThrough =
    siope.titles.find((title) => title.code === PASS_THROUGH_TITLE_CODE)?.value ?? 0;
  const netPayments = siope.totalPaid - passThrough;

  const runningMonth = partialMonth(siope);
  const settledMonths = completedMonths(siope);
  const completedAverage =
    settledMonths.length > 0
      ? settledMonths.reduce((sum, point) => sum + point.flow, 0) / settledMonths.length
      : 0;
  const lastCompleted = settledMonths[settledMonths.length - 1] ?? null;

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

  const topRegions = regionsByPerCapita(siope).slice(0, 6);
  const topMunicipalities = municipalitiesByPerCapita(siope).slice(0, 5);
  /* One unit for the absolute-value comparison column. */
  const topRegionScale = topRegions[0]?.value ?? 0;
  const maxFlow = Math.max(...siope.monthly.map((point) => point.flow), 0);

  const cohesionForYear = cohesion.annualSeries.find((point) => point.year === year) ?? null;
  const cohesionPaid = (cohesionForYear?.paymentsCents ?? 0) / 100;
  const cohesionCommitted = (cohesionForYear?.commitmentsCents ?? 0) / 100;
  const cohesionRatio =
    cohesionCommitted > 0 ? (cohesionPaid / cohesionCommitted) * 100 : 0;
  const anomalySignals = getHomeAnomalySignals();

  return (
    <main className={`shell ${styles.dashboard}`}>
      <h1 className={styles.pageTitle}>Dove vanno i nostri soldi pubblici</h1>
      <div className={styles.column}>
        <section className="panel">
          <div className={styles.panelHead}>
            <h2 className="panel-title">Pagamenti effettuati dai Comuni</h2>
            <InfoTooltip id="cash-payments-tip" label="Che cosa sono i pagamenti di cassa?">
              Uscite di cassa registrate dai Comuni, mese per mese. Il totale riguarda i Comuni;
              restano fuori Stato centrale, Regioni e sanità.
            </InfoTooltip>
          </div>

          <p className={styles.freshness}>
            <i aria-hidden="true" />
            Dati aggiornati al {longDate(siope.source.siopeMovementsLastModified)}
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
                  ? "n.d."
                  : exactEuro(siope.nationalPerCapita)}
              </dd>
            </div>
            <div>
              <dt>Pagamenti al netto delle partite di giro</dt>
              <dd>{compactEuro(netPayments)}</dd>
            </div>
            <div>
              <dt>Media dei mesi completi</dt>
              <dd>{compactEuro(completedAverage)}</dd>
            </div>
          </dl>

          <hr className={styles.rule} />

          <div className={styles.panelHead}>
            <h2 className="panel-title">Come si compone il totale</h2>
          </div>
          <SpendingComposition
            state={{ kind: "ready", totalEuro: siope.totalPaid, items: buckets.map((bucket) => ({
              id: bucket.id,
              label: bucket.name,
              shortLabel: bucket.shortName,
              valueEuro: bucket.value,
              explanation: bucket.explanation,
              family: bucket.family,
            })) }}
            period={`Da gennaio a ${siope.latestMonthLabel.toLocaleLowerCase("it-IT")} ${siope.year}`}
            scope="Pagamenti di cassa dei Comuni in tutta Italia"
            denominator="totale dei pagamenti SIOPE dei Comuni nel periodo"
            source={{
              label: `${siope.source.siopeOwner} · SIOPE`,
              href: siope.source.siopeMovementsUrl,
              observedAt: longDate(siope.source.observedAt),
            }}
          />
          <Link
            className={`btn btn-block ${styles.spendingDetailsLink}`}
            href={`/spese?anno=${year}`}
          >
            Vedi il dettaglio delle voci
          </Link>
        </section>

        <section className="panel">
          <div className={styles.panelHead}>
            <h2 className="panel-title">Mese per mese</h2>
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
              {siope.latestMonthLabel} è ancora in corso: il numero salirà.
            </p>
          )}
        </section>

      </div>

      <div className={styles.column}>
        <section className={`panel ${styles.mapPanel}`}>
          <div className={styles.panelHead}>
            <h2 className="panel-title">Dove si spende di più, regione per regione</h2>
            <PeriodSelector
              activeYear={year}
              years={availableSiopeYears}
              pathname="/"
              className={styles.periodSelector}
            />
          </div>

          <div className={styles.mapStage}>
          <ItalyRegionsMap
            regions={siope.regions}
            period={period}
            aside={
              <div className={styles.mapStats}>
                <div>
                  <span>Da gennaio a {monthLabel}</span>
                  <strong>{compactEuro(siope.totalPaid)}</strong>
                  <small>
                    totale nazionale dei Comuni · {compactEuro(siope.coverage.paymentsWithoutRegion)}
                    {" "}senza Regione IPA non mappati
                  </small>
                </div>
                <div>
                  <span>Ultimo mese completo</span>
                  <strong>{lastCompleted ? compactEuro(lastCompleted.flow) : "n.d."}</strong>
                  <small>
                    {lastCompleted
                      ? `${lastCompleted.label.toLocaleLowerCase("it-IT")} ${siope.year}`
                      : "nessun mese chiuso"}
                  </small>
                </div>
                <div>
                  <span>In media per abitante</span>
                  <strong>
                    {siope.nationalPerCapita === null
                      ? "n.d."
                      : exactEuro(siope.nationalPerCapita)}
                  </strong>
                  <small>su {integer(siope.populationCovered)} persone</small>
                </div>
                <div>
                  <span>Comuni inclusi</span>
                  <strong>{integer(siope.coverage.withMovements)}</strong>
                  <small>
                    su {integer(siope.coverage.activeSiopeMunicipalities)} validi nel periodo
                  </small>
                </div>
              </div>
            }
          />
          </div>

          <p className={styles.attribution}>
            Confini amministrativi a fini statistici:{" "}
            <a
              href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip"
              target="_blank"
              rel="noreferrer"
            >
              ISTAT, 1 gennaio 2026
            </a>
            ,{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>
            , geometria semplificata.
          </p>
        </section>

        <section className={`panel ${styles.regionsPanel}`}>
          <div className={styles.panelHead}>
            <h2 className="panel-title">Le regioni con più pagamenti per abitante</h2>
            <span className={styles.headNote}>Comuni con sede nella regione</span>
          </div>
          <div className="table-scroll" role="region" aria-label="Regioni ordinate per pagamenti pro capite" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Regione</th>
                  <th scope="col" className="num">Per abitante</th>
                  <th scope="col" className="num">Totale pagato</th>
                </tr>
              </thead>
              <tbody>
                {topRegions.map((region) => (
                  <tr key={region.region}>
                    <th scope="row">
                      <span className={styles.regionNameCell}>
                        <RegionCrest
                          regionCode={istatCodeOfRegion(region.region)}
                          regionName={region.region}
                          decorative
                        />
                        <span>{region.region}</span>
                      </span>
                    </th>
                    <td className="num">
                      {region.perCapita === null ? "n.d." : exactEuro(region.perCapita)}
                    </td>
                    <td className="num">{compactEuroLike(region.value, topRegionScale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RegionCrestAttribution />
          <Link className="btn btn-block" href={`/territori?anno=${year}`}>
            Vedi tutte le regioni
          </Link>
        </section>

        <section className={`panel ${styles.sourcePanel}`}>
          <div className={styles.panelHead}>
            <h2 className="panel-title">Da dove arrivano i numeri</h2>
          </div>
          <div className={styles.sourceList}>
            <article>
              <header>
                <strong>SIOPE · pagamenti dei Comuni</strong>
                <span className="status status-attiva">Attiva</span>
              </header>
              <dl>
                <div>
                  <dt>Dati fino a</dt>
                  <dd>
                    {monthLabel} {siope.year}
                  </dd>
                </div>
                <div>
                  <dt>File pubblicato il</dt>
                  <dd>{longDate(siope.source.siopeMovementsLastModified)}</dd>
                </div>
                <div>
                  <dt>Scaricato da noi</dt>
                  <dd>{longDate(siope.source.observedAt)}</dd>
                </div>
              </dl>
            </article>
            <article>
              <header>
                <strong>IPA · registro degli enti</strong>
                <span className="status status-attiva">Attiva</span>
              </header>
              <dl>
                <div>
                  <dt>Aggiornato il</dt>
                  <dd>{longDate(siope.source.ipaLastModified)}</dd>
                </div>
              </dl>
            </article>
          </div>
          <Link className="btn btn-block" href="/fonti">
            Vedi tutte le fonti
          </Link>
        </section>
      </div>

      <div className={styles.column}>
        <section className={`panel ${styles.rankPanel}`}>
          <div className={styles.panelHead}>
            <h2 className="panel-title">
              I {topMunicipalities.length} Comuni con più pagamenti per abitante
            </h2>
          </div>
          <ol className={styles.rankList}>
            {topMunicipalities.map((municipality, index) => (
              <li key={municipality.codiceFiscale}>
                <span>{index + 1}</span>
                <strong>
                  {municipalityName(municipality.name)}
                  <small>
                    {municipality.population === null
                      ? "popolazione non disponibile"
                      : `${integer(municipality.population)} abitanti`}
                  </small>
                </strong>
                <b>{exactEuro(municipality.perCapita ?? 0)}</b>
              </li>
            ))}
          </ol>
          <p className={styles.note}>
            Confronto pro capite; il totale resta nel dettaglio territoriale.
          </p>
          <Link className="btn btn-block" href={`/territori?anno=${year}`}>
            Vedi il confronto territoriale
          </Link>
        </section>

        <section className={`panel ${styles.actionPanel}`}>
          <div className={`${styles.panelHead} ${styles.compactHeader}`}>
            <h2 className="panel-title">Fondi e progetti</h2>
            <span className={styles.headNote}>OpenCoesione</span>
            <InfoTooltip id="cohesion-ratio-tip" label="Che cosa confrontiamo?">
              Gli impegni sono somme assegnate ai progetti; i pagamenti sono somme già erogate.
              Il rapporto non indica da solo che i progetti siano conclusi.
            </InfoTooltip>
          </div>
          {cohesionForYear ? (
            <>
              <dl className={styles.factRows}>
                <div>
                  <dt>Impegni registrati entro il {year}</dt>
                  <dd>{compactEuro(cohesionCommitted)}</dd>
                </div>
                <div>
                  <dt>Pagamenti registrati entro il {year}</dt>
                  <dd>{compactEuro(cohesionPaid)}</dd>
                </div>
              </dl>
              <div className={styles.ratioHead}>
                <span>Pagato rispetto agli impegni</span>
                <b>{percent(cohesionRatio)}</b>
              </div>
              <div className={styles.ratioTrack} aria-hidden="true">
                <i style={{ width: `${Math.min(cohesionRatio, 100)}%` }} />
              </div>
              <p className={styles.note}>
                Serie cumulata al {year}, nello snapshot aggiornato al {longDate(cohesion.referenceDate)}.
                Un pagamento non prova che il progetto sia finito.
              </p>
            </>
          ) : (
            <p className={styles.note}>La serie OpenCoesione non contiene dati per il {year}.</p>
          )}
          <Link className="btn btn-block" href="/coesione">
            Vai ai fondi
          </Link>
        </section>

        <section className={`panel ${styles.actionPanel}`}>
          <div className={`${styles.panelHead} ${styles.compactHeader}`}>
            <h2 className="panel-title">Anomalie da approfondire</h2>
            <InfoTooltip id="anomalies-tip" label="Che cosa chiamiamo anomalia?">
              Un valore insolito rispetto a enti simili o a una soglia statistica. È un segnale
              statistico da verificare con le fonti, non una prova di spreco o illecito.
            </InfoTooltip>
          </div>
          <div className={styles.anomalyGallery}>
            {anomalySignals.map((signal, index) => {
              const presentation = HOME_ANOMALY_PRESENTATION[signal.id as keyof typeof HOME_ANOMALY_PRESENTATION];
              if (!presentation) return null;

              return (
                <article
                  className={styles.anomalyItem}
                  data-signal={signal.id}
                  key={signal.id}
                >
                  <div className={styles.anomalyItemHead}>
                    <span className={styles.anomalyMarker} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.anomalyArea}>{signal.area}</span>
                  </div>
                  <h3>{presentation.title}</h3>
                  <strong className={styles.anomalyValue}>{anomalyValue(signal)}</strong>
                  {signal.unit === "percent" ? (
                    <span
                      className={styles.anomalyBar}
                      role="img"
                      aria-label={`${percent(signal.value)} delle procedure`}
                    >
                      <i style={{ width: `${Math.min(signal.value, 100)}%` }} />
                    </span>
                  ) : null}
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
              Mostriamo solo i segnali con fonte verificata. <Link href="/controlli">Esplora gli altri controlli</Link>.
            </p>
          ) : null}
          <Link className="btn btn-block" href="/controlli">
            Apri tutti i controlli
          </Link>
        </section>

        <aside className={styles.readingPanel} aria-labelledby="reading-title">
          <div className={styles.readingIntro}>
            <span className={styles.readingKicker}>Chiave di lettura</span>
            <h2 id="reading-title" className="panel-title">Come leggere questi numeri</h2>
            <p className={styles.readingNote}>
              Il totale dice quanto è uscito; il valore per abitante aiuta a confrontare Comuni
              diversi. Considera sempre anche la dimensione dell&apos;ente e i servizi che gestisce.
            </p>
          </div>
          <dl className={styles.readingRules}>
            <div>
              <dt>Totale</dt>
              <dd>Quanto è stato pagato</dd>
            </div>
            <div>
              <dt>Per abitante</dt>
              <dd>Un confronto più equo</dd>
            </div>
          </dl>
          <Link className={styles.readingLink} href="/metodologia">
            Come leggiamo i dati
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </main>
  );
}
