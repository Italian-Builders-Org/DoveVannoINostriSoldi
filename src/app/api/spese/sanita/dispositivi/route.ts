import type { NextRequest } from "next/server";
import {
  MedicalDeviceQueryError,
  aggregateMedicalDeviceSpending,
  getMedicalDeviceProfile,
  listMedicalDeviceAggregateFacts,
  listMedicalDeviceFacts,
  listMedicalDeviceFilters,
  searchMedicalDevices,
} from "@/lib/medical-device-spending";

const VIEW_PARAMS: Readonly<Record<string, ReadonlySet<string>>> = {
  filtri: new Set(),
  ricerca: new Set(["q", "tipo", "anno", "regione", "azienda", "limit", "cursor"]),
  aggregati: new Set(["anno", "regione", "azienda", "dimensione", "limit", "cursor"]),
  dispositivo: new Set(["tipo", "numero", "anno", "regione", "azienda", "limit", "cursor"]),
  righe: new Set(["anno", "regione", "azienda", "dimensione", "valore", "ruolo", "limit", "cursor"]),
};

function singleParam(request: NextRequest, key: string): string | undefined {
  const values = request.nextUrl.searchParams.getAll(key);
  if (values.length > 1) throw new MedicalDeviceQueryError(`Il parametro ${key} non può essere ripetuto.`);
  return values[0] || undefined;
}

function integerParam(request: NextRequest, key: string, minimum: number, maximum: number): number | undefined {
  const value = singleParam(request, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new MedicalDeviceQueryError(`Il parametro ${key} deve essere un intero.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new MedicalDeviceQueryError(`Il parametro ${key} è fuori intervallo.`);
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const view = singleParam(request, "vista") ?? "ricerca";
    const viewParams = VIEW_PARAMS[view];
    if (!viewParams) throw new MedicalDeviceQueryError("vista non valida.");
    for (const key of request.nextUrl.searchParams.keys()) {
      if (key !== "vista" && !viewParams.has(key)) {
        throw new MedicalDeviceQueryError(`Il parametro ${key} non è valido per la vista ${view}.`);
      }
    }
    const common = {
      year: singleParam(request, "anno"),
      region: singleParam(request, "regione"),
      company: singleParam(request, "azienda"),
      limit: integerParam(request, "limit", 1, 100),
      cursor: singleParam(request, "cursor"),
      signal: request.signal,
    };
    const payload = view === "filtri"
      ? listMedicalDeviceFilters()
      : view === "ricerca"
        ? await searchMedicalDevices({
          q: singleParam(request, "q"), type: singleParam(request, "tipo"), ...common,
        })
        : view === "aggregati"
          ? await aggregateMedicalDeviceSpending({
            ...common, dimension: singleParam(request, "dimensione"), year: common.year,
          })
          : view === "dispositivo"
            ? {
              profile: await getMedicalDeviceProfile({
                type: singleParam(request, "tipo"), number: singleParam(request, "numero"), signal: request.signal,
              }),
              facts: await listMedicalDeviceFacts({
                type: singleParam(request, "tipo"), number: singleParam(request, "numero"), ...common,
              }),
            }
            : view === "righe"
              ? await listMedicalDeviceAggregateFacts({
                ...common,
                year: common.year,
                dimension: singleParam(request, "dimensione"),
                value: singleParam(request, "valore") ?? null,
                role: singleParam(request, "ruolo") ?? null,
              })
              : (() => { throw new MedicalDeviceQueryError("vista non valida."); })();
    return Response.json(payload, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    if (!(error instanceof MedicalDeviceQueryError)) throw error;
    const message = error.message;
    const status = message.includes("non presente") ? 404 : 400;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
