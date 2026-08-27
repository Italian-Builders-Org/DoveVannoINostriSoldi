import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { compactEuro, integer, longDate } from "@/lib/format";
import {
  PnrrChildcareQueryError,
  pnrrChildcareData,
  pnrrChildcareMeta,
  queryPnrrChildcare,
} from "@/lib/pnrr-childcare-snapshot";
import styles from "./pnrr-asili.module.css";

export const metadata: Metadata = {
  title: "Traccia PNRR · asili e prima infanzia",
  description:
    "Cerca i progetti PNRR per asili, scuole dell’infanzia e servizi educativi: CUP, territori, finanziamenti, gare e aggiudicatari.",
};

const PAGE_SIZE = 24;
type PageParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function numberParam(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function paginationHref(params: PageParams, offset: number): string {
  const query = new URLSearchParams({ offset: String(offset) });
  for (const key of ["q", "regione", "provincia"]) {
    const value = clean(first(params[key]));
    if (value) query.set(key, value);
  }
  return `/coesione/asili?${query.toString()}`;
}

export default async function PnrrChildcareCatalog({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const requested = {
    query: clean(first(params.q)),
    region: clean(first(params.regione)),
    province: clean(first(params.provincia)),
    limit: PAGE_SIZE,
    offset: numberParam(first(params.offset)),
  };
  let error: string | null = null;
  let result: ReturnType<typeof queryPnrrChildcare>;
  try {
    result = queryPnrrChildcare(requested);
  } catch (caught) {
    error = caught instanceof PnrrChildcareQueryError ? caught.message : "Impossibile applicare i filtri.";
    result = queryPnrrChildcare({ limit: PAGE_SIZE });
  }
  const regions = [...new Set(pnrrChildcareData.projects.flatMap((project) => project.locations.map((location) => location.region)))].sort((a, b) => a.localeCompare(b, "it"));
  const previous = Math.max(0, result.pagination.offset - result.pagination.limit);
  const next = result.pagination.offset + result.pagination.limit;

  return (
    <main className="shell page">
      <div className={styles.hero}>
        <div>
          <h1>Da miliardi nazionali a un CUP verificabile</h1>
          <p>
            Cerca un asilo, una scuola dell’infanzia o un servizio educativo. Ogni risultato separa
            finanziamento, gara e aggiudicazione, con il collegamento esatto alla fonte.
          </p>
        </div>
      </div>

      <section className={styles.searchPanel} aria-labelledby="search-title">
        <div className={styles.searchHeading}>
          <div>
            <h2 id="search-title">Parti da un luogo, un ente o un CUP</h2>
          </div>
          <a href="/api/pnrr/asili" className="btn btn-secondary">API aperta</a>
        </div>
        <Form action="/coesione/asili" className={styles.form}>
          <label className={styles.queryField}>
            <span>Ricerca</span>
            <input name="q" defaultValue={clean(first(params.q))} placeholder="Es. Viterbo, Comune di Bari, CUP…" />
          </label>
          <label>
            <span>Regione</span>
            <select name="regione" defaultValue={clean(first(params.regione)) ?? ""}>
              <option value="">Tutte le regioni</option>
              {regions.map((region) => <option key={region}>{region}</option>)}
            </select>
          </label>
          <label>
            <span>Provincia</span>
            <input name="provincia" defaultValue={clean(first(params.provincia))} placeholder="Nome completo" />
          </label>
          <button className="btn btn-primary" type="submit">Segui il denaro</button>
        </Form>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      <p className={styles.archiveScope}>
        <strong>Intero archivio: {integer(pnrrChildcareMeta.coverage.uniqueProjects)} CUP</strong>
        <span aria-hidden="true"> · </span>
        misura {pnrrChildcareMeta.submeasure.code}
        <span aria-hidden="true"> · </span>
        dati al {longDate(pnrrChildcareMeta.referenceDate)}
        <span aria-hidden="true"> · </span>
        <a href={pnrrChildcareMeta.source.landingUrl} target="_blank" rel="noreferrer">
          Fonte Italia Domani ↗
        </a>
      </p>
      <div className={styles.statRail} aria-label="Copertura dell’intero archivio">
        <div><strong>{compactEuro(pnrrChildcareMeta.totals.pnrrFundingCents / 100)}</strong><span>finanziamento PNRR registrato</span></div>
        <div><strong>{integer(pnrrChildcareMeta.coverage.tenderRows)}</strong><span>gare collegate</span></div>
        <div><strong>{integer(pnrrChildcareMeta.coverage.awardeeRows)}</strong><span>righe aggiudicatario</span></div>
        <div><strong>{integer(pnrrChildcareMeta.coverage.municipalities)}</strong><span>Comuni localizzati</span></div>
      </div>

      <section aria-labelledby="results-title">
        <div className={styles.resultsHeading}>
          <div>
            <h2 id="results-title">{integer(result.pagination.total)} progetti trovati</h2>
          </div>
          <p>Ogni scheda è una pista documentale su CUP, finanziamenti, gare e aggiudicatari.</p>
        </div>
        <div className={styles.grid}>
          {result.data.map((project) => {
            const place = project.locations[0];
            return (
              <article className={styles.card} key={project.cup}>
                <div className={styles.cardTop}>
                  <span className={styles.cup}>CUP {project.cup}</span>
                  <span className={project.status.validationOutcome === "Validato" ? styles.valid : styles.review}>
                    {project.status.validationOutcome ?? "Esito non disponibile"}
                  </span>
                </div>
                <h3><Link href={`/progetti/${project.cup}`}>{project.title}</Link></h3>
                <p className={styles.place}>{[place?.municipality, place?.province, place?.region].filter(Boolean).join(" · ")}</p>
                <dl className={styles.cardMetrics}>
                  <div><dt>PNRR finanziato</dt><dd>{project.funding.pnrrCents === null ? "n.d." : compactEuro(project.funding.pnrrCents / 100)}</dd></div>
                  <div><dt>Gare</dt><dd>{integer(project.tenders.length)}</dd></div>
                  <div><dt>Aggiudicatari</dt><dd>{integer(project.awardees.length)}</dd></div>
                </dl>
                <div className={styles.cardFooter}>
                  <span>{project.implementer.name ?? "Soggetto attuatore non disponibile"}</span>
                  <Link href={`/progetti/${project.cup}`} aria-label={`Apri la traccia del CUP ${project.cup}`}>Apri la traccia →</Link>
                </div>
              </article>
            );
          })}
        </div>
        {result.data.length === 0 ? <div className="notice"><strong>Nessun progetto in questo perimetro</strong><p>Prova a rimuovere un filtro o cerca direttamente il CUP.</p></div> : null}
        <nav className={styles.pagination} aria-label="Pagine dei risultati">
          {result.pagination.offset > 0 ? <Link className="btn btn-secondary" href={paginationHref(params, previous)}>← Precedenti</Link> : <span />}
          <span>{result.data.length ? `${integer(result.pagination.offset + 1)} a ${integer(result.pagination.offset + result.data.length)} di ${integer(result.pagination.total)}` : "Nessun progetto in questa pagina"}</span>
          {next < result.pagination.total ? <Link className="btn btn-secondary" href={paginationHref(params, next)}>Successivi →</Link> : <span />}
        </nav>
      </section>

      <div className="notice">
        <strong>Pagamenti e ReGiS</strong>
        <p>
          {pnrrChildcareMeta.methodology.fundingWarning} Il tracciato non contiene i pagamenti ReGiS. Se
          mancano, li segniamo come mancanti: non li stimiamo.
        </p>
      </div>
    </main>
  );
}
