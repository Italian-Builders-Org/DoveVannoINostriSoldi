import Link from "next/link";
import type { Metadata } from "next";
import { PeriodSelector } from "@/components/period-selector";
import { compactEuro, compactEuroLike, exactEuro, integer, longDate } from "@/lib/format";
import { municipalityName } from "@/lib/municipality-name";
import { cptRegionAnchorOf, groupRegionsByMacroArea } from "@/lib/italy-regions";
import {
  availableSiopeYears,
  getSiopeMunicipalSnapshot,
  regionsByPerCapita,
} from "@/lib/siope-snapshot";
import styles from "./territori.module.css";

export const metadata: Metadata = {
  title: "Territori",
  description:
    "Pagamenti effettuati dai Comuni, regione per regione: classifiche pro capite, totali e copertura della popolazione.",
};

function selectedYear(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  const parsed = /^\d{4}$/.test(raw) ? Number(raw) : Number.NaN;
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

export default async function TerritoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[] }>;
}) {
  const year = selectedYear((await searchParams).anno);
  const data = getSiopeMunicipalSnapshot(year);
  const monthLabel = data.latestMonthLabel.toLocaleLowerCase("it-IT");

  const regions = regionsByPerCapita(data);
  const regionsByArea = groupRegionsByMacroArea(regions);
  const topByPerCapita = data.topMunicipalitiesByPerCapita.slice(0, 20);
  const topByPerCapitaGroups = [
    { label: "Posizioni 1-10", municipalities: topByPerCapita.slice(0, 10) },
    { label: "Posizioni 11-20", municipalities: topByPerCapita.slice(10, 20) },
  ];
  const topByVolume = data.topMunicipalitiesByValue.slice(0, 10);
  const regionScale = Math.max(
    ...regions.map((region) => region.value),
    ...regionsByArea.map(({ summary }) => summary.value),
    0,
  );
  const municipalityScale = topByVolume[0]?.value ?? 0;

  return (
    <main className="shell page">
      <div className={styles.intro}>
        <div className="page-intro">
          <h1>Pagamenti dei Comuni, territorio per territorio</h1>
          <p>
            Pagamenti dei Comuni con sede nella regione, nel periodo tra gennaio e {monthLabel} {data.year}.
            Media italiana:{" "}
            {data.nationalPerCapita === null
              ? "non disponibile"
              : `${exactEuro(data.nationalPerCapita)} per abitante`}
            .
            {" "}Sono uscite di cassa dei Comuni, non tasse pagate dai residenti.
          </p>
        </div>
        <PeriodSelector activeYear={year} years={availableSiopeYears} pathname="/territori" />
      </div>

      <div className={styles.split}>
        <section className="panel">
          <h2 className="panel-title">Tutte le {regions.length} regioni</h2>
          <p className={styles.regionTableHint}>
            Tabella completa: scorri orizzontalmente per abitanti e copertura dei Comuni →
          </p>
          <div className="table-scroll" role="region" aria-label="Pagamenti di tutte le regioni; scorri orizzontalmente per vedere tutte le colonne" tabIndex={0}>
            <table className={`table ${styles.regionTable}`}>
              <thead>
                <tr>
                  <th scope="col">Regione</th>
                  <th scope="col" className="num">Per abitante</th>
                  <th scope="col" className="num">Totale</th>
                  <th scope="col" className="num">Abitanti</th>
                  <th scope="col" className="num">Comuni nel rapporto</th>
                </tr>
              </thead>
              {regionsByArea.map(({ area, regions: areaRegions, summary }) => (
                <tbody key={area}>
                  <tr className={styles.areaRow}>
                    <th scope="rowgroup">{area}</th>
                    <td className="num">
                      {summary.perCapita === null ? "n.d." : exactEuro(summary.perCapita)}
                    </td>
                    <td className="num">{compactEuroLike(summary.value, regionScale)}</td>
                    <td className="num">
                      {summary.population === null ? "n.d." : integer(summary.population)}
                    </td>
                    <td className="num">
                      {integer(summary.municipalitiesWithPopulation)} /{" "}
                      {integer(summary.municipalities)}
                    </td>
                  </tr>
                  {areaRegions.map((region) => {
                    const cptAnchor = cptRegionAnchorOf(region.region);
                    return (
                      <tr key={region.region}>
                        <th scope="row">
                          {cptAnchor ? (
                            <Link
                              href={`/territori/fisco#${cptAnchor}`}
                              aria-label={`${region.region}: apri dati CPT 2023`}
                            >
                              {region.region}
                            </Link>
                          ) : (
                            region.region
                          )}
                        </th>
                        <td className="num">
                          {region.perCapita === null ? "n.d." : exactEuro(region.perCapita)}
                        </td>
                        <td className="num">{compactEuroLike(region.value, regionScale)}</td>
                        <td className="num">
                          {region.population === null ? "n.d." : integer(region.population)}
                        </td>
                        <td className="num">
                          {integer(region.municipalitiesWithPopulation)} /{" "}
                          {integer(region.municipalities)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        <div className={styles.aside}>
          <section className="panel" data-municipality-ranking="per-capita">
            <h2 className="panel-title">I {topByPerCapita.length} Comuni con più pagamenti per abitante</h2>
            <div className={styles.rankingGrid}>
              {topByPerCapitaGroups.map((group) => (
                <div className={styles.rankingGroup} key={group.label}>
                  <h3 className={styles.rankingGroupTitle}>{group.label}</h3>
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label={`${group.label}: Comuni ordinati per pagamenti pro capite; scorri orizzontalmente per vedere tutte le colonne`}
                    tabIndex={0}
                  >
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Comune</th>
                          <th scope="col" className="num">Per abitante</th>
                          <th scope="col" className="num">Totale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.municipalities.map((municipality) => (
                          <tr key={municipality.codiceFiscale}>
                            <th scope="row">
                              {municipalityName(municipality.name)}
                              <small>
                                {municipality.province} · {municipality.region}
                              </small>
                              <small>
                                {municipality.population === null
                                  ? "abitanti non disponibili"
                                  : `${integer(municipality.population)} abitanti`}
                              </small>
                            </th>
                            <td className="num">
                              {municipality.perCapita === null
                                ? "n.d."
                                : exactEuro(municipality.perCapita)}
                            </td>
                            <td className="num">{compactEuro(municipality.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Confronto · {topByVolume.length} maggiori volumi totali</h2>
            <div className="table-scroll" role="region" aria-label="Comuni ordinati per volume totale dei pagamenti; scorri orizzontalmente per vedere tutte le colonne" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Comune</th>
                    <th scope="col" className="num">Totale</th>
                    <th scope="col" className="num">Per abitante</th>
                  </tr>
                </thead>
                <tbody>
                  {topByVolume.map((municipality) => (
                    <tr key={municipality.codiceFiscale}>
                      <th scope="row">{municipalityName(municipality.name)}</th>
                      <td className="num">
                        {compactEuroLike(municipality.value, municipalityScale)}
                      </td>
                      <td className="num">
                        {municipality.perCapita === null
                          ? "n.d."
                          : exactEuro(municipality.perCapita)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              La vista assoluta resta disponibile come confronto, ma non è il default.
            </p>
          </section>

          <div className="notice">
            <strong>Perché non è una classifica di merito</strong>
            <p>
              Un Comune turistico serve molte più persone dei suoi residenti, e un Comune che
              ricostruisce dopo un terremoto spende per opere che dureranno decenni. Il numero alto
              non è una colpa e quello basso non è un merito.
            </p>
          </div>
        </div>
      </div>

      <div className={`notice ${styles.relatedNotice}`}>
        <strong>Quanto entra e quanto viene speso sul territorio?</strong>
        <p>
          I Conti Pubblici Territoriali permettono di confrontare entrate e spese della Pubblica
          Amministrazione consolidata su una base contabile coerente, con il pro capite come vista
          iniziale. <Link href="/territori/fisco">Apri entrate, spese e saldo per regione →</Link>
        </p>
      </div>

      <div className={`notice ${styles.relatedNotice}`}>
        <strong>Redditi e imposta netta dichiarata</strong>
        <p>
          Il MEF pubblica contribuenti, redditi, imposta netta dichiarata e addizionali per Comune.
          Sono dati dichiarativi, non gettito totale, e restano separati dal saldo CPT.{" "}
          <Link href="/territori/irpef">Apri i dati IRPEF per Regione, Provincia e Comune →</Link>
        </p>
      </div>

      <div className={`notice ${styles.relatedNotice}`}>
        <strong>Confronta spesa e fabbisogno standard</strong>
        <p>
          Per i Comuni delle Regioni a statuto ordinario puoi confrontare la spesa storica con il
          fabbisogno calcolato da OpenCivitas. Il confronto include importo totale, valore per
          abitante, percentuale e livello dei servizi.{" "}
          <Link href="/territori/confronto">Apri il confronto tra Comuni →</Link>
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Quanto del registro stiamo leggendo</h2>
        <div className={styles.coverage}>
          <dl className={styles.coverageList}>
            <div>
              <dt>Comuni con movimenti</dt>
              <dd>{integer(data.coverage.withMovements)}</dd>
            </div>
            <div>
              <dt>Comuni validi nel periodo</dt>
              <dd>{integer(data.coverage.activeSiopeMunicipalities)}</dd>
            </div>
            <div>
              <dt>Con movimenti senza regione</dt>
              <dd>{integer(data.coverage.withoutRegion)}</dd>
            </div>
            <div>
              <dt>Righe malformate</dt>
              <dd>{integer(data.coverage.malformedRows)}</dd>
            </div>
            <div>
              <dt>Comuni con popolazione</dt>
              <dd>{integer(data.coverage.withPopulation)}</dd>
            </div>
            <div>
              <dt>Senza popolazione</dt>
              <dd>{integer(data.coverage.withoutPopulation)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={`panel ${styles.method}`} aria-labelledby="territori-method-title">
        <h2 className="panel-title" id="territori-method-title">Fonti e metodo</h2>
        <p>Nota di metodo: {data.methodology.warning}</p>
        <p>Copertura pro capite: {data.methodology.perCapitaCoverage}.</p>
        <p>
          I {exactEuro(data.coverage.paymentsWithoutRegion)} dei Comuni senza abbinamento IPA
          restano nel totale nazionale ma fuori dai totali regionali: non assegniamo una regione
          senza una corrispondenza ufficiale. Il denominatore è la{" "}
          {data.methodology.populationSource}; {data.methodology.populationReference}; anagrafica
          aggiornata il{" "}
          {data.methodology.populationSourceLastModified
            ? longDate(data.methodology.populationSourceLastModified)
            : "data non disponibile"}.
        </p>
        <p>
          I link regionali aprono i dati CPT 2023, un perimetro distinto da SIOPE. Nei CPT,
          Trento e Bolzano sono pubblicati come due Province autonome: il dato SIOPE aggregato
          del Trentino-Alto Adige non viene collegato artificialmente a una sola voce.
        </p>
        <p>
          Fonte{" "}
          <a href={data.source.siopeMovementsUrl} target="_blank" rel="noreferrer">SIOPE</a>
          {" "}· {data.source.siopeOwner} · file del{" "}
          {longDate(data.source.siopeMovementsLastModified)} · scaricato il{" "}
          {longDate(data.source.observedAt)}.{" "}
          <Link href="/fonti/stato">Stato di tutte le fonti →</Link>
        </p>
      </section>
    </main>
  );
}
