import {
  loadInvestigativeExplorer,
  buildSearchIndex,
  searchExplorer,
  type Relation,
  type SearchIndex,
} from "@/lib/investigative-explorer";
import {
  EXPLORER_DEFAULT_RESULT_LIMIT,
  EXPLORER_MAX_QUERY_BYTES,
  EXPLORER_MAX_QUERY_LENGTH,
  EXPLORER_MAX_RESULT_LIMIT,
} from "@/lib/investigative-explorer-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const MAX_RESPONSE_BYTES = 750 * 1024;

let indexCache: SearchIndex | null = null;

function getIndex(): SearchIndex {
  if (!indexCache) {
    indexCache = buildSearchIndex(loadInvestigativeExplorer().relations);
  }
  return indexCache;
}

function projectRelation(relation: Relation) {
  if (!relation) return null;
  return {
    id: relation.id,
    relation_type: relation.relation_type,
    subject_type: relation.subject_type,
    subject_key: relation.subject_key,
    object_type: relation.object_type,
    object_key: relation.object_key,
    source_dataset: relation.source_dataset,
    source_record_id: relation.source_record_id,
    period: relation.period,
    acquisition_date: relation.acquisition_date,
    confidence_note: relation.confidence_note,
    role: relation.role ?? null,
    amount: relation.amount ?? null,
    ipa: relation.ipa ?? null,
    source_url: relation.source_url ?? null,
    references: relation.references,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  const payload = JSON.stringify(body);
  if (new TextEncoder().encode(payload).byteLength > MAX_RESPONSE_BYTES) {
    return Response.json({ error: "Risposta troppo grande." }, { status: 413, headers: RESPONSE_HEADERS });
  }
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) headers.set(name, value);
  return new Response(payload, {
    ...init,
    headers,
  });
}

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const rawLimit = searchParams.get("limit");
  const parsed = rawLimit === null ? EXPLORER_DEFAULT_RESULT_LIMIT : Number(rawLimit);
  if (
    rawLimit !== null
    && (
      !/^\d+$/.test(rawLimit)
      || !Number.isSafeInteger(parsed)
      || parsed < 1
      || parsed > EXPLORER_MAX_RESULT_LIMIT
    )
  ) {
    return jsonResponse(
      { error: `Il parametro limit deve essere un intero tra 1 e ${EXPLORER_MAX_RESULT_LIMIT}.` },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const limit = parsed;

  if (
    q.length > EXPLORER_MAX_QUERY_LENGTH
    || new TextEncoder().encode(q).byteLength > EXPLORER_MAX_QUERY_BYTES
  ) {
    return jsonResponse(
      { error: `La ricerca non può superare ${EXPLORER_MAX_QUERY_LENGTH} caratteri.` },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  if (!q) {
    return jsonResponse({
      dataset: "incarichi-nominativi-shard",
      disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
      hint: "Passa ?q=<termine> per cercare persone, enti o riferimenti CIG/CUP.",
    }, { headers: RESPONSE_HEADERS });
  }

  let results;
  try {
    results = searchExplorer(getIndex(), q, limit).map(projectRelation).filter(Boolean);
  } catch {
    return jsonResponse(
      { error: "Il dataset dell'esploratore non è disponibile." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
  let projected = results;
  let truncated = false;
  const responseBody = () => ({
    query: q,
    count: projected.length,
    dataset: "incarichi-nominativi-shard",
    disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
    truncated,
    results: projected,
  });
  while (new TextEncoder().encode(JSON.stringify(responseBody())).byteLength > MAX_RESPONSE_BYTES && projected.length > 0) {
    projected = projected.slice(0, -1);
    truncated = true;
  }
  return jsonResponse(responseBody(), { headers: RESPONSE_HEADERS });
}
