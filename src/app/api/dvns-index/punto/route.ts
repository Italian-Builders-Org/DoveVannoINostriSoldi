import { displayMunicipalityName } from "@/lib/comuni-search";
import { regionName } from "@/lib/dvns-index";
import { IndexSnapshotUnavailableError, loadDvnsIndex } from "@/lib/dvns-index-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "X-Content-Type-Options": "nosniff" } as const;

function index(value: string | null): number | null {
  if (value === null || !/^\d{1,3}$/u.test(value)) return null;
  return Number(value);
}

/**
 * The Comuni behind one dot of the DVNS Index chart. At most 50 x ~30 valid
 * (column, row) pairs, answered from the in-memory snapshot: cacheable.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const column = index(params.get("colonna"));
  const row = index(params.get("riga"));
  let data;
  try {
    data = await loadDvnsIndex();
  } catch (error) {
    if (error instanceof IndexSnapshotUnavailableError) {
      return Response.json({ ok: false, error: "DVNS Index non disponibile." }, { status: 503, headers: { ...HEADERS, "Cache-Control": "no-store" } });
    }
    throw error;
  }
  const members = column === null || row === null ? undefined : data.dots[column]?.[row];
  if (!members) {
    return Response.json({ ok: false, error: "Punto inesistente." }, { status: 404, headers: { ...HEADERS, "Cache-Control": "no-store" } });
  }
  return Response.json(
    {
      ok: true,
      members: members.map((entry) => ({
        istat: entry.istat,
        name: displayMunicipalityName(entry.name),
        region: regionName(entry.regionCode),
        score: entry.score,
        band: entry.band,
        rank: entry.rank,
      })),
    },
    { headers: { ...HEADERS, "Cache-Control": "public, max-age=300, s-maxage=3600" } },
  );
}
