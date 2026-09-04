import { NextResponse } from "next/server";
import {
  getIpaOrganizationStructure,
  IPA_AOO_DATASET_URL,
  IPA_AOO_RESOURCE_ID,
  IPA_UO_DATASET_URL,
  IPA_UO_RESOURCE_ID,
} from "@/lib/ipa-structure";
import { IPA_LICENSE } from "@/lib/ipa";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const IPA_STRUCTURE_REQUEST_TIMEOUT_MS = 6_000;

type RouteContext = {
  params: Promise<{ codice: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { codice } = await context.params;
  const normalized = decodeURIComponent(codice).trim();
  const requestedLimit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "250", 10);
  const requestedOffset = Number.parseInt(new URL(request.url).searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : 250;
  const offset = Number.isFinite(requestedOffset)
    ? Math.min(Math.max(requestedOffset, 0), 100_000)
    : 0;

  if (!normalized) {
    return NextResponse.json({ ok: false, error: "Codice IPA mancante" }, { status: 400 });
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      IPA_STRUCTURE_REQUEST_TIMEOUT_MS,
      (signal) => getIpaOrganizationStructure(normalized, limit, offset, { signal }),
    );
    if (outcome.timedOut) {
      return NextResponse.json(
        { ok: false, source: "Indice PA (IPA) · struttura", error: "La fonte IPA ha superato il tempo massimo." },
        {
          status: 504,
          headers: { "Cache-Control": "private, no-store", "Retry-After": "10" },
        },
      );
    }
    const structure = outcome.value;
    return NextResponse.json(
      {
        ok: true,
        source: {
          owner: "Agenzia per l'Italia Digitale",
          license: IPA_LICENSE,
          cadence: "giornaliera",
          datasets: [
            { name: "Unità Organizzative", url: IPA_UO_DATASET_URL, resourceId: IPA_UO_RESOURCE_ID },
            { name: "Aree Organizzative Omogenee", url: IPA_AOO_DATASET_URL, resourceId: IPA_AOO_RESOURCE_ID },
          ],
        },
        structure,
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return NextResponse.json(
      {
        ok: false,
        source: "Indice PA (IPA) · struttura",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Errore sconosciuto",
      },
      { status: 503 },
    );
  }
}
