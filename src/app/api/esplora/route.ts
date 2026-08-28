import {
  loadInvestigativeExplorer,
  buildSearchIndex,
  searchExplorer,
  type SearchIndex,
} from "@/lib/investigative-explorer";
import {
  EXPLORER_DEFAULT_RESULT_LIMIT,
  EXPLORER_MAX_QUERY_LENGTH,
} from "@/lib/investigative-explorer-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

let indexCache: SearchIndex | null = null;

function getIndex(): SearchIndex {
  if (!indexCache) {
    indexCache = buildSearchIndex(loadInvestigativeExplorer().relations);
  }
  return indexCache;
}

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const parsed = Number(searchParams.get("limit") ?? EXPLORER_DEFAULT_RESULT_LIMIT);
  const limit = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 500)
    : EXPLORER_DEFAULT_RESULT_LIMIT;

  if (q.length > EXPLORER_MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `La ricerca non può superare ${EXPLORER_MAX_QUERY_LENGTH} caratteri.` },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  if (!q) {
    return Response.json({
      dataset: "incarichi-nominativi-shard",
      disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
      hint: "Passa ?q=<termine> per cercare persone, enti, CIG/CUP o atti (inclusi nei campi e nelle note).",
    }, { headers: RESPONSE_HEADERS });
  }

  const results = searchExplorer(getIndex(), q, limit);
  return Response.json({
    query: q,
    count: results.length,
    dataset: "incarichi-nominativi-shard",
    disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
    results,
  }, { headers: RESPONSE_HEADERS });
}
