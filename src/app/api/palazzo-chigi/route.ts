import { NextRequest, NextResponse } from "next/server.js";
import {
  pcmFinancialMetadata,
  pcmFinancialSnapshot,
} from "@/lib/pcm-financial-snapshot";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const rawYear = request.nextUrl.searchParams.get("anno")?.trim();
  if (rawYear && rawYear !== String(pcmFinancialSnapshot.referenceYear)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Il rendiconto richiesto non è disponibile.",
        availableYears: [pcmFinancialSnapshot.referenceYear],
      },
      { status: 404 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      data: pcmFinancialSnapshot,
      provenance: pcmFinancialMetadata,
    },
    { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
