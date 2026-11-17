import * as z from "zod/v4";
import { loadRomaRealtimeVehiclesCoalesced } from "@/lib/mobilita/roma-vehicles-shared";
import {
  classifyRomaFeedFailure,
  ROMA_OPEN_DATA_URL,
  ROMA_RT_HOLDER,
  ROMA_VEHICLE_POSITIONS_URL,
  type FetchLike,
  type RomaRealtimeVehicle,
} from "@/lib/mobilita/roma-gtfs-realtime";
import { normaliseQuery, vehicleAge } from "@/lib/mobilita/roma-live-model";

export const MOBILITA_ROMA_BUS_LIVE_NOTICE =
  "Dato live, non storico: il portale non archivia le posizioni e non le estrapola oltre il feed ufficiale.";

const PORTAL_BASE =
  "https://www.dovevannoinostrisoldi.com/mappe/mobilita?vista=bus-live";

export const mobilitaRomaBusLiveInputSchema = z
  .object({
    linea: z
      .string()
      .regex(/^[0-9A-Za-z]{1,8}$/, "linea deve essere un codice linea breve (massimo 8 caratteri alfanumerici).")
      .optional(),
    limit: z.number().int().min(1).max(2_500).optional(),
  })
  .strict();

export const mobilitaRomaBusLiveOutputSchema = z.object({
  ok: z.boolean(),
  notice: z.string(),
  portalUrl: z.string(),
  source: z.object({
    holder: z.string(),
    openDataUrl: z.string(),
    feedUrl: z.string(),
    license: z.string(),
  }),
  fetchedAt: z.string().optional(),
  feedTimestamp: z.number().nullable().optional(),
  stale: z.boolean().optional(),
  fallback: z.boolean().optional(),
  feedAgeSeconds: z.number().nullable().optional(),
  linea: z.string().optional(),
  vehicleCount: z.number().optional(),
  returned: z.number().optional(),
  vehicles: z
    .array(
      z.object({
        id: z.string(),
        linea: z.string().nullable(),
        direzione: z.union([z.literal(0), z.literal(1)]).nullable(),
        lat: z.number(),
        lon: z.number(),
        etaPosizione: z.number().nullable(),
        stato: z.enum(["in_arrivo", "fermo", "in_movimento"]).nullable(),
      }),
    )
    .optional(),
  error: z.string().optional(),
});

export type MobilitaRomaBusLiveInput = z.infer<typeof mobilitaRomaBusLiveInputSchema>;
export type MobilitaRomaBusLiveOutput = z.infer<typeof mobilitaRomaBusLiveOutputSchema>;

const STATUS_LABEL: Record<NonNullable<RomaRealtimeVehicle["status"]>, "in_arrivo" | "fermo" | "in_movimento"> = {
  incoming: "in_arrivo",
  stopped: "fermo",
  in_transit: "in_movimento",
};

function portalUrl(linea?: string): string {
  if (!linea) return PORTAL_BASE;
  const params = new URLSearchParams({ vista: "bus-live", linea });
  return `https://www.dovevannoinostrisoldi.com/mappe/mobilita?${params.toString()}`;
}

function matchesLinea(vehicle: RomaRealtimeVehicle, linea: string): boolean {
  if (!vehicle.routeId) return false;
  return normaliseQuery(vehicle.routeId) === normaliseQuery(linea);
}

function compactVehicle(
  vehicle: RomaRealtimeVehicle,
  nowSeconds: number,
): MobilitaRomaBusLiveOutput["vehicles"] extends (infer T)[] | undefined ? T : never {
  return {
    id: vehicle.id,
    linea: vehicle.routeId ?? null,
    direzione: vehicle.directionId ?? null,
    lat: vehicle.lat,
    lon: vehicle.lon,
    etaPosizione: vehicleAge(vehicle, nowSeconds),
    stato: vehicle.status ? STATUS_LABEL[vehicle.status] : null,
  };
}

export async function queryMobilitaRomaBusLive(
  input: MobilitaRomaBusLiveInput,
  options: { fetchImpl?: FetchLike; now?: () => number; signal?: AbortSignal } = {},
): Promise<MobilitaRomaBusLiveOutput> {
  const nowMs = options.now?.() ?? Date.now();
  const source = {
    holder: ROMA_RT_HOLDER,
    openDataUrl: ROMA_OPEN_DATA_URL,
    feedUrl: ROMA_VEHICLE_POSITIONS_URL,
    license: "Licenza open data del titolare (Roma Servizi per la Mobilità)",
  };

  if (options.signal?.aborted) {
    return {
      ok: false,
      notice: MOBILITA_ROMA_BUS_LIVE_NOTICE,
      portalUrl: portalUrl(input.linea),
      source,
      error: "richiesta_annullata",
    };
  }

  try {
    const view = await loadRomaRealtimeVehiclesCoalesced(options.fetchImpl, options.now ?? Date.now);
    const nowSeconds = Math.floor(nowMs / 1000);
    let vehicles = view.vehicles;
    if (input.linea) vehicles = vehicles.filter((vehicle) => matchesLinea(vehicle, input.linea!));
    const limit = input.limit ?? vehicles.length;
    const slice = vehicles.slice(0, limit);
    return {
      ok: true,
      notice: MOBILITA_ROMA_BUS_LIVE_NOTICE,
      portalUrl: portalUrl(input.linea),
      source,
      fetchedAt: view.fetchedAt,
      feedTimestamp: view.feedTimestamp,
      stale: view.stale,
      ...(view.fallback ? { fallback: true } : {}),
      feedAgeSeconds: view.feedAgeSeconds,
      linea: input.linea,
      vehicleCount: view.vehicleCount,
      returned: slice.length,
      vehicles: slice.map((vehicle) => compactVehicle(vehicle, nowSeconds)),
    };
  } catch (error) {
    const failure = classifyRomaFeedFailure(error);
    return {
      ok: false,
      notice: MOBILITA_ROMA_BUS_LIVE_NOTICE,
      portalUrl: portalUrl(input.linea),
      source,
      fetchedAt: new Date(nowMs).toISOString(),
      error: `feed_mobilita_non_disponibile: ${failure.message}`,
    };
  }
}