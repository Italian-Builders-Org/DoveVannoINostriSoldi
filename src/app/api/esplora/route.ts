import { NextResponse } from "next/server";
import { searchRelations } from "@/lib/investigative-explorer";

export const dynamic = "force-static";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const parsed = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
  const results = searchRelations(q, limit);
  return NextResponse.json({
    query: q,
    count: results.length,
    dataset: "incarichi-nominativi-shard",
    disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
    results,
  });
}
