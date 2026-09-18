import { getRepubblicaGraph } from "@/lib/politici-repubblica";

/**
 * News index for the institutional map.
 *
 * Two public indexes are queried in order: Google News (fast, wide coverage of
 * Italian outlets) and GDELT DOC (direct publisher links) as a fallback. Only
 * metadata travels: title, publisher, date and link. Nothing is republished.
 *
 * The answer of every person is cached in the process for half an hour, because
 * both providers throttle bursts and the same person is clicked over and over
 * while the reader explores the neighbourhood of a node.
 */

const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";
const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const CACHE_TTL_MS = 30 * 60_000;
const UPSTREAM_TIMEOUT_MS = 9_000;
const MAX_ARTICLES = 20;
const MAX_CONNECTIONS = 12;

export type NewsArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
};

export type NewsConnection = {
  person: {
    id: string;
    name: string;
    chamber: string | null;
    groupId: string | null;
    groupLabel: string | null;
    role: string;
  };
  articleCount: number;
  articleUrls: string[];
};

export type NewsProvider = {
  id: "google-news" | "gdelt";
  name: string;
  url: string;
  note: string;
};

export type PersonNews = {
  articles: NewsArticle[];
  connections: NewsConnection[];
  provider: NewsProvider;
  observedAt: string;
};

const PROVIDERS: Record<NewsProvider["id"], NewsProvider> = {
  "google-news": {
    id: "google-news",
    name: "Google News",
    url: "https://news.google.com/",
    note: "Indice di testate italiane: titolo, editore e data restano dei rispettivi editori e il collegamento passa da Google News.",
  },
  gdelt: {
    id: "gdelt",
    name: "GDELT DOC 2.0",
    url: "https://www.gdeltproject.org/",
    note: "Indice live di metadati: titoli, date e link restano dei rispettivi editori.",
  },
};

const cache = new Map<string, { expiresAt: number; payload: PersonNews }>();
const inFlight = new Map<string, Promise<PersonNews>>();

function decodeEntities(value: string): string {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

function tagValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "u").exec(block);
  return match ? decodeEntities(match[1]) : null;
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function isoFromRfc1123(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function isoFromGdeltDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z` : null;
}

/** Google News appends " - Publisher" to every headline: the publisher already has its own field. */
function stripPublisherSuffix(title: string, publisher: string): string {
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function sortArticles(articles: NewsArticle[]): NewsArticle[] {
  return articles.sort((a, b) => {
    if (a.publishedAt === b.publishedAt) return a.title.localeCompare(b.title, "it");
    if (a.publishedAt === null) return 1;
    if (b.publishedAt === null) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

async function fetchGoogleNews(displayName: string, signal: AbortSignal): Promise<NewsArticle[]> {
  const endpoint = new URL(GOOGLE_NEWS_URL);
  endpoint.searchParams.set("q", `"${displayName}"`);
  endpoint.searchParams.set("hl", "it");
  endpoint.searchParams.set("gl", "IT");
  endpoint.searchParams.set("ceid", "IT:it");
  const response = await fetch(endpoint, {
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": "Mozilla/5.0 (compatible; DoveVannoINostriSoldi/1.0; +https://dovevannoinostrisoldi.com)",
    },
  });
  if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
  const body = await response.text();
  if (!body.includes("<rss")) throw new Error("Google News non ha restituito un feed RSS");

  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const match of body.matchAll(/<item>([\s\S]*?)<\/item>/gu)) {
    const block = match[1];
    const url = httpsUrl(tagValue(block, "link"));
    const rawTitle = tagValue(block, "title");
    if (!url || !rawTitle || seen.has(url)) continue;
    const publisher = tagValue(block, "source") ?? new URL(url).hostname;
    const title = stripPublisherSuffix(rawTitle, publisher);
    if (title.length === 0) continue;
    seen.add(url);
    articles.push({ title, url, source: publisher, publishedAt: isoFromRfc1123(tagValue(block, "pubDate")) });
    if (articles.length >= MAX_ARTICLES) break;
  }
  return sortArticles(articles);
}

async function fetchGdelt(displayName: string, signal: AbortSignal): Promise<NewsArticle[]> {
  const endpoint = new URL(GDELT_DOC_URL);
  endpoint.searchParams.set("query", `"${displayName}" sourcelang:italian`);
  endpoint.searchParams.set("mode", "artlist");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("timespan", "6m");
  endpoint.searchParams.set("maxrecords", String(MAX_ARTICLES));
  endpoint.searchParams.set("sort", "datedesc");
  const response = await fetch(endpoint, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "DoveVannoINostriSoldi/1.0" },
  });
  if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").includes("json")) throw new Error("GDELT non ha restituito JSON");
  const payload = (await response.json()) as { articles?: Array<Record<string, unknown>> };
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const article of payload.articles ?? []) {
    const url = httpsUrl(typeof article.url === "string" ? article.url : null);
    const title = typeof article.title === "string" ? article.title.trim() : "";
    if (!url || title.length === 0 || seen.has(url)) continue;
    seen.add(url);
    articles.push({
      title,
      url,
      source: typeof article.domain === "string" ? article.domain : new URL(url).hostname,
      publishedAt: isoFromGdeltDate(article.seendate),
    });
  }
  return sortArticles(articles);
}

function foldAccents(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalize(value: string): string {
  return foldAccents(value).toLocaleLowerCase("it-IT");
}

type Candidate = {
  id: string;
  name: string;
  chamber: string | null;
  groupId: string | null;
  groupLabel: string | null;
  role: string;
  fullName: string;
  /** Surname as printed, accent-folded: matched case-sensitively in headlines. */
  surname: string | null;
};

let candidateIndex: Candidate[] | null = null;

/** Normalising 626 names on every request is wasted work: the roster only changes on deploy. */
function getCandidates(): Candidate[] {
  if (candidateIndex) return candidateIndex;
  const people = getRepubblicaGraph().people;
  const surnameFrequency = new Map<string, number>();
  for (const person of people) {
    const surname = normalize(person.lastName);
    surnameFrequency.set(surname, (surnameFrequency.get(surname) ?? 0) + 1);
  }
  candidateIndex = people.map((person) => {
    const surname = normalize(person.lastName);
    return {
      id: person.id,
      name: person.displayName,
      chamber: person.chamberId,
      groupId: person.groupId,
      groupLabel: person.groupShortLabel ?? person.groupLabel,
      role: person.primaryRoleLabel,
      fullName: normalize(person.displayName),
      // A surname shared by two members of parliament cannot identify anybody in a headline.
      surname: surname.length >= 5 && surnameFrequency.get(surname) === 1 ? foldAccents(person.lastName) : null,
    };
  });
  return candidateIndex;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** People quoted in the same headlines as the person in focus. */
function buildConnections(personId: string, articles: NewsArticle[]): NewsConnection[] {
  const byPerson = new Map<string, Set<string>>();
  for (const article of articles) {
    const title = normalize(article.title);
    // Surnames are matched with the capitalisation of the headline, otherwise
    // ordinary words ("piano", "conte", "monti") would quote a senator.
    const printedTitle = foldAccents(article.title);
    for (const candidate of getCandidates()) {
      if (candidate.id === personId) continue;
      const quoted =
        title.includes(candidate.fullName) ||
        (candidate.surname !== null &&
          new RegExp(
            `(?:^|\\s)(?:${escapeRegExp(candidate.surname)}|${escapeRegExp(candidate.surname.toLocaleUpperCase("it-IT"))})(?:\\s|$)`,
            "u",
          ).test(printedTitle));
      if (!quoted) continue;
      const urls = byPerson.get(candidate.id) ?? new Set<string>();
      urls.add(article.url);
      byPerson.set(candidate.id, urls);
    }
  }
  const candidates = new Map(getCandidates().map((candidate) => [candidate.id, candidate]));
  return [...byPerson.entries()]
    .map(([id, urls]) => {
      const candidate = candidates.get(id)!;
      return {
        person: {
          id: candidate.id,
          name: candidate.name,
          chamber: candidate.chamber,
          groupId: candidate.groupId,
          groupLabel: candidate.groupLabel,
          role: candidate.role,
        },
        articleCount: urls.size,
        articleUrls: [...urls],
      } satisfies NewsConnection;
    })
    .sort((a, b) => b.articleCount - a.articleCount || a.person.name.localeCompare(b.person.name, "it"))
    .slice(0, MAX_CONNECTIONS);
}

async function loadPersonNews(personId: string, displayName: string, signal: AbortSignal): Promise<PersonNews> {
  let provider: NewsProvider = PROVIDERS["google-news"];
  let articles: NewsArticle[];
  try {
    articles = await fetchGoogleNews(displayName, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // One index down is not a failure of the feature: fall back to the other one.
    provider = PROVIDERS.gdelt;
    articles = await fetchGdelt(displayName, signal);
  }
  return {
    articles,
    connections: buildConnections(personId, articles),
    provider,
    observedAt: new Date().toISOString(),
  };
}

export function readCachedPersonNews(personId: string): PersonNews | null {
  const entry = cache.get(personId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(personId);
    return null;
  }
  return entry.payload;
}

/**
 * Cached news of a person. Concurrent readers share a single upstream call, and
 * the call owns its own deadline: a reader who walks away does not cancel the
 * work that is about to fill the cache for everybody else.
 */
export function getPersonNews(personId: string, displayName: string): Promise<PersonNews> {
  const cached = readCachedPersonNews(personId);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(personId);
  if (pending) return pending;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("News upstream deadline", "TimeoutError")), UPSTREAM_TIMEOUT_MS);
  const task = loadPersonNews(personId, displayName, controller.signal)
    .then((payload) => {
      cache.set(personId, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
      return payload;
    })
    .finally(() => {
      clearTimeout(timer);
      inFlight.delete(personId);
    });
  inFlight.set(personId, task);
  return task;
}
