import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { MopBrowseSummaryCharts } from "@/components/charts/mop-browse-summary-charts";
import {
  MopCostPanel,
  optionalMopLookup,
} from "@/components/mop/mop-cost-panel";
import { discoverMopDataset } from "@/lib/bdap-public-works";
import { normalizeCup } from "@/lib/data/bdap-public-works-contract";
import {
  MOP_COMPARABLE_ORDERS,
  getMopComparableMeta,
  getMopComparableSummaries,
  queryMopComparableBrowse,
  type MopComparableListing,
  type MopComparableOrder,
  type MopComparableProgress,
  type MopComparableWork,
} from "@/lib/data/mop-comparable-browse";
import { compactEuro, integer, longDate, percent, shortDate } from "@/lib/format";
import {
  PnrrChildcareQueryError,
  getPnrrChildcareProject,
  pnrrChildcareMeta,
} from "@/lib/pnrr-childcare-snapshot";
import styles from "./opere.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Opere pubbliche · costo previsto e costo effettivo",
  description:
    "Riepilogo e elenco delle opere del Monitoraggio Opere Pubbliche (OpenBDAP) con costo previsto e costo effettivo, avanzamento e filtri per settore.",
};

type PageParams = Record<string, string | string[] | undefined>;

const DISCOVERY_TIMEOUT_MS = 8_000;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function numberParam(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function listHref(params: {
  page?: number;
  ordine?: string;
  settore?: string | null;
  categoria?: string | null;
  stato?: string | null;
  avanzamento?: string | null;
  q?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.ordine && params.ordine !== "deltaAbs") query.set("ordine", params.ordine);
  if (params.settore) query.set("settore", params.settore);
  if (params.categoria) query.set("categoria", params.categoria);
  if (params.stato) query.set("stato", params.stato);
  if (params.avanzamento) query.set("avanzamento", params.avanzamento);
  if (params.q) query.set("q", params.q);
  const encoded = query.toString();
  return encoded ? `/opere?${encoded}` : "/opere";
}

async function loadDiscovery() {
  return discoverMopDataset({
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  }).catch(() => null);
}

function tryComparableListing(input: {
  q?: string;
  sector?: string;
  category?: string;
  status?: string;
  progress?: string;
  order?: string;
  page?: number;
}): MopComparableListing | null {
  try {
    return queryMopComparableBrowse({
      q: input.q,
      sector: input.sector,
      category: input.category,
      status: input.status,
      progress: input.progress,
      order: input.order as MopComparableOrder | undefined,
      page: input.page,
    });
  } catch {
    return null;
  }
}

function tryComparableMeta() {
  try {
    return getMopComparableMeta();
  } catch {
    return null;
  }
}

function tryComparableSummaries() {
  try {
    return getMopComparableSummaries();
  } catch {
    return null;
  }
}

function deltaLabel(changeBasisPoints: number): string {
  const share = changeBasisPoints / 100;
  if (share === 0) return "uguale al previsto";
  if (share > 0) return `+${percent(share)}`;
  return `-${percent(Math.abs(share))}`;
}

function orderLabel(order: MopComparableOrder): string {
  if (order === "planned") return "costo previsto";
  if (order === "actual") return "costo effettivo";
  return "scostamento assoluto";
}

function progressLabel(progress: MopComparableProgress): string {
  if (progress === "in-corso") return "In corso";
  if (progress === "concluso") return "Concluso";
  return "Non determinato";
}

function formatIsoDay(value: string): string {
  // Date-only ISO strings stay calendar-stable (no UTC midnight shift).
  return shortDate(`${value}T12:00:00`);
}

function formatSchedule(start: string | null, end: string | null): string {
  if (!start && !end) return "non dichiarate";
  if (start && end) return `${formatIsoDay(start)} → ${formatIsoDay(end)}`;
  if (start) return `da ${formatIsoDay(start)}`;
  return `fino a ${formatIsoDay(end!)}`;
}

export default async function OperePage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const rawCup = clean(first(params.cup));
  const q = clean(first(params.q));
  const settore = clean(first(params.settore));
  const categoria = clean(first(params.categoria));
  const stato = clean(first(params.stato));
  const avanzamento = clean(first(params.avanzamento));
  const ordine = clean(first(params.ordine));
  const page = numberParam(first(params.page));

  let cupError: string | null = null;
  let cup: string | null = null;
  if (rawCup) {
    try {
      cup = normalizeCup(rawCup);
    } catch (error) {
      cupError = error instanceof Error ? error.message : "CUP non valido.";
    }
  }

  const comparableMeta = tryComparableMeta();
  const summaries = tryComparableSummaries();
  const listing = tryComparableListing({
    q,
    sector: settore,
    category: categoria,
    status: stato,
    progress: avanzamento,
    order: ordine,
    page,
  });
  const discovery = !cup ? await loadDiscovery() : null;
  const mop = cup ? await optionalMopLookup(cup) : null;

  let pnrrLink: { cup: string; title: string } | null = null;
  if (cup) {
    try {
      const project = getPnrrChildcareProject(cup);
      if (project) pnrrLink = { cup: project.cup, title: project.title };
    } catch (error) {
      if (!(error instanceof PnrrChildcareQueryError)) throw error;
    }
  }

  const comparableWorks =
    mop?.works.filter(
      (work) => work.costs.plannedTotalCents > 0 && work.costs.actualTotalCents > 0,
    ).length ?? 0;

  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/coesione">Fondi e progetti</Link>
        <span>/</span>
        <strong>Opere pubbliche</strong>
      </nav>

      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            OpenBDAP · Monitoraggio Opere Pubbliche (spesso chiamato MOP)
          </p>
          <h1>Costo previsto e costo effettivo delle opere pubbliche</h1>
          <p>
            Elenco diretto delle opere confrontabili. Molte sono ancora in corso:
            in quel caso lo scostamento previsto/effettivo non è un bilancio
            finale. Non c’è filtro regione: le colonne ufficiali MOP non lo
            pubblicano.
          </p>
        </div>
        <div className={styles.heroActions}>
          <a
            className="btn btn-secondary"
            href="https://bdap-opendata.rgs.mef.gov.it/content/progetti-opere-pubbliche-mop-totale"
            target="_blank"
            rel="noreferrer"
          >
            Fonte ufficiale ↗
          </a>
        </div>
      </header>

      {!cup ? (
        <section className={styles.limits} aria-labelledby="limits-title">
          <div className={styles.sectionHeading}>
            <h2 id="limits-title">Perimetro fact-checked</h2>
            <p>
              Pubblichiamo solo il sottoinsieme confrontabile acquisito (previsto
              e effettivo entrambi &gt; 0). Non inventiamo medie sull’universo
              nazionale intero.
            </p>
          </div>
          <div className={styles.factGrid}>
            <article>
              <span>Opere in elenco</span>
              <strong>
                {comparableMeta
                  ? integer(comparableMeta.coverage.publishedWorks)
                  : "non disponibile"}
              </strong>
              <small>Solo previsto e effettivo entrambi &gt; 0</small>
            </article>
            <article>
              <span>CUP distinti nella fonte live</span>
              <strong>
                {discovery
                  ? integer(discovery.schema.cupCardinality)
                  : comparableMeta
                    ? integer(comparableMeta.coverage.sourceCupCardinality)
                    : "non disponibile ora"}
              </strong>
              <small>Cardinalità ufficiale OpenBDAP</small>
            </article>
            <article>
              <span>Data di riferimento fonte</span>
              <strong>
                {comparableMeta
                  ? longDate(`${comparableMeta.referenceDate}T00:00:00Z`)
                  : discovery
                    ? longDate(`${discovery.metadata.referenceDate}T00:00:00Z`)
                    : "non disponibile ora"}
              </strong>
              <small>Dal metadato dichiarato da OpenBDAP</small>
            </article>
            <article>
              <span>PNRR asili (join CUP)</span>
              <strong>{integer(pnrrChildcareMeta.coverage.uniqueProjects)} CUP</strong>
              <small>Collegamento esatto se il CUP coincide</small>
            </article>
          </div>
        </section>
      ) : null}

      {summaries && !cup ? (
        <section className={styles.summary} aria-labelledby="summary-title">
          <div className={styles.sectionHeading}>
            <h2 id="summary-title">Riepilogo dello snapshot</h2>
            <p>
              Prima i grafici sul sottoinsieme locale, poi l’elenco completo da
              sfogliare. Un’opera in corso può avere costi effettivi ancora
              provvisori.
            </p>
          </div>
          <MopBrowseSummaryCharts
            sectors={summaries.sectors}
            progress={summaries.progress}
          />
        </section>
      ) : null}

      {listing && !cup ? (
        <section className={styles.browse} aria-labelledby="browse-title">
          <div className={styles.sectionHeading}>
            <h2 id="browse-title">Elenco opere confrontabili</h2>
            <p>
              {integer(listing.total)} opere nello snapshot
              {comparableMeta
                ? ` · acquisito il ${longDate(comparableMeta.observedAt)}`
                : ""}
              . Filtra qui sotto; la ricerca CUP live è più in basso.
            </p>
          </div>
          <ComparableBrowse listing={listing} />
        </section>
      ) : null}

      {!listing && !cup ? (
        <div className="notice">
          <strong>Elenco offline non disponibile</strong>
          <p>
            Manca lo snapshot confrontabile in questo checkout. Resta la ricerca
            CUP live sotto.
          </p>
        </div>
      ) : null}

      <section className={styles.searchPanel} aria-labelledby="search-title">
        <div className={styles.searchHeading}>
          <div>
            <h2 id="search-title">Cerca un CUP live su OpenBDAP</h2>
            <p>
              Interrogazione diretta, anche fuori dallo snapshot. Non sostituisce
              l’elenco sopra: serve per un CUP specifico.
            </p>
          </div>
        </div>
        <Form action="/opere" className={styles.form}>
          <label className={styles.queryField}>
            <span>CUP</span>
            <input
              name="cup"
              defaultValue={rawCup ?? ""}
              placeholder="Es. F81H92000000008"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="btn" type="submit">
            Confronta live
          </button>
        </Form>
        {cupError ? (
          <div className="notice">
            <strong>CUP non accettato</strong>
            <p>{cupError}</p>
          </div>
        ) : null}
        {cup ? (
          <p className={styles.bridge}>
            <Link href="/opere">Torna all’elenco e ai grafici</Link>
          </p>
        ) : null}
      </section>

      {cup && !cupError ? (
        <section className={`panel ${styles.result}`} aria-labelledby="result-title">
          <div className={styles.sectionHeading}>
            <h2 id="result-title">Risultato live per {cup}</h2>
            <p>
              {mop && mop.count > 0
                ? `${integer(mop.count)} opere · ${integer(comparableWorks)} confrontabili`
                : "Esito del controllo live sotto."}
            </p>
          </div>
          {pnrrLink ? (
            <p className={styles.bridge}>
              Anche in{" "}
              <Link href={`/progetti/${pnrrLink.cup}`}>PNRR asili · {pnrrLink.title}</Link>
            </p>
          ) : null}
          <Suspense fallback={<p>Controllo CUP in corso su OpenBDAP…</p>}>
            <MopCostPanel cup={cup} initial={mop} />
          </Suspense>
        </section>
      ) : null}
    </main>
  );
}

function ComparableBrowse({ listing }: { listing: MopComparableListing }) {
  const { filters, order, meta } = listing;

  return (
    <>
      <Form action="/opere" className={styles.browseForm}>
        <label>
          <span>Filtra elenco</span>
          <input name="q" defaultValue={filters.q ?? ""} placeholder="CUP, titolo, titolare…" />
        </label>
        <label>
          <span>Settore</span>
          <select name="settore" defaultValue={filters.sector ?? ""}>
            <option value="">Tutti i settori</option>
            {meta.facets.sectors.map((facet) => (
              <option key={facet.label} value={facet.label}>
                {facet.label} ({integer(facet.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Categoria</span>
          <select name="categoria" defaultValue={filters.category ?? ""}>
            <option value="">Tutte le categorie</option>
            {meta.facets.categories.map((facet) => (
              <option key={facet.label} value={facet.label}>
                {facet.label} ({integer(facet.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Avanzamento</span>
          <select name="avanzamento" defaultValue={filters.progress ?? ""}>
            <option value="">Tutti</option>
            {(meta.facets.progress ?? []).map((facet) => (
              <option key={facet.label} value={facet.label}>
                {progressLabel(facet.label as MopComparableProgress)} ({integer(facet.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Stato MOP</span>
          <select name="stato" defaultValue={filters.status ?? ""}>
            <option value="">Tutti gli stati</option>
            {meta.facets.statuses.map((facet) => (
              <option key={facet.label} value={facet.label}>
                {facet.label} ({integer(facet.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Ordine</span>
          <select name="ordine" defaultValue={order}>
            {MOP_COMPARABLE_ORDERS.map((value) => (
              <option key={value} value={value}>
                {orderLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.browseActions}>
          <button className="btn btn-primary" type="submit">
            Applica filtri
          </button>
        </div>
      </Form>

      <p className={styles.browseStatus} role="status">
        Pagina {integer(listing.page)} di {integer(listing.pageCount)} ·{" "}
        {integer(listing.works.length)} di {integer(listing.total)} opere · ordine per{" "}
        {orderLabel(order)}
      </p>

      <div className={styles.browseList}>
        {listing.works.map((work, index) => {
          const rank = (listing.page - 1) * listing.pageSize + index + 1;
          return <BrowseRow key={work.localCode} work={work} rank={rank} />;
        })}
      </div>

      <nav className={styles.pagination} aria-label="Pagine dell’elenco">
        <Link
          className="btn btn-secondary"
          href={listHref({
            page: Math.max(1, listing.page - 1),
            ordine: order,
            settore: filters.sector,
            categoria: filters.category,
            stato: filters.status,
            avanzamento: filters.progress,
            q: filters.q,
          })}
          aria-disabled={listing.page <= 1}
        >
          Precedente
        </Link>
        <span>
          {integer(listing.page)} / {integer(listing.pageCount)}
        </span>
        <Link
          className="btn btn-secondary"
          href={listHref({
            page: Math.min(listing.pageCount, listing.page + 1),
            ordine: order,
            settore: filters.sector,
            categoria: filters.category,
            stato: filters.status,
            avanzamento: filters.progress,
            q: filters.q,
          })}
          aria-disabled={listing.page >= listing.pageCount}
        >
          Successiva
        </Link>
      </nav>

      <p className={styles.bridge}>
        Fonte: {meta.source.owner} · aggiornamento dichiarato {meta.source.sourceLastUpdate} ·
        licenza {meta.source.license}. {meta.methodology.regions}
        {meta.methodology.ongoingWorks ? ` ${meta.methodology.ongoingWorks}` : ""}
      </p>
    </>
  );
}

function BrowseRow({ work, rank }: { work: MopComparableWork; rank: number }) {
  return (
    <article className={styles.browseRow}>
      <div className={styles.browseRank}>{integer(rank)}</div>
      <div className={styles.browseBody}>
        <div className={styles.browseMeta}>
          <p className={styles.featuredCup}>CUP {work.cup}</p>
          <span
            className={
              work.progress === "in-corso"
                ? "tag tag-accent"
                : work.progress === "concluso"
                  ? "tag tag-neutral"
                  : "tag tag-outline"
            }
          >
            {progressLabel(work.progress)}
          </span>
        </div>
        <h3>{work.description}</h3>
        <p>
          {work.status}
          {work.sector ? ` · ${work.sector}` : ""}
          {work.category ? ` · ${work.category}` : ""}
        </p>
        <p className={styles.browseHolder}>{work.holderName}</p>
        <dl className={styles.schedule}>
          <div>
            <dt>Esecuzione prevista</dt>
            <dd>{formatSchedule(work.plannedExecutionStart, work.plannedExecutionEnd)}</dd>
          </div>
          <div>
            <dt>Esecuzione effettiva</dt>
            <dd>{formatSchedule(work.actualExecutionStart, work.actualExecutionEnd)}</dd>
          </div>
        </dl>
        {work.progress === "in-corso" ? (
          <p className={styles.ongoingNote}>
            Opera in corso: lo scostamento sui costi può ancora cambiare.
          </p>
        ) : null}
      </div>
      <dl className={styles.browseMoney}>
        <div>
          <dt>Previsto</dt>
          <dd>{compactEuro(work.plannedTotalCents / 100)}</dd>
        </div>
        <div>
          <dt>Effettivo</dt>
          <dd>{compactEuro(work.actualTotalCents / 100)}</dd>
        </div>
        <div>
          <dt>Delta</dt>
          <dd>
            {work.deltaCents >= 0 ? "+" : ""}
            {compactEuro(work.deltaCents / 100)}
          </dd>
          <small>{deltaLabel(work.changeBasisPoints)}</small>
        </div>
      </dl>
      <div className={styles.featuredActions}>
        <Link className="btn btn-secondary" href={`/opere?cup=${work.cup}`}>
          Dettaglio live
        </Link>
        <Link className="btn btn-secondary" href={`/progetti/${work.cup}?fonte=mop`}>
          Scheda
        </Link>
      </div>
    </article>
  );
}
