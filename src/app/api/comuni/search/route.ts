import { displayMunicipalityName, searchComuni } from "@/lib/comuni-footprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_QUERY = 2;
const MAX_QUERY = 120;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 14;

function parseLimit(value: string | null): number {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d+$/u.test(value)) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  const limit = parseLimit(params.get("limit"));

  if (query.length < MIN_QUERY) {
    return Response.json(
      { ok: true, query, hits: [] as const },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const hits = searchComuni(query, limit).map((hit) => ({
    codiceIpa: hit.codiceIpa,
    label: displayMunicipalityName(hit.name),
    detail: hit.codiceIpa,
  }));

  return Response.json(
    { ok: true, query, hits },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
