import { getPersonNews, readCachedPersonNews, type PersonNews } from "@/lib/politici-news";
import { findRepublicPerson } from "@/lib/politici-repubblica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** How long a reader waits before we answer "retry": the work keeps going server-side. */
const RESPONSE_BUDGET_MS = 6_000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function payloadResponse(
  person: { id: string; displayName: string; chamberId: string | null; primaryRoleLabel: string },
  news: PersonNews,
  cached: boolean,
): Response {
  return Response.json(
    {
      ok: true,
      person: {
        id: person.id,
        name: person.displayName,
        chamber: person.chamberId,
        role: person.primaryRoleLabel,
      },
      observedAt: news.observedAt,
      cached,
      provider: news.provider,
      articles: news.articles,
      connections: news.connections,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=21600",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const person = findRepublicPerson(id);
  if (!person) {
    return Response.json(
      { ok: false, error: "Persona non trovata." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cached = readCachedPersonNews(person.id);
  if (cached) return payloadResponse(person, cached, true);

  const task = getPersonNews(person.id, person.displayName);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), RESPONSE_BUDGET_MS);
  });

  try {
    const news = await Promise.race([task, deadline]);
    if (news) return payloadResponse(person, news, false);
    // The lookup is still running and will populate the cache: ask for one retry
    // instead of holding the connection open.
    return Response.json(
      { ok: false, error: "Ricerca delle notizie in corso.", retry: true },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "3" } },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    console.warn("Politici news lookup failed", {
      personId: person.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { ok: false, error: "Le notizie non sono disponibili in questo momento.", retry: false },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
