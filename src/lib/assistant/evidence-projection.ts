import type { DatasetQuery } from "@/lib/mcp/catalog";

/** SIOPE's public response also carries national rankings and geographic distributions.
 * The chat's year/region query uses the complete accounting aggregates, not those lists.
 * Every omitted section is declared; scalar values, coverage, dates and sources survive.
 */
export function projectChatEvidence(query: DatasetQuery, data: unknown): unknown {
  if (query.dataset !== "siope_comuni" || !data || typeof data !== "object" || Array.isArray(data)) return data;
  const omitted = new Set(["topMunicipalities", "topMunicipalitiesByValue", "topMunicipalitiesByPerCapita", "distribution", "territorialNormalization"]);
  const entries = Object.entries(data);
  return {
    ...Object.fromEntries(entries.filter(([key]) => !omitted.has(key))),
    chatProjection: {
      omittedSections: entries.filter(([key]) => omitted.has(key)).map(([key]) => key),
      caveat: "Estratto degli aggregati contabili. Non include classifiche dei singoli Comuni, distribuzioni o misure per km². Con filtro regionale, totalPaid resta nazionale: il valore regionale è in regions. Non ricavare queste misure o classifiche dalle righe mancanti.",
    },
  };
}
