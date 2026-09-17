import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  GLOBAL_SEARCH_MAX_LIMIT,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  searchGlobal,
  searchGlobalLocalFallback,
} from "@/lib/global-search";
import { runWithRequestBudget } from "@/lib/search/request-budget";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_REQUEST_TIMEOUT_MS = 5_000;
const searchLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 60 });
const searchConcurrency = new ConcurrencyLimiter(8);

function parseLimit(value: string | null): number | null {
  if (value === null) return GLOBAL_SEARCH_DEFAULT_LIMIT;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > GLOBAL_SEARCH_MAX_LIMIT) {
    return null;
  }
  return parsed;
}

function errorResponse(
  message: string,
  status = 400,
  headers: HeadersInit = {},
): Response {
  return Response.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
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

  const clientKey = clientAddress(request) ?? "unknown";
  if (!searchLimiter.consume(clientKey)) {
    return errorResponse("Troppe ricerche. Riprova tra un minuto.", 429, {
      "Retry-After": "60",
    });
  }

  const release = searchConcurrency.tryAcquire();
  if (!release) {
    return errorResponse("Ricerca temporaneamente occupata. Riprova tra pochi secondi.", 503, {
      "Retry-After": "5",
    });
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      SEARCH_REQUEST_TIMEOUT_MS,
      (signal) => searchGlobal({ query, limit, signal }),
    );
    if (outcome.timedOut) {
      console.warn("Search request deadline exceeded", {
        timeoutMs: SEARCH_REQUEST_TIMEOUT_MS,
      });
      return errorResponse("La ricerca ha superato il tempo massimo.", 504, {
        "Retry-After": "10",
      });
    }

    return Response.json(outcome.value, {
      headers: {
        // Search is interactive and backed by a changing public registry. Avoid
        // replaying a stale empty prefix result from the browser or an edge cache.
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    // Never let an unexpected IPA/runtime failure become HTTP 429/5xx here.
    return searchJson(searchGlobalLocalFallback({ query, limit }));
  } finally {
    release();
  }
}
