import { getPoliticiParlamentoSnapshot, findParliamentPerson } from "@/lib/politici-parlamento";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const REQUEST_TIMEOUT_MS = 7_000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  socialimage?: unknown;
  domain?: unknown;
  language?: unknown;
  sourcecountry?: unknown;
};

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function parseSeenDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("it-IT");
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const person = findParliamentPerson(id);
  if (!person) {
    return Response.json(
      { ok: false, error: "Persona non trovata." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const endpoint = new URL(GDELT_DOC_URL);
  endpoint.searchParams.set("query", `"${person.displayName}" sourcelang:italian`);
  endpoint.searchParams.set("mode", "artlist");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("timespan", "3m");
  endpoint.searchParams.set("maxrecords", "25");
  endpoint.searchParams.set("sort", "datedesc");

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      REQUEST_TIMEOUT_MS,
      async (signal) => {
        const response = await fetch(endpoint, {
          signal,
          headers: { Accept: "application/json", "User-Agent": "DoveVannoINostriSoldi/1.0" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("json")) throw new Error("GDELT non ha restituito JSON");
        return response.json() as Promise<{ articles?: GdeltArticle[] }>;
      },
    );
    if (outcome.timedOut) {
      return Response.json(
        { ok: false, error: "La ricerca delle notizie ha superato il tempo massimo." },
        { status: 504, headers: { "Cache-Control": "no-store", "Retry-After": "10" } },
      );
    }

    const seenUrls = new Set<string>();
    const articles = (outcome.value.articles ?? []).flatMap((article) => {
      const url = safeHttpUrl(article.url);
      const title = typeof article.title === "string" ? article.title.trim() : "";
      if (!url || !title || seenUrls.has(url)) return [];
      seenUrls.add(url);
      return [{
        title,
        url,
        source: typeof article.domain === "string" ? article.domain : new URL(url).hostname,
        publishedAt: parseSeenDate(article.seendate),
        imageUrl: safeHttpUrl(article.socialimage),
        language: typeof article.language === "string" ? article.language : null,
        sourceCountry: typeof article.sourcecountry === "string" ? article.sourcecountry : null,
      }];
    });
    const parliament = getPoliticiParlamentoSnapshot();
    const surnameFrequency = new Map<string, number>();
    for (const candidate of parliament.people) {
      const surname = normalizeForMatch(candidate.lastName);
      surnameFrequency.set(surname, (surnameFrequency.get(surname) ?? 0) + 1);
    }
    const connectionArticles = new Map<string, Set<string>>();
    for (const article of articles) {
      const title = normalizeForMatch(article.title);
      for (const candidate of parliament.people) {
        if (candidate.id === person.id) continue;
        const fullName = normalizeForMatch(candidate.displayName);
        const surname = normalizeForMatch(candidate.lastName);
        const matchesFullName = title.includes(fullName);
        const matchesUniqueSurname = surname.length >= 5
          && surnameFrequency.get(surname) === 1
          && new RegExp(`(?:^|\\s)${escapeRegExp(surname)}(?:\\s|$)`, "u").test(title);
        if (!matchesFullName && !matchesUniqueSurname) continue;
        const urls = connectionArticles.get(candidate.id) ?? new Set<string>();
        urls.add(article.url);
        connectionArticles.set(candidate.id, urls);
      }
    }
    const connections = [...connectionArticles.entries()]
      .map(([personId, urls]) => {
        const candidate = parliament.people.find((item) => item.id === personId)!;
        return {
          person: {
            id: candidate.id,
            name: candidate.displayName,
            chamber: candidate.chamber,
            groupId: candidate.groupId,
            groupLabel: candidate.groupLabel,
          },
          articleCount: urls.size,
          articleUrls: [...urls],
        };
      })
      .sort((a, b) => b.articleCount - a.articleCount || a.person.name.localeCompare(b.person.name, "it"))
      .slice(0, 12);

    return Response.json(
      {
        ok: true,
        person: { id: person.id, name: person.displayName, chamber: person.chamber },
        observedAt: new Date().toISOString(),
        coverage: "rolling-3-months",
        provider: {
          name: "GDELT DOC 2.0",
          url: "https://www.gdeltproject.org/",
          note: "Indice live di metadati: titoli, date e link restano dei rispettivi editori.",
        },
        articles,
        connections,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=21600",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    console.warn("Politici news lookup failed", {
      personId: person.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      {
        ok: false,
        error: "Le notizie non sono disponibili in questo momento.",
        provider: "GDELT DOC 2.0",
      },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } },
    );
  }
}
