import { getRepubblicaGraph, getRepubblicaProfiles } from "@/lib/politici-repubblica";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Full profiles of every person in the institutional map. The page ships only
 * the compact map and pulls this asset once, off the critical path, so the first
 * render stays light while every panel opens without a round trip.
 */
export async function GET() {
  const graph = getRepubblicaGraph();
  return Response.json(
    {
      ok: true,
      legislature: graph.legislature,
      updatedAt: graph.updatedAt,
      sources: graph.sources,
      profiles: getRepubblicaProfiles(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
