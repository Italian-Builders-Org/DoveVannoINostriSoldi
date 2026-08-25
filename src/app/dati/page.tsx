import type { Metadata } from "next";
import Link from "next/link";
import { integer } from "@/lib/format";
import {
  activeCatalogConstraintCount,
  catalogQueryHref,
  catalogViewHref,
  CATALOG_SEARCH_MAX_LENGTH,
  hasReadableNumbers,
  INTEGRATED_EVIDENCE_LABELS,
  isPriorityDataset,
  matchesCatalogFilters,
  matchesCatalogSearch,
  parseCatalogQuery,
  partitionPriorityCatalog,
  PRIORITY_EVIDENCE_ORDER,
  publicationLabel,
  PUBLICATION_FILTERS,
  relatedReadingForDataset,
  type CatalogFilters,
  type CatalogQuery,
  type CatalogView,
} from "@/lib/integrated-catalog-views";
import { insightCapabilityBadge } from "@/lib/integrated-dataset-insight-core";
import { loadDatasetInsightTeasers } from "@/lib/integrated-dataset-insights";
import { INTEGRATED_DOMAIN_ORDER, integratedDomainLabel } from "@/lib/integrated-domains";
import { getIntegratedDataOverview } from "@/lib/integrated-public-view";
import type { IntegratedEvidenceLabel } from "@/lib/integrated-source-contract";
import styles from "./dati.module.css";

export const metadata: Metadata = {
  title: "Catalogo dei dati integrati",
  description:
    "Destinatari, importi e ricorrenze nei dataset integrati, con i buchi di copertura in secondo piano.",
};

const VIEW_OPTIONS: ReadonlyArray<{ view: CatalogView; label: string }> = [
  { view: "priorita", label: "Da controllare" },
  { view: "ambito", label: "Per ambito" },
  { view: "tutti", label: "Tutti" },
];

type OverviewDataset = Awaited<ReturnType<typeof getIntegratedDataOverview>>["datasets"][number];

function withEvidence(query: CatalogQuery, evidence: IntegratedEvidenceLabel | null): CatalogQuery {
  return { ...query, filters: { ...query.filters, evidence } };
}

function withPublication(
  query: CatalogQuery,
  publication: CatalogFilters["publication"],
): CatalogQuery {
  return { ...query, filters: { ...query.filters, publication } };
}

function withUndeclaredReuse(query: CatalogQuery, undeclaredReuse: boolean): CatalogQuery {
  return { ...query, filters: { ...query.filters, undeclaredReuse } };
}

function DatasetCard({
  dataset,
  teaser,
}: {
  dataset: OverviewDataset;
  teaser?: Readonly<{ line: string; complete: boolean }> | null;
}) {
  const related = relatedReadingForDataset(dataset);
  const evidence = INTEGRATED_EVIDENCE_LABELS[dataset.evidenceLabel];
  const undeclaredReuse = dataset.licenseStatus === "not-declared";
  const numbersBadge = insightCapabilityBadge(dataset.headers, dataset.queryable);
  return (
    <li className={styles.datasetCard}>
      <div className={styles.cardTopline}>
        <span className={`tag ${dataset.queryable ? "tag-accent" : "tag-neutral"}`}>
          {publicationLabel(dataset.publication)}
        </span>
        {numbersBadge ? <span className="tag tag-accent">{numbersBadge}</span> : null}
        {!numbersBadge && isPriorityDataset(dataset) ? (
          <span className="tag tag-accent">{evidence}</span>
        ) : null}
        {!numbersBadge && undeclaredReuse ? (
          <span className="tag tag-outline">Riuso non dichiarato</span>
        ) : null}
      </div>
      <h3>
        <Link href={`/dati/${dataset.id}`}>{dataset.title}</Link>
      </h3>
      <p className={styles.cardCount}>
        <strong>{integer(dataset.queryable ? dataset.publicRows : dataset.sourceRows)}</strong>
        <span>{dataset.queryable ? "righe interrogabili" : "righe sorgente (senza dettaglio)"}</span>
      </p>
      {teaser ? (
        <p className={styles.cardTeaser}>
          <span className={styles.cardTeaserLabel}>
            {teaser.complete ? "Primo destinatario" : "Destinatario in evidenza"}
          </span>
          <strong>{teaser.line}</strong>
        </p>
      ) : (
        <p>
          {numbersBadge
            ? "Apri per vedere i principali destinatari, i servizi ripetuti e le righe."
            : dataset.queryable
              ? dataset.publicationNote
              : "Niente società né importi da scorrere qui: scheda di copertura."}
        </p>
      )}
      <dl className={styles.cardMetadata}>
        <div>
          <dt>Autorità</dt>
          <dd>{dataset.authority}</dd>
        </div>
        <div>
          <dt>Ambito</dt>
          <dd>{integratedDomainLabel(dataset.domain)}</dd>
        </div>
      </dl>
      <Link className={styles.cardLink} href={`/dati/${dataset.id}`}>
        {numbersBadge
          ? "Vedi destinatari e importi →"
          : dataset.queryable
            ? "Apri le righe →"
            : "Apri scheda (senza numeri) →"}
      </Link>
      {related ? (
        <p className={styles.relatedLink}>
          <Link href={related.href}>{related.label} →</Link>
        </p>
      ) : null}
    </li>
  );
}

export default async function IntegratedDataPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string | string[];
    evidenza?: string | string[];
    pubblicazione?: string | string[];
    riuso?: string | string[];
    cerca?: string | string[];
    q?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const query = parseCatalogQuery(params);
  const { view, filters, q } = query;
  const overview = await getIntegratedDataOverview();

  const prioritySplit = partitionPriorityCatalog(overview.datasets, filters);
  const scoped =
    view === "priorita"
      ? [...prioritySplit.readable, ...prioritySplit.missing]
      : overview.datasets;
  const filtered = scoped.filter((dataset) => matchesCatalogFilters(dataset, filters));
  const teaserIds = filtered
    .filter((dataset) => hasReadableNumbers(dataset))
    .map((dataset) => dataset.id);
  const teasers = await loadDatasetInsightTeasers(teaserIds, {
    limit: q ? 48 : 24,
  });

  function datasetMatchesSearch(dataset: OverviewDataset): boolean {
    if (!q) return true;
    return matchesCatalogSearch(dataset, q, {
      domainLabel: integratedDomainLabel(dataset.domain),
      teaserLine: teasers.get(dataset.id)?.line ?? null,
    });
  }

  const visible = filtered.filter(datasetMatchesSearch);
  const readableVisible =
    view === "priorita" ? prioritySplit.readable.filter(datasetMatchesSearch) : [];
  const missingVisible =
    view === "priorita" ? prioritySplit.missing.filter(datasetMatchesSearch) : [];

  const priorityDatasets = overview.datasets.filter(isPriorityDataset);
  const readableCount = overview.datasets.filter((dataset) => hasReadableNumbers(dataset)).length;
  const undeclaredCount = overview.datasets.filter(
    (dataset) => dataset.licenseStatus === "not-declared",
  ).length;
  const constraintCount = activeCatalogConstraintCount(query);

  const grouped = new Map<string, OverviewDataset[]>();
  for (const domain of INTEGRATED_DOMAIN_ORDER) grouped.set(domain, []);
  for (const dataset of visible) {
    grouped.set(dataset.domain, [...(grouped.get(dataset.domain) ?? []), dataset]);
  }
  const domains = [...grouped.entries()]
    .filter(([, datasets]) => datasets.length > 0)
    .map(([domain, datasets]) => ({
      domain,
      label: integratedDomainLabel(domain),
      datasets: [...datasets].sort(
        (left, right) => right.publicRows - left.publicRows || right.sourceRows - left.sourceRows,
      ),
      queryable: datasets.filter((dataset) => dataset.queryable).length,
    }));

  const allDatasets = [...visible].sort((left, right) => {
    const leftScore = hasReadableNumbers(left) ? 0 : isPriorityDataset(left) ? 1 : 2;
    const rightScore = hasReadableNumbers(right) ? 0 : isPriorityDataset(right) ? 1 : 2;
    return leftScore - rightScore || right.publicRows - left.publicRows || right.sourceRows - left.sourceRows;
  });

  const evidenceChipOptions: IntegratedEvidenceLabel[] =
    view === "priorita"
      ? [...PRIORITY_EVIDENCE_ORDER]
      : (Object.keys(INTEGRATED_EVIDENCE_LABELS) as IntegratedEvidenceLabel[]);

  return (
    <main className={`shell page ${styles.page}`}>
      <div className="page-intro">
        <p className={styles.eyebrow}>
          {view === "priorita" ? "Da controllare" : view === "ambito" ? "Per ambito" : "Registro completo"}
        </p>
        <h1>Tutti i dataset integrati</h1>
        <p>
          {view === "priorita"
            ? "Prima i dataset con società e importi da leggere. Poi i buchi di copertura, senza farli sembrare schede piene."
            : view === "ambito"
              ? "Ogni dataset integrato nel suo ambito. Lo stato distingue le righe interrogabili dai materiali solo in catalogo."
              : `Elenco dei ${integer(overview.totals.datasets)} dataset: prima i numeri leggibili, poi le domande di verifica.`}
        </p>
      </div>

      <nav className={styles.viewSwitch} aria-label="Vista del catalogo">
        <span>Vista</span>
        <div>
          {VIEW_OPTIONS.map((option) => (
            <Link
              key={option.view}
              href={catalogViewHref(option.view, filters, q)}
              aria-current={option.view === view ? "page" : undefined}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </nav>

      <section className="stat-strip" aria-label="Copertura del catalogo integrato">
        <div>
          <span className="stat-label">Con numeri leggibili</span>
          <span className="stat-value">{integer(readableCount)}</span>
          <span className="stat-note">destinatario e importo pubblici</span>
        </div>
        <div>
          <span className="stat-label">In questa vista</span>
          <span className="stat-value">{integer(visible.length)}</span>
          <span className="stat-note">
            {constraintCount > 0
              ? `dopo ${integer(constraintCount)} vincoli`
              : "senza filtri aggiuntivi"}
          </span>
        </div>
        <div>
          <span className="stat-label">Segnali senza dettaglio</span>
          <span className="stat-value">{integer(priorityDatasets.filter((d) => !hasReadableNumbers(d)).length)}</span>
          <span className="stat-note">da approfondire altrove</span>
        </div>
        <div>
          <span className="stat-label">Riuso non dichiarato</span>
          <span className="stat-value">{integer(undeclaredCount)}</span>
          <span className="stat-note">condizioni assenti nel materiale</span>
        </div>
      </section>

      <p className={styles.catalogHint}>
        Una ripetizione o un importo alto non dimostrano da soli spreco o illecito. I confronti con
        mediana restano in <Link href="/controlli">Cosa controllare</Link> e{" "}
        <Link href="/confronti">Confronti</Link>.
      </p>

      <form className={styles.searchBar} action="/dati" method="get" role="search">
        <label htmlFor="catalog-search">Cerca nel catalogo</label>
        <div>
          <input
            className="input"
            id="catalog-search"
            name="cerca"
            type="search"
            defaultValue={q ?? ""}
            maxLength={CATALOG_SEARCH_MAX_LENGTH}
            placeholder="Titolo, ambito, società o id"
            autoComplete="off"
          />
          {view !== "priorita" ? <input type="hidden" name="vista" value={view} /> : null}
          {filters.evidence ? <input type="hidden" name="evidenza" value={filters.evidence} /> : null}
          {filters.publication ? (
            <input type="hidden" name="pubblicazione" value={filters.publication} />
          ) : null}
          {filters.undeclaredReuse ? <input type="hidden" name="riuso" value="non-dichiarato" /> : null}
          <button className="btn btn-primary" type="submit">
            Cerca
          </button>
        </div>
        {q ? (
          <p className={styles.searchClear}>
            Ricerca: <strong>{q}</strong>
            {" · "}
            <Link href={catalogQueryHref({ ...query, q: null })}>Togli ricerca</Link>
          </p>
        ) : (
          <p className={styles.searchHint}>
            Cerca per titolo, ambito, autorità o nome che compare nel teaser del destinatario.
          </p>
        )}
      </form>

      <nav className={styles.filterBar} aria-label="Filtri del catalogo">
        <div className={styles.filterGroup}>
          <span>Evidenza</span>
          <div>
            <Link
              href={catalogQueryHref(withEvidence(query, null))}
              aria-current={filters.evidence === null ? "page" : undefined}
            >
              Tutte
            </Link>
            {evidenceChipOptions.map((evidence) => (
              <Link
                key={evidence}
                href={catalogQueryHref(withEvidence(query, evidence))}
                aria-current={filters.evidence === evidence ? "page" : undefined}
              >
                {INTEGRATED_EVIDENCE_LABELS[evidence]}
              </Link>
            ))}
          </div>
        </div>
        <div className={styles.filterGroup}>
          <span>Pubblicazione</span>
          <div>
            <Link
              href={catalogQueryHref(withPublication(query, null))}
              aria-current={filters.publication === null ? "page" : undefined}
            >
              Tutte
            </Link>
            {PUBLICATION_FILTERS.map((publication) => (
              <Link
                key={publication}
                href={catalogQueryHref(withPublication(query, publication))}
                aria-current={filters.publication === publication ? "page" : undefined}
              >
                {publicationLabel(publication)}
              </Link>
            ))}
          </div>
        </div>
        <div className={styles.filterGroup}>
          <span>Riuso</span>
          <div>
            <Link
              href={catalogQueryHref(withUndeclaredReuse(query, false))}
              aria-current={!filters.undeclaredReuse ? "page" : undefined}
            >
              Tutti
            </Link>
            <Link
              href={catalogQueryHref(withUndeclaredReuse(query, true))}
              aria-current={filters.undeclaredReuse ? "page" : undefined}
            >
              Solo non dichiarato
            </Link>
          </div>
        </div>
        {constraintCount > 0 ? (
          <p className={styles.filterReset}>
            <Link href={catalogViewHref(view)}>Togli ricerca e filtri</Link>
          </p>
        ) : null}
      </nav>

      {view === "priorita" && (readableVisible.length > 0 || missingVisible.length > 0) ? (
        <nav className={styles.domainIndex} aria-labelledby="priority-index-title">
          <h2 id="priority-index-title">Vai a una sezione</h2>
          <ul>
            {readableVisible.length > 0 ? (
              <li>
                <a href="#numeri-da-leggere">
                  Numeri da leggere
                  <span>{integer(readableVisible.length)}</span>
                </a>
              </li>
            ) : null}
            {missingVisible.length > 0 ? (
              <li>
                <a href="#cosa-manca">
                  Cosa manca ancora
                  <span>{integer(missingVisible.length)}</span>
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}

      {view === "ambito" && domains.length > 0 ? (
        <nav className={styles.domainIndex} aria-labelledby="domain-index-title">
          <h2 id="domain-index-title">Vai a un ambito</h2>
          <ul>
            {domains.map((entry) => (
              <li key={entry.domain}>
                <a href={`#domain-${entry.domain}`}>
                  {entry.label}
                  <span>{integer(entry.datasets.length)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {visible.length === 0 ? (
        <section className={`panel ${styles.emptyFilters}`}>
          <h2 className="panel-title">Nessun dataset con questi criteri</h2>
          <p>
            {q
              ? "Prova un’altra ricerca, togli un filtro oppure apri la vista "
              : "Prova a togliere un filtro oppure apri la vista "}
            <Link href={catalogViewHref("tutti", filters, q)}>Tutti</Link> per il registro completo.
          </p>
        </section>
      ) : null}

      {view === "priorita" && readableVisible.length > 0 ? (
        <section className={styles.domainSection} aria-labelledby="numeri-da-leggere">
          <div className={styles.sectionHeading}>
            <h2 id="numeri-da-leggere">Numeri da leggere</h2>
            <span>
              {integer(readableVisible.length)} dataset · società, importi e ricorrenze quando presenti
            </span>
          </div>
          <ul className={styles.datasetGrid}>
            {readableVisible.map((dataset) => (
              <DatasetCard
                dataset={dataset}
                key={dataset.id}
                teaser={teasers.get(dataset.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {view === "priorita" && missingVisible.length > 0 ? (
        <section className={`${styles.domainSection} ${styles.secondarySection}`} aria-labelledby="cosa-manca">
          <div className={styles.sectionHeading}>
            <h2 id="cosa-manca">Cosa manca ancora</h2>
            <span>
              {integer(missingVisible.length)} dataset · segnali senza dettaglio pubblico da scorrere
            </span>
          </div>
          <ul className={styles.datasetGrid}>
            {missingVisible.map((dataset) => (
              <DatasetCard
                dataset={dataset}
                key={dataset.id}
                teaser={teasers.get(dataset.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {view === "ambito"
        ? domains.map((entry) => (
            <section
              className={styles.domainSection}
              key={entry.domain}
              aria-labelledby={`domain-${entry.domain}`}
            >
              <div className={styles.sectionHeading}>
                <h2 id={`domain-${entry.domain}`}>{entry.label}</h2>
                <span>
                  {integer(entry.datasets.length)} dataset · {integer(entry.queryable)} con righe
                  interrogabili
                </span>
              </div>
              <ul className={styles.datasetGrid}>
                {entry.datasets.map((dataset) => (
                  <DatasetCard
                    dataset={dataset}
                    key={dataset.id}
                    teaser={teasers.get(dataset.id)}
                  />
                ))}
              </ul>
            </section>
          ))
        : null}

      {view === "tutti" && allDatasets.length > 0 ? (
        <section className={styles.domainSection} aria-labelledby="all-datasets-title">
          <div className={styles.sectionHeading}>
            <h2 id="all-datasets-title">Elenco completo</h2>
            <span>
              {integer(allDatasets.length)} dataset · prima i numeri leggibili
            </span>
          </div>
          <ul className={styles.datasetGrid}>
            {allDatasets.map((dataset) => (
              <DatasetCard
                dataset={dataset}
                key={dataset.id}
                teaser={teasers.get(dataset.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`panel ${styles.finalLinks}`}>
        <h2 className="panel-title">Verifica la copertura</h2>
        <p>
          Il catalogo si riconcilia con l&apos;inventario del corpus e con il registro delle identità
          di fonte.
        </p>
        <div>
          <Link href="/fonti/copertura">Copertura elemento per elemento →</Link>
          <Link href="/fonti/catalogo">Catalogo delle fonti →</Link>
        </div>
      </section>
    </main>
  );
}
