import { NextResponse } from "next/server";
import { mefParticipationsSnapshot } from "@/lib/mef-participations-snapshot";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      scope: "Aggregato nazionale della rilevazione annuale MEF; nessun record societario inventato.",
      snapshot: mefParticipationsSnapshot,
    },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
