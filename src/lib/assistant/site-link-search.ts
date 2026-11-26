import "server-only";

import type { AiSiteLink } from "@/lib/assistant/byok-contracts";
import { cleanSiteLink, sitePageKey, sitePathname } from "@/lib/assistant/site-link-map";
import { normalizeSearchText, searchSiteDocuments, type SearchMatchReason, type SearchResult } from "@/lib/global-search";

/** Upper bound on full index scans per answer: one per probe. */
export const MAX_SEARCH_PROBES = 5;

// Acceptance follows the search engine's match reason rather than its numeric
// score, so retuning the ranking scale cannot silently change what we link to.
const TITLE: ReadonlySet<SearchMatchReason> = new Set(["title-exact", "title-prefix", "title-tokens"]);
const TITLE_OR_ALIAS: ReadonlySet<SearchMatchReason> = new Set([...TITLE, "alias"]);
const ANY_FIELD: ReadonlySet<SearchMatchReason> = new Set([...TITLE_OR_ALIAS, "description"]);

const EXCLUDED_PATHS = new Set(["/", "/cerca", "/privacy", "/termini", "/accedi", "/dashboard", "/supporto", "/supporter"]);
const EXCLUDED_PREFIXES = ["/mcp", "/api/", "/assistente", "/enti/"];
// Studies cover one topic in depth: suggest one only when its title matches.
const TITLE_ONLY_PREFIXES = ["/studi/", "/paper/"];

/** Question words and terms too broad to identify a page on their own. */
const STOPWORDS = new Set([
  "cosa", "come", "dove", "quando", "quale", "quali", "quanto", "quanta", "quanti", "quante",
  "perche", "chi", "che", "cui", "sono", "siete", "sei", "puoi", "posso", "potete", "vuoi",
  "hanno", "avete", "abbiamo", "fanno", "fare", "fatto", "stato", "stati", "stata", "state",
  "sito", "pagina", "pagine", "sezione", "sezioni", "dati", "dato", "pubblici", "pubblico",
  "pubblica", "pubbliche", "italia", "italiana", "italiano", "italiani", "italiane", "anno",
  "anni", "mese", "mesi", "euro", "milioni", "miliardi", "totale", "totali", "speso", "spesa",
  "spese", "soldi", "approfondire", "trovare", "trovo", "vedere", "vedo", "cercare", "cerco",
  "leggere", "capire", "sapere", "spiegami", "spiega", "dimmi", "mostra", "mostrami", "parlami",
  "del", "della", "dello", "dei", "degli", "delle", "nel", "nella", "nello", "nei", "negli",
  "nelle", "sul", "sulla", "sullo", "sui", "sugli", "sulle", "con", "per", "tra", "fra", "senza",
  "sopra", "sotto", "dopo", "prima", "piu", "meno", "molto", "poco", "tutto", "tutti", "tutte",
  "questo", "questa", "questi", "queste", "quello", "quella", "quelli", "quelle", "anche", "solo",
  "soltanto", "oppure", "ciao", "salve", "buongiorno", "buonasera", "grazie", "aiuto", "oggi",
  "ieri", "domani", "stai", "progetto", "dvns", "vostri", "nostri", "vostro", "nostro", "funziona",
  "usate", "usare", "usano", "avere", "essere", "cambiati", "cambiato", "confronto", "confronta",
  "rispetto", "regione", "regioni", "comune", "comuni", "provincia", "province",
]);

type Probe = Readonly<{ query: string; accept: ReadonlySet<SearchMatchReason> }>;

function probesFor(question: string, hasDatasetLinks: boolean): Probe[] {
  const words = normalizeSearchText(question).split(" ")
    .filter((word) => word.length >= 3 && !/^\d+$/u.test(word) && !STOPWORDS.has(word));
  const unique = [...new Set(words)];
  if (!unique.length) return [];
  const probes: Probe[] = [];
  // The index requires every query word to match one field, so a whole-question
  // probe only helps for short questions; longer ones are split into pairs and words.
  if (unique.length >= 2 && unique.length <= 4) probes.push({ query: unique.join(" "), accept: ANY_FIELD });
  for (let index = 0; index + 1 < unique.length && probes.length < 3; index += 1) {
    probes.push({ query: `${unique[index]} ${unique[index + 1]}`, accept: TITLE_OR_ALIAS });
  }
  const distinctive = unique.filter((word) => word.length >= 5).sort((a, b) => b.length - a.length);
  for (const word of distinctive) {
    if (probes.length >= MAX_SEARCH_PROBES) break;
    probes.push({ query: word, accept: hasDatasetLinks ? TITLE : TITLE_OR_ALIAS });
  }
  return probes;
}

function eligible(hit: SearchResult, accept: ReadonlySet<SearchMatchReason>): boolean {
  if (hit.type !== "pagina" && hit.type !== "sezione") return false;
  if (!accept.has(hit.match.reason)) return false;
  const pathname = sitePathname(hit.href);
  if (EXCLUDED_PATHS.has(pathname) || EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return !TITLE_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || TITLE.has(hit.match.reason);
}

/**
 * Site pages and sections matching the question, best first. Earlier probes are
 * more specific, so they rank first; a page found by several probes moves up.
 */
export function searchSiteLinks(
  question: string,
  { hasDatasetLinks, search = searchSiteDocuments }: { hasDatasetLinks: boolean; search?: (query: string) => readonly SearchResult[] },
): AiSiteLink[] {
  const found = new Map<string, { hit: SearchResult; probe: number; hits: number }>();
  probesFor(question, hasDatasetLinks).forEach((probe, index) => {
    for (const hit of search(probe.query)) {
      if (!eligible(hit, probe.accept)) continue;
      const key = sitePageKey(hit.href);
      const current = found.get(key);
      found.set(key, current
        ? { hit: hit.score > current.hit.score ? hit : current.hit, probe: current.probe, hits: current.hits + 1 }
        : { hit, probe: index, hits: 1 });
    }
  });
  return [...found.values()]
    .sort((left, right) => left.probe - right.probe || right.hits - left.hits || right.hit.score - left.hit.score || left.hit.href.localeCompare(right.hit.href))
    .map(({ hit }) => cleanSiteLink({ href: hit.href, title: hit.title, ...(hit.description || hit.context ? { description: hit.description ?? hit.context } : {}) }))
    .filter((link): link is AiSiteLink => link !== null);
}
