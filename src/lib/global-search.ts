import "server-only";

import integratedCatalog from "@/data/generated/integrated/catalog.json";
import {
  EDITORIAL_TOPICS,
  type EditorialTopic,
} from "@/lib/integrated-editorial";
import { integratedDomainLabel } from "@/lib/integrated-domains";
import { datasetCatalog } from "@/lib/mcp/catalog";
import {
  searchIpaEntities,
  searchIpaEntitiesByPrefix,
  type IpaEntity,
} from "@/lib/ipa";
import { municipalityName } from "@/lib/municipality-name";
import { getMunicipalitySearchEntities } from "@/lib/siope-municipality-detail";
import { isUpstreamOverloadedError } from "@/lib/data/source-fetch";
import {
  PRIMARY_NAV,
  SITE_MAP_GROUPS,
} from "@/lib/site-navigation";
import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_MAX_LIMIT,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
} from "@/lib/global-search-contract";
import type {
  GlobalSearchResponse,
  SearchKind,
  SearchMatchReason,
  SearchGroup,
  SearchResult,
} from "@/lib/global-search-contract";

export {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_MAX_LIMIT,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
} from "@/lib/global-search-contract";
export type {
  GlobalSearchResponse,
  SearchGroup,
  SearchKind,
  SearchMatchReason,
  SearchResult,
} from "@/lib/global-search-contract";
export type SearchIndexDocument = Readonly<{
  id: string;
  href: string;
  title: string;
  context: string;
  type: Exclude<SearchKind, "ente">;
  aliases: readonly string[];
  description: string | null;
}>;

type FieldMatch = Readonly<{
  quality: number;
  reason: "exact" | "prefix" | "tokens" | "fuzzy";
}>;

type IntegratedSearchEntry = Readonly<{
  id: string;
  title: string;
  domain: string;
  authority: string;
  caveats: readonly string[];
}>;

const SEARCH_KIND_LABELS: Readonly<Record<SearchKind, string>> = {
  pagina: "Pagine",
  sezione: "Sezioni",
  dataset: "Dataset",
  strumento: "Strumenti",
  ente: "Enti",
};

const SEARCH_KIND_ORDER: readonly SearchKind[] = [
  "pagina",
  "sezione",
  "dataset",
  "strumento",
  "ente",
];

const SEARCH_MATCH_LABELS: Readonly<Record<SearchMatchReason, string>> = {
  "title-exact": "Titolo esatto",
  "title-prefix": "Prefisso nel titolo",
  "title-tokens": "Parole nel titolo",
  "title-fuzzy": "Corrispondenza simile nel titolo",
  alias: "Alias o sinonimo",
  description: "Descrizione",
  entity: "Nome dell'ente",
};

/** Terms users reasonably use for the canonical routes already in the site map. */
const ROUTE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "/": ["inizio"],
  "/spese": ["spesa", "pagamenti", "pagamenti comuni", "uscite", "soldi", "comuni"],
  "/spese/sanita": ["salute", "ssn", "servizio sanitario", "ospedali"],
  "/spese/sanita/storico": ["trend sanita", "serie storica sanita", "anni sanita"],
  "/spese/invalidita": ["invalidita", "inps", "prestazioni"],
  "/spese/pensioni": [
    "pensioni",
    "pensionati",
    "casellario dei pensionati",
    "prestazioni pensionistiche",
    "spesa pensionistica",
    "osservatorio pensioni",
    "anno di decorrenza",
    "inps",
    "istat",
  ],
  "/spese/consulenze": ["consulenze", "incarichi", "collaborazioni"],
  "/spese/territoriale": ["territorio", "regioni", "spesa statale"],
  "/spese/operative": ["costi operativi", "funzionamento"],
  "/stato": ["amministrazioni centrali", "ministeri", "stato"],
  "/debito": ["debito", "debito pubblico", "maastricht", "interessi"],
  "/stato/legislature": ["elezioni", "governi", "confronto legislatura"],
  "/territori": ["territorio", "regioni", "comuni", "geografia"],
  "/territori/irpef": ["redditi", "imposta", "tasse", "dichiarazioni"],
  "/territori/fisco": ["entrate", "saldo", "cpt", "conti pubblici territoriali"],
  "/territori/confronto": ["benchmark comuni", "comuni simili", "fabbisogni"],
  "/coesione": ["fondi", "progetti", "coesione", "pnrr"],
  "/coesione/asili": ["asili", "prima infanzia", "nidi", "pnrr asili"],
  "/confronti": ["confronti", "benchmark", "comparazioni"],
  "/pnrr/incarichi": ["incarichi pnrr", "indire"],
  "/istituzioni": ["istituzioni", "enti istituzionali"],
  "/parlamento": ["camera", "senato", "assemblee"],
  "/palazzo-chigi": ["presidenza del consiglio", "pcm", "governo"],
  "/ministeri": ["ministeri", "amministrazioni"],
  "/regioni": ["regioni", "province autonome"],
  "/enti": ["enti", "comune", "comuni", "amministrazioni", "registro"],
  "/partecipazioni": ["societa partecipate", "quote", "partecipate"],
  "/appalti": ["appalti", "contratti", "gare", "acquisti"],
  "/appalti/dettaglio": ["appalti dettagli", "fornitori", "aggiudicatari"],
  "/incarichi": ["incarichi", "consulenze", "personale"],
  "/incarichi/dettaglio": ["incarichi dettagli", "consulenti", "collaborazioni"],
  "/dati": ["dataset", "catalogo dati", "dati integrati"],
  "/controlli": ["segnali", "verifiche", "controlli"],
  "/trasparenza": ["trasparenza", "documenti mancanti", "atti"],
  "/assistente": ["domande", "domande testuali", "ai dati"],
  "/mcp": ["model context protocol", "protocollo mcp", "api dati"],
  "/supporto": ["aiuto", "assistenza"],
  "/fonti": ["fonti", "sorgenti", "origine dati"],
  "/fonti/stato": ["stato fonti", "aggiornamento fonti", "salute fonti"],
  "/fonti/copertura": ["copertura", "fonti integrate", "completezza"],
  "/fonti/catalogo": ["catalogo fonti", "identita fonti"],
  "/metodologia": ["metodo", "metodologia", "come leggiamo i dati"],
};

const PUBLIC_DATASET_TITLES: Readonly<Record<string, string>> = {
  vincitori: "Fornitori per settore e importo",
  "gruppi-vincitori": "Gruppi societari dei fornitori",
  "vincitori-cig": "Collegamenti fornitore-CIG",
};

const integratedEntries = (integratedCatalog.datasets as readonly IntegratedSearchEntry[]).map(
  (dataset) => ({
    ...dataset,
    title: PUBLIC_DATASET_TITLES[dataset.id] ?? dataset.title,
  }),
);

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function addDocument(
  documents: Map<string, SearchIndexDocument>,
  document: SearchIndexDocument,
): void {
  const existing = documents.get(document.href);
  if (!existing) {
    documents.set(document.href, document);
    return;
  }

  documents.set(document.href, {
    ...existing,
    aliases: unique([...existing.aliases, ...document.aliases]),
    description: existing.description ?? document.description,
  });
}

function topicSectionLabel(topic: EditorialTopic): string {
  const parent = PRIMARY_NAV.find((section) =>
    section.children?.some((child) => child.href === `/${topic.section}`),
  );
  return parent?.label ?? topic.section;
}

function buildSearchDocuments(): readonly SearchIndexDocument[] {
  const documents = new Map<string, SearchIndexDocument>();

  for (const group of SITE_MAP_GROUPS) {
    for (const link of group.links) {
      const primary = PRIMARY_NAV.find((section) => section.href === link.href);
      const type: SearchIndexDocument["type"] =
        group.title === "Strumenti"
          ? "strumento"
          : primary
            ? "sezione"
            : "pagina";
      const sectionLabel = primary?.label ?? group.title;
      const aliases = [
        group.title,
        ...(primary?.aliases ?? []),
        ...(ROUTE_ALIASES[link.href] ?? []),
      ];
      addDocument(documents, {
        id: `site:${link.href}`,
        href: link.href,
        title: link.label,
        context: sectionLabel,
        type,
        aliases: unique(aliases),
        description: null,
      });
    }
  }

  for (const topic of EDITORIAL_TOPICS) {
    const href = `/${topic.section}/${topic.slug}`;
    addDocument(documents, {
      id: `topic:${href}`,
      href,
      title: topic.title,
      context: topicSectionLabel(topic),
      type: "pagina",
      aliases: unique([
        topic.slug,
        topic.section,
        topicSectionLabel(topic),
        ...topic.datasets.map((dataset) => dataset.label),
        ...topic.datasets.map((dataset) => dataset.id),
      ]),
      description: `${topic.description} ${topic.introduction}`,
    });
  }

  for (const dataset of datasetCatalog) {
    const href = `/mcp#dataset-${encodeURIComponent(dataset.id)}`;
    addDocument(documents, {
      id: `dataset:${dataset.id}`,
      href,
      title: dataset.title,
      context: dataset.sources[0]?.name ?? "Catalogo MCP",
      type: "dataset",
      aliases: unique([
        dataset.id,
        ...dataset.sources.flatMap((source) => [source.name, source.owner]),
      ]),
      description: [dataset.summary, dataset.caveat].filter(Boolean).join(" ") || null,
    });
  }

  for (const dataset of integratedEntries) {
    const href = `/dati/${encodeURIComponent(dataset.id)}`;
    addDocument(documents, {
      id: `dataset:integrated:${dataset.id}`,
      href,
      title: dataset.title,
      context: integratedDomainLabel(dataset.domain),
      type: "dataset",
      aliases: unique([
        dataset.id,
        integratedDomainLabel(dataset.domain),
        dataset.authority,
      ]),
      description: dataset.caveats.join(" ") || null,
    });
  }

  return [...documents.values()];
}

const SEARCH_DOCUMENTS = buildSearchDocuments();
const italianCollator = new Intl.Collator("it", { sensitivity: "base" });

/**
 * Fold accents and punctuation while keeping a stable, human-readable token
 * boundary. Fuzzy matches are deliberately narrow (one edit on a token of at
 * least four characters) so every hit remains explainable and useful.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[’'`]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value: string): readonly string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

const FUZZY_MIN_TOKEN_LENGTH = 4;

function editDistanceAtMostOne(left: string, right: string): boolean {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  if (Math.abs(leftCharacters.length - rightCharacters.length) > 1) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < leftCharacters.length && rightIndex < rightCharacters.length) {
    if (leftCharacters[leftIndex] === rightCharacters[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;
    if (leftCharacters.length > rightCharacters.length) leftIndex += 1;
    else if (rightCharacters.length > leftCharacters.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return edits + (leftCharacters.length - leftIndex) + (rightCharacters.length - rightIndex) <= 1;
}

function tokenQuality(queryToken: string, candidateToken: string): number {
  if (candidateToken === queryToken) return 3;
  if (candidateToken.startsWith(queryToken)) return 2;
  if (queryToken.length >= FUZZY_MIN_TOKEN_LENGTH && candidateToken.includes(queryToken)) return 1;
  if (
    queryToken.length >= FUZZY_MIN_TOKEN_LENGTH &&
    candidateToken.length >= FUZZY_MIN_TOKEN_LENGTH &&
    editDistanceAtMostOne(queryToken, candidateToken)
  ) {
    return 0.5;
  }
  return 0;
}

function matchField(value: string, query: string, queryTokens: readonly string[]): FieldMatch | null {
  const normalized = normalizeSearchText(value);
  if (!normalized || !query) return null;
  if (normalized === query) return { quality: 3, reason: "exact" };
  if (normalized.startsWith(query)) return { quality: 2, reason: "prefix" };

  const candidateTokens = tokens(normalized);
  const qualities = queryTokens.map((queryToken) =>
    Math.max(...candidateTokens.map((candidateToken) => tokenQuality(queryToken, candidateToken)), 0),
  );
  if (qualities.some((quality) => quality === 0)) return null;
  if (qualities.some((quality) => quality === 0.5)) return { quality: 1.2, reason: "fuzzy" };
  if (qualities.every((quality) => quality === 3)) return { quality: 1.8, reason: "tokens" };
  if (qualities.every((quality) => quality >= 2)) return { quality: 1.6, reason: "tokens" };
  return { quality: 1.4, reason: "tokens" };
}

function resultForDocument(document: SearchIndexDocument, query: string): SearchResult | null {
  const queryTokens = tokens(query);
  const titleMatch = matchField(document.title, query, queryTokens);
  const aliasMatch = document.aliases.reduce<FieldMatch | null>(
    (best, alias) => {
      const match = matchField(alias, query, queryTokens);
      return match && (!best || match.quality > best.quality) ? match : best;
    },
    null,
  );
  const descriptionMatch = document.description
    ? matchField(document.description, query, queryTokens)
    : null;

  let reason: SearchMatchReason;
  let score: number;
  if (titleMatch) {
    reason =
      titleMatch.reason === "exact"
        ? "title-exact"
        : titleMatch.reason === "prefix"
          ? "title-prefix"
          : titleMatch.reason === "fuzzy"
            ? "title-fuzzy"
            : "title-tokens";
    score = 6_000 + titleMatch.quality * 100;
  } else if (aliasMatch) {
    reason = "alias";
    score = 4_000 + aliasMatch.quality * 100;
  } else if (descriptionMatch) {
    reason = "description";
    score = 2_600 + descriptionMatch.quality * 100;
  } else {
    return null;
  }

  return {
    id: document.id,
    href: document.href,
    title: document.title,
    context: document.context,
    type: document.type,
    description: document.description,
    match: { reason, label: SEARCH_MATCH_LABELS[reason] },
    score,
  };
}

type EntityPlaceKind = "municipality" | "metropolitan_city" | "other";

type EntityPlace = Readonly<{
  kind: EntityPlaceKind;
  placeName: string;
}>;

const MUNICIPALITY_PREFIX =
  /^(?:comune di|comune della|comune del|comune dello|comune dei|comune degli|comune delle)\s+/u;
const METROPOLITAN_PREFIX =
  /^(?:citta metropolitana di|citta metropolitana della|citta metropolitana del|citta metropolitana dello)\s+/u;

/** Dropped when matching the bare place name so "città di Milano" still hits the Comune. */
const PLACE_QUERY_STOPWORDS = new Set([
  "citta",
  "comune",
  "metropolitana",
  "di",
  "del",
  "della",
  "dello",
  "dei",
  "degli",
  "delle",
]);

/**
 * Prefer the municipality when the user types a city name ("Milano", "Bologna").
 * IPA returns many agencies that contain the same token; without a place-name
 * boost those crowd out COMUNE DI … and CITTÀ METROPOLITANA DI ….
 */
export function classifyEntityPlace(entity: Pick<IpaEntity, "denominazione" | "tipologia">): EntityPlace {
  const normalizedName = normalizeSearchText(entity.denominazione);
  const tipologia = normalizeSearchText(entity.tipologia ?? "");

  if (normalizedName === "roma capitale" || normalizedName.startsWith("roma capitale ")) {
    return { kind: "municipality", placeName: "roma" };
  }

  if (METROPOLITAN_PREFIX.test(normalizedName)) {
    return {
      kind: "metropolitan_city",
      placeName: normalizedName.replace(METROPOLITAN_PREFIX, "").trim() || normalizedName,
    };
  }

  if (MUNICIPALITY_PREFIX.test(normalizedName) || tipologia === "comune") {
    return {
      kind: "municipality",
      placeName: normalizedName.replace(MUNICIPALITY_PREFIX, "").trim() || normalizedName,
    };
  }

  return { kind: "other", placeName: normalizedName };
}

function placeQueryText(query: string): string {
  const placeTokens = tokens(query).filter((token) => !PLACE_QUERY_STOPWORDS.has(token));
  return placeTokens.join(" ");
}

function entityScore(entity: IpaEntity, query: string, match: FieldMatch): number {
  const place = classifyEntityPlace(entity);
  const placeQuery = placeQueryText(query) || query;
  const placeMatch = matchField(place.placeName, placeQuery, tokens(placeQuery));
  const base = 1_600 + match.quality * 100;

  if (placeMatch?.reason === "exact") {
    if (place.kind === "municipality") return 9_200 + placeMatch.quality * 10;
    if (place.kind === "metropolitan_city") return 8_600 + placeMatch.quality * 10;
  }
  if (placeMatch?.reason === "prefix") {
    // Keep incomplete municipal prefixes below an exact metropolitan-city hit
    // so "bologna" prefers Città Metropolitana di Bologna over COMUNE DI BOLOGNANO.
    if (place.kind === "municipality") return 8_400 + placeMatch.quality * 10;
    if (place.kind === "metropolitan_city") return 8_000 + placeMatch.quality * 10;
  }
  if (placeMatch && place.kind === "municipality") return 7_000 + placeMatch.quality * 100;
  if (placeMatch && place.kind === "metropolitan_city") return 6_400 + placeMatch.quality * 100;

  if (place.kind === "municipality") return base + 200;
  if (place.kind === "metropolitan_city") return base + 100;
  return base;
}

function resultForEntity(entity: IpaEntity, query: string): SearchResult | null {
  const queryTokens = tokens(query);
  const place = classifyEntityPlace(entity);
  const placeQuery = placeQueryText(query);
  const placeTokens = placeQuery ? tokens(placeQuery) : [];
  const placeMatch = placeQuery
    ? matchField(place.placeName, placeQuery, placeTokens)
    : null;

  const fields = [entity.denominazione, entity.acronimo, entity.codiceIpa, entity.tipologia].filter(
    (value): value is string => Boolean(value),
  );
  const fieldMatch = fields.reduce<FieldMatch | null>((best, field) => {
    const candidates = [
      matchField(field, query, queryTokens),
      placeQuery && placeQuery !== query ? matchField(field, placeQuery, placeTokens) : null,
    ];
    for (const candidate of candidates) {
      if (candidate && (!best || candidate.quality > best.quality)) best = candidate;
    }
    return best;
  }, null);

  // "città di Milano" does not token-match "COMUNE DI MILANO"; the bare place name does.
  const match =
    fieldMatch ??
    (place.kind !== "other" && placeMatch ? placeMatch : null);
  if (!match) return null;

  const isMunicipality = place.kind === "municipality";
  const description = [entity.tipologia, entity.codiceIpa].filter(Boolean).join(" · ") || null;
  return {
    id: `entity:${entity.codiceIpa}`,
    href: `/enti/${encodeURIComponent(entity.codiceIpa)}`,
    title: isMunicipality ? municipalityName(entity.denominazione) : entity.denominazione,
    context: isMunicipality ? "Comune · Registro IPA" : "Registro IPA",
    type: "ente",
    description,
    match: { reason: "entity", label: SEARCH_MATCH_LABELS.entity },
    score: entityScore(entity, query, match),
  };
}

export function rankEntitySearchResults(
  entities: readonly IpaEntity[],
  rawQuery: string,
): readonly SearchResult[] {
  const query = normalizeSearchText(rawQuery.slice(0, GLOBAL_SEARCH_MAX_QUERY_LENGTH));
  if (tokens(query).length === 0) return [];

  const byHref = new Map<string, SearchResult>();
  for (const entity of entities) {
    const result = resultForEntity(entity, query);
    if (!result) continue;
    const existing = byHref.get(result.href);
    if (!existing || compareResults(result, existing) < 0) byHref.set(result.href, result);
  }
  return [...byHref.values()].sort(compareResults);
}

function compareResults(left: SearchResult, right: SearchResult): number {
  return (
    right.score - left.score ||
    SEARCH_KIND_ORDER.indexOf(left.type) - SEARCH_KIND_ORDER.indexOf(right.type) ||
    italianCollator.compare(left.title, right.title) ||
    italianCollator.compare(left.href, right.href) ||
    left.id.localeCompare(right.id)
  );
}

export function searchSiteDocuments(rawQuery: string): readonly SearchResult[] {
  return rankSearchDocuments(SEARCH_DOCUMENTS, rawQuery);
}

export function rankSearchDocuments(
  documents: readonly SearchIndexDocument[],
  rawQuery: string,
): readonly SearchResult[] {
  const query = normalizeSearchText(rawQuery.slice(0, GLOBAL_SEARCH_MAX_QUERY_LENGTH));
  if (tokens(query).length === 0) return [];
  const byHref = new Map<string, SearchResult>();
  for (const document of documents) {
    const result = resultForDocument(document, query);
    if (!result) continue;
    const existing = byHref.get(result.href);
    if (!existing || compareResults(result, existing) < 0) byHref.set(result.href, result);
  }
  return [...byHref.values()].sort(compareResults);
}

function groupResults(results: readonly SearchResult[]): readonly SearchGroup[] {
  return SEARCH_KIND_ORDER.flatMap((type) => {
    const grouped = results.filter((result) => result.type === type);
    return grouped.length > 0
      ? [{ type, label: SEARCH_KIND_LABELS[type], results: grouped }]
      : [];
  });
}

function emptyResponse(query: string, entitiesAvailable = true): GlobalSearchResponse {
  return {
    ok: true,
    query,
    groups: [],
    total: 0,
    hasMore: false,
    staticTotal: 0,
    entityTotal: 0,
    entitiesAvailable,
  };
}

/** Local-only search used when IPA must not be contacted again (overload/abort recovery). */
export function searchGlobalLocalFallback(input: {
  query: string;
  limit?: number;
}): GlobalSearchResponse {
  const query = input.query.trim().slice(0, GLOBAL_SEARCH_MAX_QUERY_LENGTH);
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    return emptyResponse(query, false);
  }

  const limit = safeLimit(input.limit);
  const staticResults = searchSiteDocuments(query);
  const entityLimit = Math.min(50, Math.max(limit * 3, 12));
  const municipalityResults = rankEntitySearchResults(
    getMunicipalitySearchEntities(),
    normalizedQuery,
  ).slice(0, entityLimit);

  const byHref = new Map<string, SearchResult>();
  for (const result of [...staticResults, ...municipalityResults]) {
    const existing = byHref.get(result.href);
    if (!existing || compareResults(result, existing) < 0) byHref.set(result.href, result);
  }
  const combined = [...byHref.values()].sort(compareResults);
  const visible = combined.slice(0, limit);
  const total = staticResults.length + municipalityResults.length;

  return {
    ok: true,
    query,
    groups: groupResults(visible),
    total,
    hasMore: total > visible.length,
    staticTotal: staticResults.length,
    entityTotal: municipalityResults.length,
    entitiesAvailable: false,
  };
}

function safeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return GLOBAL_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value as number), 1), GLOBAL_SEARCH_MAX_LIMIT);
}

export async function searchGlobal(input: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<GlobalSearchResponse> {
  const query = input.query.trim().slice(0, GLOBAL_SEARCH_MAX_QUERY_LENGTH);
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) return emptyResponse(query);

  const limit = safeLimit(input.limit);
  const staticResults = searchSiteDocuments(query);
  let entitiesAvailable = true;
  let entityTotal = 0;
  let entityResults: SearchResult[] = [];

  const entityLimit = Math.min(50, Math.max(limit * 3, 12));
  // Always rank local municipal identities so "Milano" / "Bologna" surface the
  // Comune even when the IPA SQL window is alphabetical and agency-heavy.
  const municipalityResults = rankEntitySearchResults(
    getMunicipalitySearchEntities(),
    normalizedQuery,
  ).slice(0, entityLimit);

  try {
    let entitySearch;
    try {
      entitySearch = await searchIpaEntitiesByPrefix({
        query: normalizedQuery,
        limit: entityLimit,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      // 429/503: do not issue a second IPA call; fail closed to local municipalities.
      if (isUpstreamOverloadedError(error)) throw error;
      // Keep the existing full-text adapter as a fail-safe when the optional
      // SQL search endpoint is unavailable upstream for other reasons.
      entitySearch = await searchIpaEntities({
        query: normalizedQuery,
        limit: entityLimit,
        signal: input.signal,
      });
    }
    const rankedIpa = rankEntitySearchResults(entitySearch.records, normalizedQuery);
    const byHref = new Map<string, SearchResult>();
    for (const result of [...municipalityResults, ...rankedIpa]) {
      const existing = byHref.get(result.href);
      if (!existing || compareResults(result, existing) < 0) byHref.set(result.href, result);
    }
    entityResults = [...byHref.values()].sort(compareResults);
    entityTotal = Math.max(entitySearch.total, entityResults.length);
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    entitiesAvailable = false;
    entityTotal = municipalityResults.length;
    entityResults = [...municipalityResults];
  }

  if (input.signal?.aborted) {
    throw input.signal.reason ?? new Error("Ricerca annullata");
  }

  const byHref = new Map<string, SearchResult>();
  for (const result of [...staticResults, ...entityResults]) {
    const existing = byHref.get(result.href);
    if (!existing || compareResults(result, existing) < 0) byHref.set(result.href, result);
  }
  const combined = [...byHref.values()].sort(compareResults);
  const visible = combined.slice(0, limit);
  const total = staticResults.length + entityTotal;

  return {
    ok: true,
    query,
    groups: groupResults(visible),
    total,
    hasMore: total > visible.length,
    staticTotal: staticResults.length,
    entityTotal,
    entitiesAvailable,
  };
}
