import { NextRequest, NextResponse } from "next/server";
import {
  IPA_ENTI_DATASET_URL,
  IPA_ENTI_RESOURCE_ID,
  IPA_LICENSE,
  searchIpaEntities,
} from "@/lib/ipa";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const IPA_SEARCH_REQUEST_TIMEOUT_MS = 6_000;

function integerParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = integerParam(request.nextUrl.searchParams.get("limit"), 20);
  const offset = integerParam(request.nextUrl.searchParams.get("offset"), 0);

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      IPA_SEARCH_REQUEST_TIMEOUT_MS,
      (signal) => searchIpaEntities({ query, limit, offset, signal }),
    );
    if (outcome.timedOut) {
      return NextResponse.json(
        { ok: false, source: "Indice PA (IPA)", error: "La fonte IPA ha superato il tempo massimo." },
        {
          status: 504,
          headers: { "Cache-Control": "private, no-store", "Retry-After": "10" },
        },
      );
    }
    const result = outcome.value;

    return NextResponse.json(
      {
        ok: true,
        source: {
          name: "Indice PA (IPA) · dataset Enti",
          owner: "Agenzia per l'Italia Digitale",
          datasetUrl: IPA_ENTI_DATASET_URL,
          resourceId: IPA_ENTI_RESOURCE_ID,
          license: IPA_LICENSE,
          cadence: "giornaliera",
        },
        query: query || null,
        total: result.total,
        count: result.records.length,
        offset: Math.max(0, offset),
        observedAt: result.observedAt,
        records: result.records,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return NextResponse.json(
      {
        ok: false,
        source: "Indice PA (IPA)",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: 503 },
    );
  }
}
