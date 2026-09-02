import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MAX_LIMIT,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  searchGlobal,
  searchGlobalLocalFallback,
} from "@/lib/global-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number | null {
  if (value === null) return GLOBAL_SEARCH_DEFAULT_LIMIT;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > GLOBAL_SEARCH_MAX_LIMIT) {
    return null;
  }
  return parsed;
}

function errorResponse(message: string, status = 400): Response {
  return Response.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function searchJson(body: unknown): Response {
  return Response.json(body, {
    headers: {
      // Search is interactive and backed by a changing public registry. Avoid
      // replaying a stale empty prefix result from the browser or an edge cache.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (query.length > GLOBAL_SEARCH_MAX_QUERY_LENGTH) {
    return errorResponse(
      `La ricerca non può superare ${GLOBAL_SEARCH_MAX_QUERY_LENGTH} caratteri.`,
    );
  }
  const limit = parseLimit(params.get("limit"));
  if (limit === null) {
    return errorResponse(
      `Il parametro limit deve essere un intero tra 1 e ${GLOBAL_SEARCH_MAX_LIMIT}.`,
    );
  }
  if (query.length > 0 && query.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    return searchJson({
      ok: true,
      query,
      groups: [],
      total: 0,
      hasMore: false,
      staticTotal: 0,
      entityTotal: 0,
      entitiesAvailable: true,
    });
  }

  try {
    const result = await searchGlobal({ query, limit, signal: request.signal });
    return searchJson(result);
  } catch (error) {
    if (request.signal.aborted) throw error;
    // Never let an unexpected IPA/runtime failure become HTTP 429/5xx here.
    return searchJson(searchGlobalLocalFallback({ query, limit }));
  }
}
