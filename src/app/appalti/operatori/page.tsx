import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { compactEuroLike, exactEuro, integer } from "@/lib/format";
import {
  ANAC_OPERATOR_INDEX,
  listAnacOperatorsPage,
  loadAnacOperatorIndexMeta,
  loadAnacOperatorNationalSummaries,
  searchAnacOperators,
  type AnacOperatorNationalSummaries,
  type AnacOperatorSearchHit,
} from "@/lib/data/anac-operator-awards-index";
import { ScrollRegion } from "../scroll-region";
import styles from "./operatori.module.css";

export const metadata: Metadata = {
  title: "Imprese aggiudicatarie ANAC",
  description:
    "Tabelle riassuntive e elenco nazionale storico delle imprese aggiudicatarie ANAC: conteggi, valori dichiarati, CPV, stazioni appaltanti e oggetti di gara.",
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDecimalEuro(value: string | null): string {
  if (value === null) return "n.d.";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return exactEuro(amount);
}

function formatCompactEuro(value: string, reference: number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return compactEuroLike(amount, reference);
}

function yearRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "anni non disponibili";
  if (min === max) return String(min);
  return `${min ?? "?"}-${max ?? "?"}`;
}

function listHref(options: {
  ordine?: string;
  page?: number;
  q?: string;
  vista?: "elenco";
}): string {
  const params = new URLSearchParams();
  if (options.vista === "elenco") params.set("vista", "elenco");
  if (options.q) params.set("q", options.q);
  if (options.ordine === "valore") params.set("ordine", "valore");
  if (options.page && options.page > 1) params.set("page", String(options.page));
  const query = params.toString();
  return query ? `/appalti/operatori?${query}` : "/appalti/operatori";
}

const PAGE_JUMP = 10;

function OperatorPagination({
  page,
  pageCount,
  byValue,
}: Readonly<{ page: number; pageCount: number; byValue: boolean }>) {
  const ordine = byValue ? "valore" : undefined;
  const href = (target: number) => listHref({ vista: "elenco", ordine, page: target });
  const backJump = Math.max(1, page - PAGE_JUMP);
  const forwardJump = Math.min(pageCount, page + PAGE_JUMP);
  const jumpMin = Math.max(1, page - PAGE_JUMP);
  const jumpMax = Math.min(pageCount, page + PAGE_JUMP);

  return (
    <nav className={styles.pagination} aria-label="Pagine operatori">
      <div className={styles.paginationRow}>
        {page > 1 ? (
          <Link className="btn btn-secondary" href={href(1)}>
            Prima
          </Link>
        ) : (
          <span className={`btn btn-secondary ${styles.paginationDisabled}`} aria-disabled="true">
            Prima
          </span>
        )}
        {page > 1 ? (
          <Link
            className="btn btn-secondary"
            href={href(backJump)}
            aria-label={`Indietro di al massimo ${PAGE_JUMP} pagine`}
          >
            −{PAGE_JUMP}
          </Link>
        ) : (
          <span className={`btn btn-secondary ${styles.paginationDisabled}`} aria-disabled="true">
            −{PAGE_JUMP}
          </span>
        )}
        {page > 1 ? (
          <Link className="btn btn-secondary" href={href(page - 1)}>
            ← Precedenti
          </Link>
        ) : (
          <span className={`btn btn-secondary ${styles.paginationDisabled}`} aria-disabled="true">
            ← Precedenti
          </span>
        )}
        <span className={styles.pageStatus}>
          {integer(page)} / {integer(pageCount)}
        </span>
        {page < pageCount ? (
          <Link className="btn btn-secondary" href={href(page + 1)}>
            Successivi →
          </Link>
        ) : (
          <span className={`btn btn-secondary ${styles.paginationDisabled}`} aria-disabled="true">
            Successivi →
          </span>
        )}
        {page < pageCount ? (
          <Link
            className="btn btn-secondary"
            href={href(forwardJump)}
            aria-label={`Avanti di al massimo ${PAGE_JUMP} pagine`}
          >
            +{PAGE_JUMP}
          </Link>
        ) : (
          <span className={`btn btn-secondary ${styles.paginationDisabled}`} aria-disabled="true">
            +{PAGE_JUMP}
          </span>
        )}
        {page < pageCount ? (
          <Link className="btn btn-secondary" href={href(pageCount)}>
            Ultima
          </Link>
        ) : (
          <span className={`btn btn-secondary ${styles.paginationDisabled}`} aria-disabled="true">
            Ultima
          </span>
        )}
      </div>
      <form action="/appalti/operatori" method="get" className={styles.pageJump}>
        <input type="hidden" name="vista" value="elenco" />
        {byValue ? <input type="hidden" name="ordine" value="valore" /> : null}
        <label htmlFor="operatori-page">
          Vai a pagina
          <span className={styles.pageJumpHint}>
            {" "}
            (tra {integer(jumpMin)} e {integer(jumpMax)}; oppure usa Ultima)
          </span>
        </label>
        <input
          className="input"
          id="operatori-page"
          name="page"
          type="number"
          inputMode="numeric"
          min={jumpMin}
          max={jumpMax}
          step={1}
          defaultValue={page}
          required
        />
        <button className="btn btn-secondary" type="submit">
          Vai
        </button>
      </form>
    </nav>
  );
}

function OperatorHits({
  hits,
  ranked = false,
  rankOffset = 0,
}: Readonly<{
  hits: readonly AnacOperatorSearchHit[];
  ranked?: boolean;
  rankOffset?: number;
}>) {
  return (
    <ol className={styles.hits} aria-label={ranked ? "Elenco operatori ANAC" : "Risultati imprese aggiudicatarie"}>
      {hits.map((hit, index) => {
        return (
          <li key={hit.ref} className={styles.hit}>
            <h3>
              {ranked ? (
                <span className={styles.rank} aria-hidden="true">
                  #{rankOffset + index + 1}{" "}
                </span>
              ) : null}
              <Link href={`/appalti/operatori/${hit.ref}`}>{hit.name}</Link>
            </h3>
            <div className={styles.hitMeta}>
              <span>
                Quante volte risulta aggiudicataria: <strong>{integer(hit.awardCount)}</strong>
              </span>
              <span>
                Valore di aggiudicazione attribuibile:{" "}
                <strong>{formatDecimalEuro(hit.attributedValue)}</strong>
              </span>
              <span>Anni osservati: {yearRange(hit.yearMin, hit.yearMax)}</span>
            </div>
            <p className={styles.note}>
              <Link href={`/appalti/operatori/${hit.ref}`}>Scheda e CIG recenti</Link>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function SummaryIntro({
  metaTotals,
  summaries,
}: Readonly<{
  metaTotals: ReturnType<typeof loadAnacOperatorIndexMeta>["totals"];
  summaries: AnacOperatorNationalSummaries;
}>) {
  const attributed = Number(metaTotals.attributedValue);
  return (
    <>
      <div className={`stat-strip ${styles.stats}`} aria-label="Numeri chiave dell'indice">
        <div>
          <span className="stat-label">Imprese nell&apos;indice</span>
          <strong className="stat-value">{integer(metaTotals.operators)}</strong>
          <span className="stat-note">con codice fiscale valido nello snapshot ANAC</span>
        </div>
        <div>
          <span className="stat-label">Volte in cui risultano aggiudicatarie</span>
          <strong className="stat-value">{integer(metaTotals.awardRelations)}</strong>
          <span className="stat-note">coppie CIG + aggiudicazione collegate a un&apos;impresa</span>
        </div>
        <div>
          <span className="stat-label">Valore di aggiudicazione attribuibile</span>
          <strong className="stat-value">
            {Number.isFinite(attributed) ? compactEuroLike(attributed, attributed) : "n.d."}
          </strong>
          <span className="stat-note">
            solo quando c&apos;è un unico aggiudicatario · {formatDecimalEuro(metaTotals.attributedValue)}{" "}
            esatti
          </span>
        </div>
        <div>
          <span className="stat-label">CIG con dettaglio procedura</span>
          <strong className="stat-value">
            {integer(summaries.coverage.uniqueMatchedCigsCounted)}
          </strong>
          <span className="stat-note">
            su aggiudicazioni pubblicate in scheda (oggetto, CPV, stazione)
          </span>
        </div>
      </div>

      <aside className={`notice ${styles.glossary}`} aria-labelledby="operatori-glossary">
        <h2 id="operatori-glossary">Come leggere questi numeri</h2>
        <ul>
          <li>
            <strong>Aggiudicataria</strong> = impresa risultata assegnataria in ANAC. Non significa
            automaticamente che abbia incassato quei soldi.
          </li>
          <li>
            <strong>Valore attribuibile</strong> = somma degli importi di{" "}
            <em>aggiudicazione dichiarata</em> solo quando c&apos;è un unico operatore. Con più
            aggiudicatarie sullo stesso CIG il conteggio resta, l&apos;importo non viene spartito.
          </li>
          <li>
            <strong>Categoria CPV / stazione / oggetto</strong> = campi della procedura CIG ANAC,
            contati una volta per ogni CIG abbinato tra le aggiudicazioni mostrate in scheda.
          </li>
          <li>
            Le classifiche descrivono ricorrenze nello snapshot:{" "}
            <strong>non sono giudizi, illeciti o ranking di affidabilità</strong>.
          </li>
        </ul>
      </aside>
    </>
  );
}

function shareOfMax(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function shortName(name: string, max = 48): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1).trimEnd()}…`;
}

function RankingPanel({
  id,
  title,
  lead,
  tag,
  ariaLabel,
  wide = false,
  children,
  exactTable,
}: Readonly<{
  id: string;
  title: string;
  lead: string;
  tag: string;
  ariaLabel: string;
  wide?: boolean;
  children: ReactNode;
  exactTable: ReactNode;
}>) {
  return (
    <article
      className={`panel ${styles.rankingPanel} ${wide ? styles.rankingPanelWide : ""}`}
      aria-labelledby={id}
    >
      <div className={styles.rankingHead}>
        <div>
          <h3 id={id} className="panel-title">
            {title}
          </h3>
          <p className={styles.summaryLead}>{lead}</p>
        </div>
        <span className="tag tag-neutral">{tag}</span>
      </div>
      <ol className={styles.barList} aria-label={ariaLabel}>
        {children}
      </ol>
      <details className={styles.exactDetails}>
        <summary>Apri la tabella con i numeri esatti</summary>
        {exactTable}
      </details>
    </article>
  );
}

function OperatorSummaryTables({
  summaries,
}: Readonly<{ summaries: AnacOperatorNationalSummaries }>) {
  const chartLimit = 10;
  const valueReference = Math.max(
    ...summaries.topOperatorsByAttributedValue.map((row) => Number(row.attributedValue) || 0),
    1,
  );
  const matched = summaries.coverage.uniqueMatchedCigsCounted;
  const countMax = summaries.topOperatorsByAwardCount[0]?.awardCount ?? 1;
  const valueMax = Number(summaries.topOperatorsByAttributedValue[0]?.attributedValue) || 1;
  const cpvMax = summaries.topCpv[0]?.count ?? 1;
  const saMax = summaries.topContractingAuthorities[0]?.count ?? 1;
  const oggettoMax = summaries.topProcedureObjects[0]?.count ?? 1;

  const countChart = summaries.topOperatorsByAwardCount.slice(0, chartLimit);
  const valueChart = summaries.topOperatorsByAttributedValue.slice(0, chartLimit);
  const cpvChart = summaries.topCpv.slice(0, chartLimit);
  const saChart = summaries.topContractingAuthorities.slice(0, chartLimit);
  const oggettoChart = summaries.topProcedureObjects.slice(0, chartLimit);

  return (
    <section className={styles.summaries} aria-labelledby="operatori-summaries-title">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="operatori-summaries-title">Cosa compare più spesso</h2>
          <p className={styles.note}>
            Nei grafici vedi le prime {integer(chartLimit)} posizioni (barra = confronto col primo).
            Nelle tabelle restano tutte le {integer(summaries.basis.limit)}. Fonte: full snapshot
            aggiudicatari/aggiudicazioni + CIG 2007-2025.
          </p>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <RankingPanel
          id="top-count-title"
          title="Imprese con più aggiudicazioni"
          lead="Quante volte l'impresa risulta aggiudicataria nello snapshot. Non è un giudizio: è solo la frequenza osservata."
          tag={`Top ${chartLimit} · conteggio`}
          ariaLabel="Classifica imprese per numero di aggiudicazioni"
          exactTable={
            <ScrollRegion
              className={`table-scroll ${styles.tableScroll}`}
              role="region"
              aria-label="Tabella imprese per numero di aggiudicazioni"
              tabIndex={0}
            >
              <table className="table">
                <caption>Top per numero di aggiudicazioni osservate</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Impresa</th>
                    <th scope="col" className="num">
                      Aggiudicazioni
                    </th>
                    <th scope="col" className="num">
                      Valore attribuibile
                    </th>
                    <th scope="col">Anni</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.topOperatorsByAwardCount.map((row, index) => (
                    <tr key={row.ref}>
                      <td className="num">{integer(index + 1)}</td>
                      <th scope="row">
                        <Link href={`/appalti/operatori/${row.ref}`}>{row.name}</Link>
                      </th>
                      <td className="num">{integer(row.awardCount)}</td>
                      <td className="num" title={formatDecimalEuro(row.attributedValue)}>
                        {formatCompactEuro(row.attributedValue, valueReference)}
                      </td>
                      <td>{yearRange(row.yearMin, row.yearMax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          }
        >
          {countChart.map((row, index) => (
            <li key={row.ref}>
              <div className={styles.barMeta}>
                <Link href={`/appalti/operatori/${row.ref}`} title={row.name}>
                  {shortName(row.name)}
                </Link>
                <strong>
                  {integer(row.awardCount)}
                  <small> aggiudicazioni</small>
                  <span className={styles.barAmount}>
                    {formatCompactEuro(row.attributedValue, valueReference)}
                    <small> attribuibili</small>
                  </span>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i style={{ width: `${shareOfMax(row.awardCount, countMax)}%` }} />
              </div>
              <span className={styles.barRank}>#{index + 1}</span>
            </li>
          ))}
        </RankingPanel>

        <RankingPanel
          id="top-value-title"
          title="Imprese con più valore attribuibile"
          lead="Somma degli importi di aggiudicazione dichiarati solo quando c'è un unico aggiudicatario. Non è denaro ricevuto."
          tag={`Top ${chartLimit} · valore`}
          ariaLabel="Classifica imprese per valore attribuibile"
          exactTable={
            <ScrollRegion
              className={`table-scroll ${styles.tableScroll}`}
              role="region"
              aria-label="Tabella imprese per valore attribuibile"
              tabIndex={0}
            >
              <table className="table">
                <caption>Top per valore di aggiudicazione attribuibile</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Impresa</th>
                    <th scope="col" className="num">
                      Valore attribuibile
                    </th>
                    <th scope="col" className="num">
                      Aggiudicazioni
                    </th>
                    <th scope="col">Anni</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.topOperatorsByAttributedValue.map((row, index) => (
                    <tr key={row.ref}>
                      <td className="num">{integer(index + 1)}</td>
                      <th scope="row">
                        <Link href={`/appalti/operatori/${row.ref}`}>{row.name}</Link>
                      </th>
                      <td className="num" title={formatDecimalEuro(row.attributedValue)}>
                        {formatCompactEuro(row.attributedValue, valueReference)}
                      </td>
                      <td className="num">{integer(row.awardCount)}</td>
                      <td>{yearRange(row.yearMin, row.yearMax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          }
        >
          {valueChart.map((row, index) => {
            const value = Number(row.attributedValue) || 0;
            return (
              <li key={row.ref}>
                <div className={styles.barMeta}>
                  <Link href={`/appalti/operatori/${row.ref}`} title={row.name}>
                    {shortName(row.name)}
                  </Link>
                  <strong>
                    <span title={formatDecimalEuro(row.attributedValue)}>
                      {formatCompactEuro(row.attributedValue, valueReference)}
                    </span>
                    <span className={styles.barAmount}>
                      {integer(row.awardCount)}
                      <small> aggiudicazioni</small>
                    </span>
                  </strong>
                </div>
                <div className={styles.barTrack} aria-hidden="true">
                  <i style={{ width: `${shareOfMax(value, valueMax)}%` }} />
                </div>
                <span className={styles.barRank}>#{index + 1}</span>
              </li>
            );
          })}
        </RankingPanel>

        <RankingPanel
          id="top-cpv-title"
          title="Categorie di lavoro più frequenti"
          lead={`Etichette CPV sui ${integer(matched)} CIG unici abbinati alle aggiudicazioni pubblicate in scheda.`}
          tag="Top 10 · CPV"
          ariaLabel="Classifica categorie CPV"
          exactTable={
            <ScrollRegion
              className={`table-scroll ${styles.tableScroll}`}
              role="region"
              aria-label="Tabella categorie CPV ricorrenti"
              tabIndex={0}
            >
              <table className="table">
                <caption>Top categorie CPV per numero di CIG</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Categoria</th>
                    <th scope="col">Codice</th>
                    <th scope="col" className="num">
                      CIG
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.topCpv.map((row, index) => (
                    <tr key={`${row.code ?? "x"}-${row.label}`}>
                      <td className="num">{integer(index + 1)}</td>
                      <th scope="row">{row.label}</th>
                      <td>
                        <code>{row.code ?? "-"}</code>
                      </td>
                      <td className="num">{integer(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          }
        >
          {cpvChart.map((row, index) => (
            <li key={`${row.code ?? "x"}-${row.label}`}>
              <div className={styles.barMeta}>
                <span title={row.code ? `${row.label} (${row.code})` : row.label}>
                  {shortName(row.label, 56)}
                  {row.code ? <small className={styles.barCode}> · {row.code}</small> : null}
                </span>
                <strong>
                  {integer(row.count)}
                  <small> CIG</small>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i style={{ width: `${shareOfMax(row.count, cpvMax)}%` }} />
              </div>
              <span className={styles.barRank}>#{index + 1}</span>
            </li>
          ))}
        </RankingPanel>

        <RankingPanel
          id="top-sa-title"
          title="Chi bandisce più spesso"
          lead="Denominazione della stazione appaltante nei CIG abbinati (campo ANAC, non il registro enti completo)."
          tag="Top 10 · stazioni"
          ariaLabel="Classifica stazioni appaltanti"
          exactTable={
            <ScrollRegion
              className={`table-scroll ${styles.tableScroll}`}
              role="region"
              aria-label="Tabella stazioni appaltanti ricorrenti"
              tabIndex={0}
            >
              <table className="table">
                <caption>Top stazioni appaltanti per numero di CIG</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Stazione appaltante</th>
                    <th scope="col" className="num">
                      CIG
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.topContractingAuthorities.map((row, index) => (
                    <tr key={row.label}>
                      <td className="num">{integer(index + 1)}</td>
                      <th scope="row">{row.label}</th>
                      <td className="num">{integer(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          }
        >
          {saChart.map((row, index) => (
            <li key={row.label}>
              <div className={styles.barMeta}>
                <span title={row.label}>{shortName(row.label, 56)}</span>
                <strong>
                  {integer(row.count)}
                  <small> CIG</small>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i style={{ width: `${shareOfMax(row.count, saMax)}%` }} />
              </div>
              <span className={styles.barRank}>#{index + 1}</span>
            </li>
          ))}
        </RankingPanel>

        <RankingPanel
          id="top-oggetto-title"
          title="Oggetti di gara più ripetuti"
          lead="Testo oggetto del CIG ripetuto alla lettera. Esclude etichette vuote o non pubblicabili in fonte."
          tag="Top 10 · oggetti"
          ariaLabel="Classifica oggetti di gara"
          wide
          exactTable={
            <ScrollRegion
              className={`table-scroll ${styles.tableScroll}`}
              role="region"
              aria-label="Tabella oggetti di gara ricorrenti"
              tabIndex={0}
            >
              <table className="table">
                <caption>Top oggetti procedura per numero di CIG</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Oggetto (testo ANAC)</th>
                    <th scope="col" className="num">
                      CIG
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.topProcedureObjects.map((row, index) => (
                    <tr key={`${row.label}-${row.count}`}>
                      <td className="num">{integer(index + 1)}</td>
                      <th scope="row">{row.label}</th>
                      <td className="num">{integer(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          }
        >
          {oggettoChart.map((row, index) => (
            <li key={`${row.label}-${row.count}`}>
              <div className={styles.barMeta}>
                <span title={row.label}>{shortName(row.label, 72)}</span>
                <strong>
                  {integer(row.count)}
                  <small> CIG</small>
                </strong>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <i style={{ width: `${shareOfMax(row.count, oggettoMax)}%` }} />
              </div>
              <span className={styles.barRank}>#{index + 1}</span>
            </li>
          ))}
        </RankingPanel>
      </div>
    </section>
  );
}


function SearchSection({
  result,
  operatorsTotal,
  showResults,
}: Readonly<{
  result: ReturnType<typeof searchAnacOperators>;
  operatorsTotal: number;
  showResults: boolean;
}>) {
  return (
    <section aria-labelledby="operatori-search-title">
      <h2 id="operatori-search-title">Cerca un&apos;impresa per nome</h2>
      <form action="/appalti/operatori" method="get" className={styles.search}>
        <div>
          <label htmlFor="operatori-query">Nome impresa</label>
          <input
            className="input"
            id="operatori-query"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={result.query}
            placeholder="Es. costruzioni oppure autostrade"
            autoComplete="off"
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Cerca
        </button>
        {result.query ? <Link href="/appalti/operatori">Azzera</Link> : null}
      </form>
      <p className={styles.results} role="status">
        {!result.query
          ? `Filtra i ${integer(operatorsTotal)} operatori (almeno ${ANAC_OPERATOR_INDEX.minQueryLength} caratteri).`
          : result.normalizedQuery.length < ANAC_OPERATOR_INDEX.minQueryLength
            ? `Servono almeno ${ANAC_OPERATOR_INDEX.minQueryLength} caratteri alfanumerici dopo la normalizzazione.`
            : result.matched === 0
              ? "Nessuna impresa corrisponde alla ricerca in questo indice."
              : `${integer(Math.min(result.hits.length, result.limit))} di ${integer(result.matched)} corrispondenze.`}
      </p>
      {showResults ? <OperatorHits hits={result.hits} /> : null}
    </section>
  );
}

export default async function OperatoriPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const meta = loadAnacOperatorIndexMeta();
  const summaries = loadAnacOperatorNationalSummaries();
  const query = first(search.q);
  const ordine = first(search.ordine);
  const showList = first(search.vista) === "elenco" && !query;
  const result = searchAnacOperators({ q: query, limit: 50 });
  const showSearch = result.normalizedQuery.length >= ANAC_OPERATOR_INDEX.minQueryLength;
  const listing = showList
    ? listAnacOperatorsPage({ by: ordine || "awardCount", page: first(search.page) })
    : null;
  const byValue = listing?.rankBy === "attributedValue";

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link href="/appalti">Appalti pubblici</Link>
        {showList ? (
          <>
            {" "}
            / <Link href="/appalti/operatori">Imprese aggiudicatarie</Link> / Elenco completo
          </>
        ) : (
          <> / Imprese aggiudicatarie</>
        )}
      </nav>
      <div className="page-intro">
        <p className={styles.eyebrow}>Full snapshot ANAC · aggiudicatari, aggiudicazioni e CIG</p>
        <h1>{showList ? "Elenco completo delle imprese" : "Imprese aggiudicatarie"}</h1>
        <p>
          {showList
            ? "Tutte le imprese con CF valido nello snapshot, ordinate per conteggio o valore attribuibile."
            : "Prima le classifiche più leggibili (imprese, categorie, stazioni, oggetti). Poi puoi aprire l’elenco completo o cercare una denominazione. Non è la pagina "}
          {showList ? null : <Link href="/imprese">Atlante imprese</Link>}
          {showList ? null : " (aggregati CCIAA/ISTAT)."}
        </p>
      </div>

      {!showList ? (
        <>
          <SummaryIntro metaTotals={meta.totals} summaries={summaries} />
          <OperatorSummaryTables summaries={summaries} />
          <section className={styles.listCta} aria-labelledby="operatori-list-cta">
            <h2 id="operatori-list-cta">Vuoi scorrere tutte le imprese?</h2>
            <p>
              L&apos;elenco nazionale ha {integer(meta.totals.operators)} operatori su{" "}
              {integer(Math.ceil(meta.totals.operators / ANAC_OPERATOR_INDEX.defaultPageSize))}{" "}
              pagine. Le tabelle sopra mostrano solo le prime posizioni.
            </p>
            <Link className="btn btn-primary" href={listHref({ vista: "elenco" })}>
              Vai all&apos;elenco completo
            </Link>
          </section>
          <SearchSection
            result={result}
            operatorsTotal={meta.totals.operators}
            showResults={showSearch}
          />
        </>
      ) : null}

      {showList && listing ? (
        <section aria-labelledby="operatori-list-title">
          <div className={styles.sectionHead}>
            <div>
              <h2 id="operatori-list-title">Tutti gli operatori</h2>
              <p className={styles.note}>
                Pagina {integer(listing.page)} di {integer(listing.pageCount)} ·{" "}
                {integer(listing.hits.length)} imprese mostrate su {integer(listing.total)} · ordine{" "}
                {byValue ? "per valore attribuibile" : "per numero di aggiudicazioni"}.{" "}
                <Link href="/appalti/operatori">Torna alle tabelle riassuntive</Link>
              </p>
            </div>
            <div className={styles.rankSwitch} role="group" aria-label="Ordine dell'elenco">
              <Link
                className={!byValue ? styles.rankSwitchActive : undefined}
                href={listHref({ vista: "elenco", page: 1 })}
                aria-current={!byValue ? "page" : undefined}
              >
                Per conteggio
              </Link>
              <Link
                className={byValue ? styles.rankSwitchActive : undefined}
                href={listHref({ vista: "elenco", ordine: "valore", page: 1 })}
                aria-current={byValue ? "page" : undefined}
              >
                Per valore
              </Link>
            </div>
          </div>
          <OperatorHits
            hits={listing.hits}
            ranked
            rankOffset={(listing.page - 1) * listing.pageSize}
          />
          <OperatorPagination page={listing.page} pageCount={listing.pageCount} byValue={byValue} />
        </section>
      ) : null}

      {showList ? (
        <SearchSection
          result={result}
          operatorsTotal={meta.totals.operators}
          showResults={false}
        />
      ) : null}

      <section className="panel" aria-labelledby="operatori-source-title">
        <h2 id="operatori-source-title">Fonte e limiti</h2>
        <p>
          ANAC Open Data: full snapshot aggiudicatari e aggiudicazioni (CC BY-SA 4.0), arricchiti con
          i campi procedura dei CIG annuali 2007-2025. Snapshot aggiudicatari/aggiudicazioni
          osservato il {meta.observedAt.slice(0, 10)}. Non dichiara una popolazione nazionale
          corrente: i delta mensili successivi non sono sommati. {summaries.basis.note}
        </p>
        <div className={styles.links}>
          <a href="https://dati.anticorruzione.it/opendata/dataset/aggiudicatari">Aggiudicatari ANAC</a>
          <a href="https://dati.anticorruzione.it/opendata/dataset/aggiudicazioni">Aggiudicazioni ANAC</a>
          <a href="https://dati.anticorruzione.it/opendata/dataset?q=cig-+anno&organization=anticorruzione">
            CIG annuali ANAC
          </a>
          <Link href="/appalti">Torna agli appalti 2025</Link>
          <Link href="/enti">Registro enti</Link>
        </div>
      </section>
    </main>
  );
}
