import { NextResponse } from "next/server";
import {
  loadInvestigativeExplorer,
  buildSearchIndex,
  searchExplorer,
  type SearchIndex,
} from "@/lib/investigative-explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let indexCache: SearchIndex | null = null;

function getIndex(): SearchIndex {
  if (!indexCache) {
    indexCache = buildSearchIndex(loadInvestigativeExplorer().relations);
  }
  return indexCache;
}

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const parsed = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;

  if (!q.trim()) {
    return NextResponse.json({
      dataset: "incarichi-nominativi-shard",
      disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
      hint: "Passa ?q=<termine> per cercare persone, enti, CIG/CUP o atti (inclusi nei campi e nelle note).",
    });
  }

  const results = searchExplorer(getIndex(), q, limit);
  return NextResponse.json({
    query: q,
    count: results.length,
    dataset: "incarichi-nominativi-shard",
    disclaimer: "Collegamento = segnale da approfondire, non un'illegittimita'.",
    results,
  });
}
