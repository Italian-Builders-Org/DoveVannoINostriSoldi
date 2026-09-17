import { NextResponse } from "next/server";
import {
  getIpaEntityByCode,
  IPA_ENTI_DATASET_URL,
  IPA_ENTI_RESOURCE_ID,
  IPA_LICENSE,
} from "@/lib/ipa";
import { decodeEntityProcurementRouteCode } from "@/lib/data/anac-entity-procurement-page";
import { getMunicipalityProfile } from "@/lib/municipality-profile";
import { municipalitySnapshotEntity } from "@/lib/municipality-snapshot-entity";
import { getSiopeMunicipalityDetailByIpaCode } from "@/lib/siope-municipality-detail";
import { runWithRequestBudget } from "@/lib/search/request-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const IPA_ENTITY_REQUEST_TIMEOUT_MS = 6_000;

type RouteContext = {
  params: Promise<{ codice: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { codice } = await context.params;
  const normalized = decodeEntityProcurementRouteCode(codice);

  if (!normalized) {
    return NextResponse.json({ ok: false, error: "Codice IPA non valido" }, { status: 400 });
  }

  try {
    const outcome = await runWithRequestBudget(
      request.signal,
      IPA_ENTITY_REQUEST_TIMEOUT_MS,
      async (signal) => {
        const municipalitySnapshot = getSiopeMunicipalityDetailByIpaCode(normalized);
        const snapshotEntity = municipalitySnapshot
          ? municipalitySnapshotEntity(municipalitySnapshot)
          : null;
        const entity = snapshotEntity ?? await getIpaEntityByCode(normalized, signal);
        return { municipalitySnapshot, snapshotEntity, entity };
      },
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
    const { municipalitySnapshot, snapshotEntity, entity } = outcome.value;

    if (!entity) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ente non trovato nel dataset IPA",
          codiceIpa: normalized,
        },
        { status: 404 },
      );
    }
    const snapshotOnly = snapshotEntity !== null;
    const municipalityProfile = await getMunicipalityProfile(entity, {
      allowCommittedIstatIdentity: snapshotOnly,
    });
    const snapshotObservedAt = municipalitySnapshot?.years[0]?.observedAt ?? null;

    return NextResponse.json(
      {
        ok: true,
        source: {
          name: snapshotOnly
            ? "Snapshot comunale SIOPE con identificativi IPA verificati"
            : "Indice PA (IPA) · dataset Enti",
          owner: snapshotOnly
            ? "Ragioneria Generale dello Stato + Agenzia per l'Italia Digitale"
            : "Agenzia per l'Italia Digitale",
          datasetUrl: IPA_ENTI_DATASET_URL,
          resourceId: IPA_ENTI_RESOURCE_ID,
          license: IPA_LICENSE,
          cadence: snapshotOnly ? "snapshot ETL" : "giornaliera",
          mode: snapshotOnly ? "snapshot" : "live",
        },
        observedAt: snapshotObservedAt ?? new Date().toISOString(),
        record: entity,
        municipalityProfile,
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
