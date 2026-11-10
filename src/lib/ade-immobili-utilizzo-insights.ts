import "server-only";

import snapshot from "@/data/editorial-snapshots/ade-immobili.json";
import type { buildAdeImmobiliHousingInsights } from "@/lib/data/ade-immobili-utilizzo-derive";

export type { HousingTerritoryInsight } from "@/lib/data/ade-immobili-utilizzo-derive";

const { national, provinces, byProvince } = snapshot.housing as ReturnType<typeof buildAdeImmobiliHousingInsights>;

export function getAdeImmobiliHousingInsights(provincia?: string | null) {
  const code = provincia?.trim().toUpperCase() || null;
  const selected = code && /^[A-Z]{2}$/.test(code) ? byProvince[code] ?? null : null;
  return { national, provinces, selectedProvince: selected, requestedProvince: code };
}
