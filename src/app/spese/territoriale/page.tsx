import type { Metadata } from "next";
import Link from "next/link";
import Pagination from "@/components/pagination";
import { integer } from "@/lib/format";
import { offsetFromPage, pageCountFromTotal, pageFromOffset } from "@/lib/pagination";
import {
  formatRgsTerritorialValue,
  queryRgsTerritorial,
  RGS_TERRITORIAL_DEFAULT_LIMIT,
  rgsTerritorialMeasures,
  RgsTerritorialQueryError,
  rgsTerritorialSnapshot,
} from "@/lib/rgs-territorial-snapshot";
import styles from "./territoriale.module.css";

type SearchValue = string | string[] | undefined;
type TerritorialPageProps = {
  searchParams: Promise<{
    livello?: SearchValue;
    territorio?: SearchValue;
    misura?: SearchValue;
    limit?: SearchValue;
    offset?: SearchValue;
    pagina?: SearchValue;
  }>;
};

export const metadata: Metadata = {
  title: "Spesa statale per territorio destinatario",
  description:
    "Distribuzione territoriale RGS 2023 del Bilancio dello Stato: 5.067 combinazioni dimensionali e quattro misure tenute separate.",
};

const LEVEL_LABELS = {
  national: "Italia",
  macroarea: "Macroaree",
  region: "Regioni",
} as const;

function paginationHref(
  result: ReturnType<typeof queryRgsTerritorial>,
  offset: number,
): string {
  const query = new URLSearchParams({
    livello: result.query.level,
    misura: result.query.measure,
    limit: String(result.pagination.limit),
  });
  if (result.query.territory) query.set("territorio", result.query.territory);
  if (offset > 0) query.set("offset", String(offset));
  return `/spese/territoriale?${query.toString()}`;
}

/** `pagina` is the readable form of `offset`; an explicit offset still wins. */
function requestedOffset(params: Awaited<TerritorialPageProps["searchParams"]>): SearchValue {
  if (params.offset !== undefined && params.offset !== "") return params.offset;
  const page = params.pagina;
  if (typeof page === "string" && /^\d+$/.test(page) && Number(page) >= 1) {
    const limit =
      typeof params.limit === "string" && /^\d+$/.test(params.limit) && Number(params.limit) >= 1
        ? Number(params.limit)
        : RGS_TERRITORIAL_DEFAULT_LIMIT;
    return String(offsetFromPage(Number(page), limit));
  }
  return undefined;
}

function safeQuery(params: Awaited<TerritorialPageProps["searchParams"]>) {
  try {
    return {
      result: queryRgsTerritorial({
        level: params.livello,
        territory: params.territorio,
        measure: params.misura,
        limit: params.limit,
        offset: requestedOffset(params),
      }),
      error: null,
    };
  } catch (error) {
    if (!(error instanceof RgsTerritorialQueryError)) throw error;
    return { result: queryRgsTerritorial(), error: error.message };
  }
}

export default async function RgsTerritorialPage({ searchParams }: TerritorialPageProps) {
  const params = await searchParams;
  const { result, error } = safeQuery(params);
  const firstVisible = result.rows.length === 0 ? 0 : result.pagination.offset + 1;
  const lastVisible = result.pagination.offset + result.pagination.returned;
  const reconciliation = rgsTerritorialSnapshot.reconciliation;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className={styles.eyebrow}>Bilancio dello Stato · 2023</p>
        <h1>Spesa statale per territorio destinatario</h1>
        <p>
          La distribuzione territoriale pubblicata da RGS conserva 5.067 combinazioni fra
          territorio, titolo, categoria e missione. Valori assoluti, quota del PIL, pro capite e
          per km² restano quattro misure separate.
        </p>
      </header>

      <section className={`stat-strip ${styles.stats}`} aria-label="Copertura RGS territoriale">
        <div>
          <span className="stat-label">Righe sorgente</span>
          <span className="stat-value">{integer(rgsTerritorialSnapshot.coverage.sourceRows)}</span>
          <span className="stat-note">5.067 combinazioni per quattro misure</span>
        </div>
        <div>
          <span className="stat-label">Combinazioni dimensionali</span>
          <span className="stat-value">{integer(rgsTerritorialSnapshot.coverage.dimensionRows)}</span>
          <span className="stat-note">territorio, titolo, categoria e missione</span>
        </div>
        <div>
          <span className="stat-label">Misure autonome</span>
          <span className="stat-value">{integer(rgsTerritorialSnapshot.dimensions.measures.length)}</span>
          <span className="stat-note">nessuna somma fra unità diverse</span>
        </div>
        <div>
          <span className="stat-label">Zeri osservati</span>
          <span className="stat-value">{integer(rgsTerritorialSnapshot.coverage.zeroValues)}</span>
          <span className="stat-note">una riga assente non diventa zero</span>
        </div>
      </section>

      <section className="notice warning-notice scope-notice" aria-labelledby="territorial-boundary-title">
        <h2 id="territorial-boundary-title">Tre livelli sovrapposti, mai un unico totale</h2>
        <p>
          Italia, macroaree e regioni descrivono lo stesso perimetro a livelli differenti e non
          devono essere sommati insieme. Per questo ogni interrogazione restituisce un solo livello
          territoriale e una sola misura.
        </p>
        <p>
          Percentuale del PIL, euro per abitante ed euro per km² usano denominatori calcolati
          dall’editore ma non versionati nel record. Non vengono ricalcolati né usati come addendi.
        </p>
      </section>

      <nav className={styles.quickMeasures} aria-label="Scelte rapide della misura RGS">
        {rgsTerritorialMeasures.map((measure) => (
          <Link
            key={measure.id}
            href={`/spese/territoriale?livello=${result.query.level}&misura=${measure.id}&limit=${result.pagination.limit}`}
            aria-current={result.query.measure === measure.id ? "page" : undefined}
          >
            {measure.id === "absolute" ? "Totale" : measure.id === "gdp-share" ? "% PIL" : measure.id === "per-inhabitant" ? "Per abitante" : "Per km²"}
          </Link>
        ))}
      </nav>

      <section className={`panel ${styles.filterPanel}`} aria-labelledby="territorial-filter-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="territorial-filter-title">Scegli livello, territorio e misura</h2>
            <p>La pagina decodifica i dizionari dello snapshot e conserva gli interi scalati senza float.</p>
          </div>
          <span className="tag tag-neutral">{integer(result.pagination.total)} combinazioni nel filtro</span>
        </div>
        <form action="/spese/territoriale" method="get" className={styles.filterForm}>
          <label>
            <span>Livello</span>
            <select name="livello" defaultValue={result.query.level}>
              <option value="region">Regioni</option>
              <option value="macroarea">Macroaree</option>
              <option value="national">Italia</option>
            </select>
          </label>
          <label>
            <span>Territorio</span>
            <select name="territorio" defaultValue={result.query.territory ?? ""}>
              <option value="">Tutti nel livello</option>
              {(["national", "macroarea", "region"] as const).map((level) => (
                <optgroup label={LEVEL_LABELS[level]} key={level}>
                  {rgsTerritorialSnapshot.dimensions.territories
                    .filter((territory) => territory.level === level)
                    .map((territory) => (
                      <option value={territory.label} key={territory.label}>{territory.label}</option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={styles.measureField}>
            <span>Misura</span>
            <select name="misura" defaultValue={result.query.measure}>
              {rgsTerritorialMeasures.map((measure) => (
                <option value={measure.id} key={measure.id}>{measure.label}</option>
              ))}
            </select>
          </label>
          <input type="hidden" name="limit" value={result.pagination.limit} />
          <button className="btn btn-primary" type="submit">Applica filtri</button>
        </form>
        {error ? <p className={styles.error} role="alert">{error} Sono mostrate le regioni con valori assoluti.</p> : null}
      </section>

      <section className={`panel ${styles.tablePanel}`} aria-labelledby="territorial-rows-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="territorial-rows-title">
              {LEVEL_LABELS[result.query.level]} · {result.measure.label}
            </h2>
            <p>
              {result.rows.length === 0
                ? "Nessuna combinazione nel perimetro selezionato."
                : `Righe ${integer(firstVisible)}-${integer(lastVisible)} di ${integer(result.pagination.total)}.`}
            </p>
          </div>
          <span className="tag tag-neutral">
            {result.measure.denominatorStatus === "publisher_derived_not_versioned"
              ? "Denominatore editore non versionato"
              : "Valore assoluto"}
          </span>
        </div>
        {result.rows.length > 0 ? (
          <div className={`table-scroll ${styles.dataTable}`} role="region" aria-label="Distribuzione territoriale della spesa statale RGS" tabIndex={0}>
            <table className="table">
              <caption>Una sola misura e un solo livello territoriale per tabella</caption>
              <thead>
                <tr>
                  <th scope="col">Territorio</th>
                  <th scope="col">Titolo</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Missione</th>
                  <th scope="col" className="num">Valore pubblicato</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.territory}</th>
                    <td>{row.title}</td>
                    <td>{row.category}</td>
                    <td>{row.mission}</td>
                    <td className={`num ${styles.amount}`}>
                      <strong>{row.formattedValue}</strong>
                      {row.value === 0 ? <small>zero osservato nel CSV</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Pagination
          label="Pagine della distribuzione territoriale RGS"
          page={pageFromOffset(result.pagination.offset, result.pagination.limit)}
          pageCount={pageCountFromTotal(result.pagination.total, result.pagination.limit)}
          summary={
            result.rows.length > 0
              ? `righe ${integer(firstVisible)}-${integer(lastVisible)} di ${integer(result.pagination.total)}`
              : undefined
          }
          hrefForPage={(target) =>
            paginationHref(result, offsetFromPage(target, result.pagination.limit))
          }
          jump={{
            action: "/spese/territoriale",
            pageParam: "pagina",
            fields: {
              livello: result.query.level,
              misura: result.query.measure,
              limit: String(result.pagination.limit),
              ...(result.query.territory ? { territorio: result.query.territory } : {}),
            },
          }}
        />
      </section>

      <section className={`panel ${styles.reconciliationPanel}`} aria-labelledby="territorial-reconciliation-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="territorial-reconciliation-title">Controllo di riconciliazione</h2>
            <p>Tre letture indipendenti dei valori assoluti; gli scarti sono arrotondamenti, non importi da sommare.</p>
          </div>
        </div>
        <div className={`table-scroll ${styles.reconciliationTable}`} role="region" aria-label="Riconciliazione dei livelli territoriali" tabIndex={0}>
          <table className="table">
            <caption>Confronto indipendente fra totale nazionale, macroaree e regioni</caption>
            <thead>
              <tr>
                <th scope="col">Livello</th>
                <th scope="col" className="num">Valori assoluti</th>
                <th scope="col" className="num">Scarto rispetto a Italia</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Italia</th>
                <td className="num">{formatRgsTerritorialValue(reconciliation.nationalHundredthsMillionEur, "absolute")}</td>
                <td className="num">riferimento</td>
              </tr>
              <tr>
                <th scope="row">Somma interna delle macroaree</th>
                <td className="num">{formatRgsTerritorialValue(reconciliation.macroareasHundredthsMillionEur, "absolute")}</td>
                <td className="num">-0,04 mln €</td>
              </tr>
              <tr>
                <th scope="row">Somma interna delle regioni</th>
                <td className="num">{formatRgsTerritorialValue(reconciliation.regionsHundredthsMillionEur, "absolute")}</td>
                <td className="num">-0,09 mln €</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={`notice ${styles.debtNotice}`} aria-labelledby="territorial-debt-title">
        <h2 id="territorial-debt-title">Interessi e debito: l’etichetta non risolve il perimetro</h2>
        <p>
          Per Italia, l’incrocio fra categoria 09 e missione 034 riporta 8.057,70 milioni di euro.
          La landing descrive il dataset al netto degli interessi sul debito, mentre il CSV conserva
          righe con queste etichette. La pagina non le elimina e non deduce da sola che ogni importo
          sia incluso o escluso dal perimetro dichiarato.
        </p>
      </section>

      <section className={`panel ${styles.sourcePanel}`} aria-labelledby="territorial-source-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="territorial-source-title">Fonte ufficiale</h2>
            <p>Ragioneria Generale dello Stato, record {rgsTerritorialSnapshot.source.recordId}.</p>
          </div>
          <a href={rgsTerritorialSnapshot.source.landingUrl} target="_blank" rel="noreferrer">Scheda RGS ↗</a>
        </div>
        <div className={styles.sourceLinks}>
          <a href={rgsTerritorialSnapshot.source.csvUrl} target="_blank" rel="noreferrer">CSV ufficiale ↗</a>
          <a href={rgsTerritorialSnapshot.source.schemaUrl} target="_blank" rel="noreferrer">Schema RGS ↗</a>
        </div>
        <dl className={styles.sourceDetails}>
          <div><dt>Osservazione dati</dt><dd>{rgsTerritorialSnapshot.source.dataObservedAt}</dd></div>
          <div><dt>Encoding</dt><dd>{rgsTerritorialSnapshot.source.encoding}</dd></div>
          <div><dt>Licenza nel record</dt><dd>non dichiarata</dd></div>
        </dl>
        <code className={styles.hash}>SHA-256 sorgente: {rgsTerritorialSnapshot.source.sourceSha256}</code>
      </section>

      <section className={`panel ${styles.caveatPanel}`} aria-labelledby="territorial-caveats-title">
        <h2 className="panel-title" id="territorial-caveats-title">Limiti dichiarati nello snapshot</h2>
        <ul>
          {rgsTerritorialSnapshot.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
        </ul>
      </section>
    </main>
  );
}
