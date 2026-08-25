import type { IntegratedEvidenceLabel } from "@/lib/integrated-source-contract";
import { isInsightCapable } from "@/lib/integrated-dataset-insight-core";
import { EDITORIAL_TOPICS } from "@/lib/integrated-editorial";

export const CATALOG_VIEWS = ["priorita", "ambito", "tutti"] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];
export const DEFAULT_CATALOG_VIEW: CatalogView = "priorita";

export const INTEGRATED_EVIDENCE_LABELS: Record<IntegratedEvidenceLabel, string> = {
  "documented-fact": "Fatto documentato",
  "missing-data": "Dato mancante",
  "verified-difference": "Scostamento verificato",
  "needs-explanation": "Richiede una spiegazione",
  "official-finding": "Accertamento ufficiale",
};

export const PRIORITY_EVIDENCE_ORDER: readonly Exclude<IntegratedEvidenceLabel, "documented-fact">[] = [
  "needs-explanation",
  "missing-data",
  "verified-difference",
  "official-finding",
];

export const PUBLICATION_FILTERS = ["rows", "source-index", "catalog-only", "derived-only"] as const;
export type PublicationFilter = (typeof PUBLICATION_FILTERS)[number];

const PRIORITY_GROUP_COPY: Record<
  Exclude<IntegratedEvidenceLabel, "documented-fact">,
  { title: string; note: string }
> = {
  "needs-explanation": {
    title: "Da spiegare",
    note: "Domande di verifica già etichettate nel catalogo. Non sono uno spreco o un illecito.",
  },
  "missing-data": {
    title: "Dati incompleti o non reperiti",
    note: "Manca un documento, una sezione o un URL utilizzabile. È un buco di copertura, non un giudizio.",
  },
  "verified-difference": {
    title: "Scostamento documentato",
    note: "Una differenza già verificata rispetto a un riferimento dichiarato dalla fonte o dal metodo.",
  },
  "official-finding": {
    title: "Esito ufficiale",
    note: "Un accertamento pubblicato da un'autorità. Resta il testo della fonte, non una nostra sentenza.",
  },
};

export type CatalogDatasetSummary = Readonly<{
  id: string;
  domain: string;
  evidenceLabel: IntegratedEvidenceLabel;
  licenseStatus: string;
  publication: string;
  queryable?: boolean;
  headers?: readonly string[];
  publicRows?: number;
}>;

export type RelatedReading = Readonly<{
  href: string;
  label: string;
}>;

export type CatalogFilters = Readonly<{
  evidence: IntegratedEvidenceLabel | null;
  publication: PublicationFilter | null;
  undeclaredReuse: boolean;
}>;

export type CatalogQuery = Readonly<{
  view: CatalogView;
  filters: CatalogFilters;
  /** Free-text search over title, ambito, id, authority and teaser lines. */
  q: string | null;
}>;

export const CATALOG_SEARCH_MAX_LENGTH = 80;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCatalogView(value: string | string[] | undefined): CatalogView {
  const raw = firstParam(value);
  if (raw === "ambito" || raw === "tutti" || raw === "priorita") return raw;
  return DEFAULT_CATALOG_VIEW;
}

/** Trims and bounds the catalog search box; empty becomes null. */
export function parseCatalogSearch(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (raw === undefined) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed === "") return null;
  return trimmed.slice(0, CATALOG_SEARCH_MAX_LENGTH);
}

export function parseCatalogFilters(input: {
  evidenza?: string | string[];
  pubblicazione?: string | string[];
  riuso?: string | string[];
}): CatalogFilters {
  const evidenceRaw = firstParam(input.evidenza);
  const publicationRaw = firstParam(input.pubblicazione);
  const reuseRaw = firstParam(input.riuso);
  const evidence =
    evidenceRaw && evidenceRaw in INTEGRATED_EVIDENCE_LABELS
      ? (evidenceRaw as IntegratedEvidenceLabel)
      : null;
  const publication =
    publicationRaw && (PUBLICATION_FILTERS as readonly string[]).includes(publicationRaw)
      ? (publicationRaw as PublicationFilter)
      : null;
  return {
    evidence,
    publication,
    undeclaredReuse: reuseRaw === "non-dichiarato",
  };
}

export function parseCatalogQuery(searchParams: {
  vista?: string | string[];
  evidenza?: string | string[];
  pubblicazione?: string | string[];
  riuso?: string | string[];
  cerca?: string | string[];
  q?: string | string[];
}): CatalogQuery {
  return {
    view: parseCatalogView(searchParams.vista),
    filters: parseCatalogFilters(searchParams),
    q: parseCatalogSearch(searchParams.cerca ?? searchParams.q),
  };
}

export function catalogQueryHref(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.view !== DEFAULT_CATALOG_VIEW) params.set("vista", query.view);
  if (query.filters.evidence) params.set("evidenza", query.filters.evidence);
  if (query.filters.publication) params.set("pubblicazione", query.filters.publication);
  if (query.filters.undeclaredReuse) params.set("riuso", "non-dichiarato");
  if (query.q) params.set("cerca", query.q);
  const encoded = params.toString();
  return encoded ? `/dati?${encoded}` : "/dati";
}

export function catalogViewHref(
  view: CatalogView,
  filters: CatalogFilters = {
    evidence: null,
    publication: null,
    undeclaredReuse: false,
  },
  q: string | null = null,
): string {
  return catalogQueryHref({ view, filters, q });
}

export function isPriorityDataset(dataset: Pick<CatalogDatasetSummary, "evidenceLabel">): boolean {
  return dataset.evidenceLabel !== "documented-fact";
}

export function publicationLabel(publication: string): string {
  if (publication === "rows") return "Righe interrogabili";
  if (publication === "source-index") return "Indice interrogabile";
  if (publication === "catalog-only") return "Solo catalogo";
  return "Materiale derivato";
}

/** Datasets with public recipient + amount columns (live insight possible). */
export function hasReadableNumbers(
  dataset: Pick<CatalogDatasetSummary, "queryable" | "headers" | "publication">,
): boolean {
  const queryable =
    dataset.queryable ??
    (dataset.publication === "rows" || dataset.publication === "source-index");
  return isInsightCapable(dataset.headers ?? [], Boolean(queryable));
}

/**
 * Priority home: money/recipients first, coverage gaps second.
 * Readable sets include documented-fact queryable rows (e.g. vincitori).
 */
export function partitionPriorityCatalog<T extends CatalogDatasetSummary>(
  allDatasets: readonly T[],
  filters: CatalogFilters,
): Readonly<{ readable: T[]; missing: T[] }> {
  const visible = allDatasets.filter((dataset) => matchesCatalogFilters(dataset, filters));
  const readable = visible
    .filter((dataset) => hasReadableNumbers(dataset))
    .sort(
      (left, right) =>
        (right.publicRows ?? 0) - (left.publicRows ?? 0) || left.id.localeCompare(right.id),
    );
  const missing = visible
    .filter((dataset) => isPriorityDataset(dataset) && !hasReadableNumbers(dataset))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { readable, missing };
}

export function matchesCatalogFilters(
  dataset: CatalogDatasetSummary,
  filters: CatalogFilters,
): boolean {
  if (filters.evidence && dataset.evidenceLabel !== filters.evidence) return false;
  if (filters.publication && dataset.publication !== filters.publication) return false;
  if (filters.undeclaredReuse && dataset.licenseStatus !== "not-declared") return false;
  return true;
}

/** Case-insensitive match on id, title, domain, authority, domain label and teaser. */
export function matchesCatalogSearch(
  dataset: CatalogDatasetSummary &
    Partial<Readonly<{ title: string; authority: string }>>,
  query: string,
  extras: Readonly<{ domainLabel?: string; teaserLine?: string | null }> = {},
): boolean {
  const needle = query.trim().toLocaleLowerCase("it-IT");
  if (needle === "") return true;
  const haystack = [
    dataset.id,
    dataset.title ?? "",
    dataset.authority ?? "",
    dataset.domain,
    extras.domainLabel ?? "",
    extras.teaserLine ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase("it-IT");
  return haystack.includes(needle);
}

export function relatedReadingForDataset(
  dataset: Pick<CatalogDatasetSummary, "id" | "domain">,
): RelatedReading | null {
  const topic = EDITORIAL_TOPICS.find((entry) =>
    entry.datasets.some((item) => item.id === dataset.id),
  );
  if (topic) {
    return { href: `/${topic.section}/${topic.slug}`, label: topic.title };
  }
  if (dataset.domain === "benchmarks") {
    return { href: "/confronti", label: "Confronti verificati" };
  }
  if (dataset.domain === "transparency") {
    return { href: "/trasparenza", label: "Trasparenza e verifiche" };
  }
  if (
    dataset.domain === "evidence" ||
    dataset.domain === "oversight" ||
    dataset.domain === "candidate-batches"
  ) {
    return { href: "/controlli", label: "Cosa controllare" };
  }
  return { href: "/controlli", label: "Come si leggono i segnali" };
}

export function groupPriorityDatasets<T extends CatalogDatasetSummary>(datasets: readonly T[]) {
  return PRIORITY_EVIDENCE_ORDER.flatMap((evidenceLabel) => {
    const items = datasets.filter((dataset) => dataset.evidenceLabel === evidenceLabel);
    if (items.length === 0) return [];
    return [
      {
        evidenceLabel,
        title: PRIORITY_GROUP_COPY[evidenceLabel].title,
        note: PRIORITY_GROUP_COPY[evidenceLabel].note,
        datasets: items,
      },
    ];
  });
}

export function activeFilterCount(filters: CatalogFilters): number {
  return (
    (filters.evidence ? 1 : 0) +
    (filters.publication ? 1 : 0) +
    (filters.undeclaredReuse ? 1 : 0)
  );
}

export function activeCatalogConstraintCount(query: CatalogQuery): number {
  return activeFilterCount(query.filters) + (query.q ? 1 : 0);
}
