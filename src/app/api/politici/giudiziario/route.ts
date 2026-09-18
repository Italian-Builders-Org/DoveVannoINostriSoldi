import { casesByGraphPerson, getParlamentoGiudiziario, judicialCoverageNote } from "@/lib/parlamento-giudiziario";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Documented judicial proceedings of the XIX-legislature members, grouped by the
 * id the institutional map already uses. The page ships only the list of people
 * with at least one case and pulls this asset once, off the critical path.
 */
export async function GET() {
  const snapshot = getParlamentoGiudiziario();
  // Keyed by the id the map uses for a person, so the panel needs no translation.
  const byPerson = casesByGraphPerson();

  return Response.json(
    {
      ok: true,
      dataset: snapshot.dataset,
      legislature: snapshot.legislature,
      coverage: snapshot.coverage,
      coverageNote: judicialCoverageNote(),
      source: snapshot.source,
      caveats: snapshot.caveats,
      totals: snapshot.totals,
      byPerson,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
