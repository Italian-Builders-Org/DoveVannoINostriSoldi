import Link from "next/link";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { PeriodSelector } from "@/components/period-selector";
import { SpendingComposition, type CompositionFamily } from "@/components/spending-composition";
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
import { HOME_SPENDING_BUCKETS } from "@/lib/siope-titles";
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
  const runningMonth = partialMonth(siope);
  const settledMonths = completedMonths(siope);
  const lastCompleted = settledMonths[settledMonths.length - 1] ?? null;

  const valueByCode = new Map(siope.titles.map((title) => [title.code, title.value]));
  const buckets = HOME_SPENDING_BUCKETS.map((bucket, index) => ({
    ...bucket,
    id: bucket.codes.join("-"),
    value: bucket.codes.reduce((sum, code) => sum + (valueByCode.get(code) ?? 0), 0),
    family: COMPOSITION_FAMILIES[index],
  }));

  const topRegions = regionsByPerCapita(siope).slice(0, 6);
  const topMunicipalities = municipalitiesByPerCapita(siope).slice(0, 5);
  const topRegionScale = topRegions[0]?.value ?? 0;
  const maxFlow = Math.max(...siope.monthly.map((point) => point.flow), 0);

  const cohesionForYear = cohesion.annualSeries.find((point) => point.year === year) ?? null;
  const cohesionPaid = (cohesionForYear?.paymentsCents ?? 0) / 100;
  const cohesionCommitted = (cohesionForYear?.commitmentsCents ?? 0) / 100;
  const cohesionRatio = cohesionCommitted > 0 ? (cohesionPaid / cohesionCommitted) * 100 : 0;
  const procurement = getProcurementComparisonForYear(year);

  return (
    <main className={`shell ${styles.dashboard}`}>
      <header className={styles.pageIntro}>
        <div>
          <h1>Esplora i pagamenti dei Comuni</h1>
          <p>Parti da un territorio, poi verifica importi, periodo e fonte.</p>
        </div>
        <PeriodSelector activeYear={year} years={availableSiopeYears} pathname="/" />
      </header>

      <section className={`panel ${styles.atlasPanel}`} aria-labelledby="atlas-title">
        <div className={styles.panelHead}>
          <h2 className="panel-title" id="atlas-title">Pagamenti comunali, regione per regione</h2>
          <InfoTooltip id="cash-payments-tip" label="Che cosa sono i pagamenti di cassa?">
            Uscite di cassa registrate dai Comuni, mese per mese. Restano fuori Stato centrale,
            Regioni e sanità.
          </InfoTooltip>
        </div>

        <ItalyRegionsMap
          regions={siope.regions}
          period={period}
          detailsHref={`/territori?anno=${year}`}
          summary={
            <div className={styles.nationalSummary} aria-label="Quadro nazionale dei pagamenti comunali">
              <div>
                <span>Totale nel periodo</span>
                <strong>{compactEuro(siope.totalPaid)}</strong>
                <small>pagamenti di cassa dei Comuni</small>
              </div>
              <div>
                <span>In media per abitante</span>
                <strong>{siope.nationalPerCapita === null ? "n.d." : exactEuro(siope.nationalPerCapita)}</strong>
                <small>su {integer(siope.populationCovered)} persone</small>
              </div>
              <div>
                <span>Comuni inclusi</span>
                <strong>{integer(siope.coverage.withMovements)}</strong>
                <small>su {integer(siope.coverage.activeSiopeMunicipalities)} validi nel periodo</small>
              </div>
              <div>
                <span>Fonte</span>
                <strong>SIOPE</strong>
                <small>Aggiornato al {longDate(siope.source.siopeMovementsLastModified)}</small>
              </div>
            </div>
          }
        />

        <p className={styles.attribution}>
          Confini amministrativi: <a href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip" target="_blank" rel="noreferrer">ISTAT, 1 gennaio 2026</a>, geometria semplificata dai dati ufficiali e mantenuta nelle proporzioni originali.
        </p>
      </section>

      <div className={styles.insightGrid}>
        <section className="panel" aria-labelledby="composition-title">
          <div className={styles.panelHead}>
            <div>
              <h2 className="panel-title" id="composition-title">Per cosa</h2>
              <p>Composizione del totale pagato</p>
            </div>
          </div>
          <SpendingComposition
            state={{
              kind: "ready",
              totalEuro: siope.totalPaid,
              items: buckets.map((bucket) => ({
                id: bucket.id,
                label: bucket.name,
                valueEuro: bucket.value,
                explanation: bucket.explanation,
                family: bucket.family,
              })),
            }}
            period={`Da gennaio a ${monthLabel} ${siope.year}`}
            scope="Pagamenti di cassa dei Comuni in tutta Italia"
            denominator="totale dei pagamenti SIOPE dei Comuni nel periodo"
            source={{
              label: `${siope.source.siopeOwner} · SIOPE`,
              href: siope.source.siopeMovementsUrl,
              observedAt: longDate(siope.source.observedAt),
            }}
          />
          <Link className={`btn btn-block ${styles.panelAction}`} href={`/spese?anno=${year}`}>
            Vedi il dettaglio delle voci
          </Link>
        </section>

        <section className={`panel ${styles.monthPanel}`} aria-labelledby="monthly-title">
          <div className={styles.panelHead}>
            <div>
              <h2 className="panel-title" id="monthly-title">Quando</h2>
              <p>Pagamenti mese per mese · miliardi di €</p>
            </div>
            <span className={styles.headNote}>Totale nel periodo: {compactEuro(siope.totalPaid)}</span>
          </div>
          <div className={styles.monthChartScroll} role="region" aria-label="Pagamenti mensili" tabIndex={0}>
            <ul className={styles.monthChart}>
              {siope.monthly.map((point) => {
                const running = point.month === runningMonth;
                return (
                  <li key={point.month}>
                    <b>{billions(point.flow)}</b>
                    <i aria-hidden="true">
                      <span
                        className={running ? styles.running : undefined}
                        style={{ height: maxFlow > 0 ? `${(point.flow / maxFlow) * 100}%` : "0%" }}
                      />
                    </i>
                    <span>{point.label}{running ? "*" : ""}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          {runningMonth === null ? (
            <p className={styles.note}>Anno chiuso: tutti i mesi sono definitivi.</p>
          ) : (
            <p className={styles.note}>
              * {siope.latestMonthLabel} è ancora in corso. L’ultimo mese completo è {lastCompleted?.label.toLocaleLowerCase("it-IT") ?? "non disponibile"}.
            </p>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="regional-ranking-title">
        <div className={styles.panelHead}>
          <h2 className="panel-title" id="regional-ranking-title">Le regioni con più pagamenti per abitante</h2>
          <span className={styles.headNote}>Comuni con sede nella regione</span>
        </div>
        <div className="table-scroll" role="region" aria-label="Regioni ordinate per pagamenti pro capite" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Regione</th>
                <th scope="col" className="num">Per abitante</th>
                <th scope="col" className="num">Totale pagato</th>
                <th scope="col" className="num">Popolazione coperta</th>
                <th scope="col" className="num">Comuni inclusi</th>
              </tr>
            </thead>
            <tbody>
              {topRegions.map((region) => (
                <tr key={region.region}>
                  <th scope="row">{region.region}</th>
                  <td className="num">{region.perCapita === null ? "n.d." : exactEuro(region.perCapita)}</td>
                  <td className="num">{compactEuroLike(region.value, topRegionScale)}</td>
                  <td className="num">{region.population === null ? "n.d." : integer(region.population)}</td>
                  <td className="num">{integer(region.municipalities)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link className="btn btn-block" href={`/territori?anno=${year}`}>Vedi tutte le regioni</Link>
      </section>

      <div className={styles.supportGrid}>
        <section className="panel">
          <h2 className="panel-title">I {topMunicipalities.length} Comuni con più pagamenti per abitante</h2>
          <ol className={styles.rankList}>
            {topMunicipalities.map((municipality, index) => (
              <li key={municipality.codiceFiscale}>
                <span>{index + 1}</span>
                <strong>
                  {municipalityName(municipality.name)}
                  <small>{municipality.population === null ? "popolazione non disponibile" : `${integer(municipality.population)} abitanti`}</small>
                </strong>
                <b>{exactEuro(municipality.perCapita ?? 0)}</b>
              </li>
            ))}
          </ol>
          <p className={styles.note}>Confronto pro capite: un valore alto non indica da solo uno spreco.</p>
          <Link className="btn btn-block" href={`/territori?anno=${year}`}>Vedi il confronto territoriale</Link>
        </section>

        <section className="panel">
          <h2 className="panel-title">Da dove arrivano i numeri</h2>
          <div className={styles.sourceList}>
            <article>
              <header><strong>SIOPE · pagamenti dei Comuni</strong><span className="status status-attiva">Attiva</span></header>
              <dl>
                <div><dt>Dati fino a</dt><dd>{monthLabel} {siope.year}</dd></div>
                <div><dt>File pubblicato il</dt><dd>{longDate(siope.source.siopeMovementsLastModified)}</dd></div>
                <div><dt>Scaricato da noi</dt><dd>{longDate(siope.source.observedAt)}</dd></div>
              </dl>
            </article>
            <article>
              <header><strong>IPA · registro degli enti</strong><span className="status status-attiva">Attiva</span></header>
              <dl><div><dt>Aggiornato il</dt><dd>{longDate(siope.source.ipaLastModified)}</dd></div></dl>
            </article>
          </div>
          <Link className="btn btn-block" href="/fonti">Vedi tutte le fonti</Link>
        </section>

        <section className="panel">
          <h2 className="panel-title">Fondi e progetti · OpenCoesione</h2>
          {cohesionForYear ? (
            <>
              <dl className={styles.factRows}>
                <div><dt>Impegni registrati entro il {year}</dt><dd>{compactEuro(cohesionCommitted)}</dd></div>
                <div><dt>Pagamenti registrati entro il {year}</dt><dd>{compactEuro(cohesionPaid)}</dd></div>
              </dl>
              <div className={styles.ratioHead}><span>Pagamenti sugli impegni</span><b>{percent(cohesionRatio)}</b></div>
              <div className={styles.ratioTrack} aria-hidden="true"><i style={{ width: `${Math.min(cohesionRatio, 100)}%` }} /></div>
              <p className={styles.note}>Serie cumulata aggiornata al {longDate(cohesion.referenceDate)}. Un pagamento non prova che il progetto sia finito.</p>
            </>
          ) : <p className={styles.note}>La serie OpenCoesione non contiene dati per il {year}.</p>}
          <Link className="btn btn-block" href="/coesione">Vai ai fondi</Link>
        </section>

        <section className="panel">
          <h2 className="panel-title">Segnali da controllare</h2>
          {procurement ? (
            <>
              <dl className={styles.factRows}>
                <div>
                  <dt>Affidamenti diretti nel {procurement.year}</dt>
                  <dd>{((procurement.totalValueBillion * procurement.byValue) / 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €</dd>
                </div>
                <div><dt>Quota sul valore dei contratti</dt><dd>{percent(procurement.byValue)}</dd></div>
              </dl>
              <p className={styles.note}>Relazione ANAC sul {procurement.year}. È un segnale da approfondire, non una prova di illecito.</p>
            </>
          ) : <p className={styles.note}>La relazione ANAC completa sul {year} arriverà quando sarà pubblicata.</p>}
          <Link className="btn btn-block" href="/controlli">Vai ai controlli</Link>
        </section>
      </div>

      <section className={`notice ${styles.readingNotice}`} aria-labelledby="reading-title">
        <strong id="reading-title">Prima di confrontare</strong>
        <p>Qui vedi pagamenti di cassa dei Comuni. Abitanti, servizi gestiti e perimetro contabile cambiano il significato del confronto. <Link href="/metodologia">Leggi il metodo →</Link></p>
      </section>
    </main>
  );
}
