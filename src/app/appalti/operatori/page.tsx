import type { Metadata } from "next";
import Link from "next/link";
import { integer, longDate } from "@/lib/format";
import {
  ANAC_OPERATOR_INDEX,
  listAnacOperatorsPage,
  loadAnacOperatorsByRefs,
  loadAnacOperatorIndexMeta,
  searchAnacOperators,
  type AnacOperatorRecord,
  type AnacOperatorSearchHit,
} from "@/lib/data/anac-operator-awards-index";
import styles from "./operatori.module.css";

export const metadata: Metadata = {
  title: "Imprese aggiudicatarie ANAC",
  description:
    "Elenco e ricerca nazionale storica delle imprese aggiudicatarie nei full snapshot ANAC, con conteggi e importi di aggiudicazione dichiarati.",
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDecimalEuro(value: string | null): string {
  if (value === null) return "n.d.";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function yearRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "anni non disponibili";
  if (min === max) return String(min);
  return `${min ?? "?"}–${max ?? "?"}`;
}

function amountStatusLabel(status: AnacOperatorRecord["awards"][number]["amountStatus"]): string | null {
  switch (status) {
    case "negative":
      return "importo negativo in fonte";
    case "missing":
      return "importo mancante in fonte";
    case "invalid":
      return "importo non valido in fonte";
    case "conflicting":
      return "importo conflittuale in fonte";
    case "zero":
      return "importo zero";
    case "positive-subcent":
      return "centesimi oltre i due decimali";
    default:
      return null;
  }
}

function listHref(options: { ordine?: string; page?: number; q?: string }): string {
  const params = new URLSearchParams();
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
  const href = (target: number) => listHref({ ordine, page: target });
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
  details,
  ranked = false,
  rankOffset = 0,
}: Readonly<{
  hits: readonly AnacOperatorSearchHit[];
  details?: ReadonlyMap<string, AnacOperatorRecord>;
  ranked?: boolean;
  rankOffset?: number;
}>) {
  return (
    <ol className={styles.hits} aria-label={ranked ? "Elenco operatori ANAC" : "Risultati imprese aggiudicatarie"}>
      {hits.map((hit, index) => {
        const detail = details?.get(hit.ref);
        const recent = detail?.awards.slice(0, 3) ?? [];
        return (
          <li key={hit.ref} className={styles.hit}>
            <h3>
              {ranked ? (
                <span className={styles.rank} aria-hidden="true">
                  #{rankOffset + index + 1}
                  {" "}
                </span>
              ) : null}
              <Link href={`/appalti/operatori/${hit.ref}`}>{hit.name}</Link>
            </h3>
            <div className={styles.hitMeta}>
              <span>
                Aggiudicazioni: <strong>{integer(hit.awardCount)}</strong>
              </span>
              <span>
                Valore attribuibile: <strong>{formatDecimalEuro(hit.attributedValue)}</strong>
              </span>
              <span>Periodo osservato: {yearRange(hit.yearMin, hit.yearMax)}</span>
            </div>
            {detail ? (
              <div className={styles.hitDetail}>
                <p>
                  Identità in ANAC: denominazione pubblicata sotto, CF unito solo lato server e non
                  esposto. Nella fonte compaiono <strong>{integer(detail.nameVariants)}</strong>{" "}
                  {detail.nameVariants === 1 ? "variante" : "varianti"} di nome per lo stesso
                  operatore. Di <strong>{integer(detail.awardCount)}</strong> aggiudicazioni
                  collegate, <strong>{integer(detail.attributedAwardCount)}</strong> sono a
                  operatore unico e entrano nel valore attribuibile (
                  {formatDecimalEuro(detail.attributedValue)}).
                </p>
                {detail.topCpv && detail.topCpv.length > 0 ? (
                  <p>
                    CPV ricorrenti nei CIG pubblicati (da snapshot CIG ANAC):{" "}
                    {detail.topCpv
                      .slice(0, 3)
                      .map((item) => `${item.label} (${integer(item.count)})`)
                      .join(" · ")}
                    .
                  </p>
                ) : null}
                {detail.topContractingAuthorities && detail.topContractingAuthorities.length > 0 ? (
                  <p>
                    Stazioni appaltanti ricorrenti (denominazione ANAC):{" "}
                    {detail.topContractingAuthorities
                      .slice(0, 3)
                      .map((item) => `${item.label} (${integer(item.count)})`)
                      .join(" · ")}
                    .
                  </p>
                ) : null}
                {recent.length > 0 ? (
                  <>
                    <p className={styles.hitDetailLabel}>
                      Ultime aggiudicazioni pubblicate (CIG, oggetto procedura da CIG ANAC, importo
                      dichiarato):
                    </p>
                    <ul className={styles.awardPreview}>
                      {recent.map((award) => {
                        const statusNote = amountStatusLabel(award.amountStatus);
                        const procedure = award.procedure?.matched ? award.procedure : null;
                        return (
                        <li key={`${award.cig}-${award.awardId}`}>
                          <span className={styles.cig}>{award.cig}</span>
                          <span>{award.awardedAt ? longDate(award.awardedAt) : "data n.d."}</span>
                          <span>{formatDecimalEuro(award.amount)}</span>
                          <span>
                            {award.attribution === "single-operator"
                              ? "operatore unico"
                              : "multi-operatore"}
                          </span>
                          {statusNote ? <span>{statusNote}</span> : null}
                          {procedure?.oggetto ? (
                            <span className={styles.procedureObject}>{procedure.oggetto}</span>
                          ) : null}
                          {procedure?.contractingAuthority ? (
                            <span>SA: {procedure.contractingAuthority}</span>
                          ) : null}
                          {procedure?.cpvLabel || procedure?.cpvCode ? (
                            <span>
                              CPV: {procedure.cpvLabel ?? procedure.cpvCode}
                            </span>
                          ) : null}
                        </li>
                        );
                      })}
                    </ul>
                    {detail.awardsTruncated || detail.awardCount > recent.length ? (
                      <p className={styles.note}>
                        <Link href={`/appalti/operatori/${hit.ref}`}>
                          Apri la scheda per fino a {ANAC_OPERATOR_INDEX.maxAwardsPublished} CIG
                          recenti
                        </Link>
                        {detail.awardsTruncated
                          ? ` (su ${integer(detail.awardCount)} totali nello snapshot).`
                          : "."}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <p className={styles.note}>
                Solo denominazione e aggiudicazioni dalla fonte.{" "}
                <Link href={`/appalti/operatori/${hit.ref}`}>Apri la scheda</Link> per i CIG
                recenti.
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default async function OperatoriPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const meta = loadAnacOperatorIndexMeta();
  const query = first(search.q);
  const ordine = first(search.ordine);
  const result = searchAnacOperators({ q: query, limit: 50 });
  const showSearch = result.normalizedQuery.length >= ANAC_OPERATOR_INDEX.minQueryLength;
  const listing = showSearch
    ? null
    : listAnacOperatorsPage({ by: ordine || "awardCount", page: first(search.page) });
  const byValue = listing?.rankBy === "attributedValue";
  const detailRefs = showSearch
    ? result.hits.map((hit) => hit.ref)
    : listing?.hits.map((hit) => hit.ref) ?? [];
  const details = loadAnacOperatorsByRefs(detailRefs);

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link href="/appalti">Appalti pubblici</Link> / Imprese aggiudicatarie
      </nav>
      <div className="page-intro">
        <p className={styles.eyebrow}>Full snapshot ANAC · aggiudicatari e aggiudicazioni</p>
        <h1>Imprese aggiudicatarie</h1>
        <p>
          Elenco completo degli operatori con CF valido nello snapshot, ordinabile per conteggio o
          valore attribuibile, più ricerca per denominazione. Non è la pagina{" "}
          <Link href="/imprese">Atlante imprese</Link> (aggregati CCIAA/ISTAT).
        </p>
      </div>

      <div className={`stat-strip ${styles.stats}`} aria-label="Perimetro dell'indice">
        <div>
          <span className="stat-label">Operatori con CF valido</span>
          <strong className="stat-value">{integer(meta.totals.operators)}</strong>
          <span className="stat-note">identità unite solo lato server, senza CF pubblici</span>
        </div>
        <div>
          <span className="stat-label">Aggiudicazioni collegate</span>
          <strong className="stat-value">{integer(meta.totals.awardRelations)}</strong>
          <span className="stat-note">coppie CIG + id aggiudicazione per operatore</span>
        </div>
      </div>

      <aside className="notice" aria-labelledby="operatori-scope">
        <h2 id="operatori-scope">Che cosa stai leggendo</h2>
        <p>
          L&apos;importo è di <strong>aggiudicazione dichiarata</strong>, non un pagamento né un
          &quot;incassato&quot;. Mostriamo denominazione, conteggi, valori e CIG osservati. La
          classifica non indica illeciti.
        </p>
      </aside>

      {!showSearch && listing ? (
        <section aria-labelledby="operatori-list-title">
          <div className={styles.sectionHead}>
            <div>
              <h2 id="operatori-list-title">Tutti gli operatori</h2>
              <p className={styles.note}>
                Pagina {integer(listing.page)} di {integer(listing.pageCount)} ·{" "}
                {integer(listing.hits.length)} imprese mostrate su {integer(listing.total)} · ordine{" "}
                {byValue ? "per valore attribuibile" : "per numero di aggiudicazioni"}.
              </p>
            </div>
            <div className={styles.rankSwitch} role="group" aria-label="Ordine dell'elenco">
              <Link
                className={!byValue ? styles.rankSwitchActive : undefined}
                href={listHref({ page: 1 })}
                aria-current={!byValue ? "page" : undefined}
              >
                Per conteggio
              </Link>
              <Link
                className={byValue ? styles.rankSwitchActive : undefined}
                href={listHref({ ordine: "valore", page: 1 })}
                aria-current={byValue ? "page" : undefined}
              >
                Per valore
              </Link>
            </div>
          </div>
          <OperatorHits
            hits={listing.hits}
            details={details}
            ranked
            rankOffset={(listing.page - 1) * listing.pageSize}
          />
          <OperatorPagination page={listing.page} pageCount={listing.pageCount} byValue={byValue} />
        </section>
      ) : null}

      <section aria-labelledby="operatori-search-title">
        <h2 id="operatori-search-title">Cerca per denominazione</h2>
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
            ? `Filtra i ${integer(meta.totals.operators)} operatori (almeno ${ANAC_OPERATOR_INDEX.minQueryLength} caratteri).`
            : result.normalizedQuery.length < ANAC_OPERATOR_INDEX.minQueryLength
              ? `Servono almeno ${ANAC_OPERATOR_INDEX.minQueryLength} caratteri alfanumerici dopo la normalizzazione.`
              : result.matched === 0
                ? "Nessuna impresa corrisponde alla ricerca in questo indice."
                : `${integer(Math.min(result.hits.length, result.limit))} di ${integer(result.matched)} corrispondenze.`}
        </p>
        {showSearch ? <OperatorHits hits={result.hits} details={details} /> : null}
      </section>

      <section className="panel" aria-labelledby="operatori-source-title">
        <h2 id="operatori-source-title">Fonte e limiti</h2>
        <p>
          ANAC Open Data: full snapshot aggiudicatari e aggiudicazioni (CC BY-SA 4.0), arricchiti con
          i campi procedura dei CIG annuali 2007–2025 (oggetto, CPV, stazione appaltante). Snapshot
          aggiudicatari/aggiudicazioni osservato il {meta.observedAt.slice(0, 10)}. Non dichiara una
          popolazione nazionale corrente: i delta mensili successivi non sono sommati.
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
