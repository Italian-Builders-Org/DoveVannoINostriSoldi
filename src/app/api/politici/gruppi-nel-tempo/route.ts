import { getRepubblicaGroupTimeline } from "@/lib/politici-repubblica";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Group composition over the XIX (#556). One URL without parameters, built with
 * the deployment and fetched only when a visitor opens the hemicycle's time
 * slider: the atlas page does not carry it.
 */
export async function GET() {
  return Response.json(getRepubblicaGroupTimeline(), {
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
