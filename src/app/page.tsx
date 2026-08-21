import Link from "next/link";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { PeriodSelector } from "@/components/period-selector";
import { getProcurementComparisonForYear } from "@/lib/audit-data";
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
import {
  availableSiopeYears,
  completedMonths,
  getSiopeMunicipalSnapshot,
  municipalitiesByPerCapita,
  regionsByPerCapita,
  partialMonth,
} from "@/lib/siope-snapshot";
import styles from "./home.module.css";

/* The donut walks this ramp in order; five buckets, five steps of contrast. */
const SLICE_COLORS = [
  "var(--color-accent)",
  "var(--color-neutral-800)",
  "var(--color-neutral-500)",
  "var(--color-neutral-400)",
  "var(--color-accent-300)",
];

function selectedYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

/** Turns shares into the cumulative `from% to%` stops a conic gradient wants. */
function donutGradientStops(slices: { color: string; share: number }[]): string {
  return slices
    .reduce<{ at: number; stops: string[] }>(
      (accumulator, slice) => {
        const to = accumulator.at + slice.share;
        accumulator.stops.push(`${slice.color} ${accumulator.at}% ${to}%`);
        return { at: to, stops: accumulator.stops };
      },
      { at: 0, stops: [] },
    )
    .stops.join(",");
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
      value,
      share: siope.totalPaid > 0 ? (value / siope.totalPaid) * 100 : 0,
      color: SLICE_COLORS[index % SLICE_COLORS.length],
    };
  });

  const donutStops = donutGradientStops(buckets);

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
  const procurement = getProcurementComparisonForYear(year);

  return (
    <main className={`shell ${styles.dashboard}`}>
      <h1 className={styles.pageTitle}>Dove vanno i nostri soldi pubblici</h1>
      <div className={styles.column}>
        <section className="panel">
          <div className={styles.panelHead}>
            <h2 className="panel-title">Pagamenti effettuati dai Comuni</h2>
            <InfoTooltip id="cash-payments-tip" label="Che cosa sono i pagamenti di cassa?">
              Sono uscite di cassa registrate dai Comuni, mese per mese. Non sono le tasse pagate
              dai residenti e non includono Stato centrale, Regioni e sanità.
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
            <h2 className="panel-title">Per cosa sono stati spesi</h2>
            <InfoTooltip id="spending-glossary-tip" label="Piccolo glossario delle voci di spesa">
              <b>Piccolo glossario</b>
              {HOME_SPENDING_BUCKETS.map((bucket) => (
                <span key={bucket.name}>
                  · <b>{bucket.name}</b>: {bucket.explanation}
                </span>
              ))}
            </InfoTooltip>
          </div>

          <div className={styles.donutBlock}>
            <div
              className={styles.donut}
              role="img"
              aria-label={`Ripartizione dei pagamenti: ${buckets
                .map((bucket) => `${bucket.name} ${percent(bucket.share)}`)
                .join(", ")}`}
              style={{ background: `conic-gradient(${donutStops})` }}
            />
            <ul className={styles.donutLegend}>
              {buckets.map((bucket) => (
                <li key={bucket.name}>
                  <i aria-hidden="true" style={{ background: bucket.color }} />
                  <span>{bucket.name}</span>
                  <b>{percent(bucket.share)}</b>
                </li>
              ))}
            </ul>
          </div>
          <Link
            className={`btn btn-block ${styles.spendingDetailsLink}`}
            href={`/spese?anno=${year}`}
          >
            Vedi il dettaglio delle voci
          </Link>
        </section>

        <section className="panel">
          <h2 className="panel-title">
            I {topMunicipalities.length} Comuni con più pagamenti per abitante
          </h2>
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
            Default pro capite. Il totale resta disponibile nel dettaglio territoriale.
          </p>
          <Link className="btn btn-block" href={`/territori?anno=${year}`}>
            Vedi il confronto territoriale
          </Link>
        </section>
      </div>

      <div className={styles.column}>
        <section className="panel">
          <div className={styles.panelHead}>
            <h2 className="panel-title">Dove si spende di più, regione per regione</h2>
            <PeriodSelector activeYear={year} years={availableSiopeYears} pathname="/" />
          </div>

          <ItalyRegionsMap
            regions={siope.regions}
            period={period}
            aside={
              <div className={styles.mapStats}>
                <div>
                  <span>Da gennaio a {monthLabel}</span>
                  <strong>{compactEuro(siope.totalPaid)}</strong>
                  <small>pagati dai Comuni</small>
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
                  <small>su {integer(siope.coverage.activeSiopeMunicipalities)} registrati</small>
                </div>
              </div>
            }
          />

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

        <section className="panel">
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
                    <th scope="row">{region.region}</th>
                    <td className="num">
                      {region.perCapita === null ? "n.d." : exactEuro(region.perCapita)}
                    </td>
                    <td className="num">{compactEuroLike(region.value, topRegionScale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link className="btn btn-block" href={`/territori?anno=${year}`}>
            Vedi tutte le regioni
          </Link>
        </section>
      </div>

      <div className={styles.column}>
        <section className="panel">
          <div className={styles.panelHead}>
            <h2 className="panel-title">Mese per mese</h2>
            <span className={styles.headNote}>miliardi di €</span>
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

        <section className="panel">
          <h2 className="panel-title">Da dove arrivano i numeri</h2>
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

        <section className="panel">
          <h2 className="panel-title">Fondi e progetti · OpenCoesione</h2>
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
                <span>Pagamenti sugli impegni</span>
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

        <section className="panel">
          <h2 className="panel-title">Segnali da controllare</h2>
          {procurement ? (
            <>
              <dl className={styles.factRows}>
                <div>
                  <dt>Valore degli affidamenti diretti nel {procurement.year}</dt>
                  <dd>{((procurement.totalValueBillion * procurement.byValue) / 100).toLocaleString("it-IT", {
                    maximumFractionDigits: 1,
                  })} mld €</dd>
                </div>
                <div>
                  <dt>Quota sul valore dei contratti</dt>
                  <dd>{percent(procurement.byValue)}</dd>
                </div>
              </dl>
              <p className={styles.note}>
                Relazione ANAC sul {procurement.year}. È un segnale da approfondire, non una prova di spreco.
              </p>
            </>
          ) : (
            <p className={styles.note}>
              La relazione ANAC completa sul {year} non è ancora disponibile. Non sostituiamo il dato con quello di un altro anno.
            </p>
          )}
          <Link className="btn btn-block" href="/controlli">
            Vai ai controlli
          </Link>
        </section>

        <section className="panel panel-accent">
          <h2 className="panel-title">Come leggere questi numeri</h2>
          <p className={styles.readingNote}>
            Qui vedi solo i pagamenti dei Comuni, non tutta la spesa pubblica italiana. Una cifra
            alta non vuol dire spreco: dipende da quante persone vivono lì e da cosa fa quel
            Comune.
          </p>
          <Link href="/metodologia">Come leggiamo i dati →</Link>
        </section>
      </div>
    </main>
  );
}
