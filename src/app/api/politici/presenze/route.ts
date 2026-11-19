import { getPresenceDistribution } from "@/lib/politici-presenze";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Camera participation table for the atlas "Presenze" view (#871). Built once at
 * build time from the committed snapshot: the page ships it inline only for a
 * deep link to the view, and otherwise pulls this asset when the view opens.
 */
export async function GET() {
  return Response.json(
    { ok: true, ...getPresenceDistribution() },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
