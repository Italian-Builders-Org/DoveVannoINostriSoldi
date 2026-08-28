import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_MAX_LIMIT,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  searchGlobal,
} from "@/lib/global-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boundedLimit(value: string | null): number {
  if (!value) return GLOBAL_SEARCH_DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return GLOBAL_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), GLOBAL_SEARCH_MAX_LIMIT);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (query.length > 0 && query.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    return Response.json(
      {
        ok: true,
        query,
        groups: [],
        total: 0,
        hasMore: false,
        staticTotal: 0,
        entityTotal: 0,
        entitiesAvailable: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const result = await searchGlobal({ query, limit: boundedLimit(params.get("limit")) });
  return Response.json(result, {
    headers: {
      // Search is interactive and backed by a changing public registry. Avoid
      // replaying a stale empty prefix result from the browser or an edge cache.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
