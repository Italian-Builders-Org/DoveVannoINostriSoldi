import "server-only";

import snapshot from "@/data/editorial-snapshots/ade-immobili.json";
import type { AdeImmobiliTabelleInsights } from "@/lib/data/ade-immobili-tabelle-derive";

export function getAdeImmobiliTabelleInsights(): AdeImmobiliTabelleInsights {
  return snapshot.tables as AdeImmobiliTabelleInsights;
}
