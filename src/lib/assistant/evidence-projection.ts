import type { queryAnacOperatorAwards } from "@/lib/anac-operator-public-view";
import type { DatasetQuery } from "@/lib/mcp/catalog";
import { EURO_EVIDENCE_NOTE, projectCentFields, projectEurostatCofogEvidence, projectIstatCofogEvidence, projectSsnEvidence, projectSsnHistoryEvidence } from "@/lib/assistant/monetary-evidence";

/** Adapt validated public responses to a bounded, unit-explicit model context. */
export function projectChatEvidence(query: DatasetQuery, data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  // Public adapters validate these contracts before projection. Keep each unit
  // conversion tied to its dataset instead of guessing from arbitrary numbers.
  switch (query.dataset) {
    case "openbdap_ssn_conto_economico": return projectSsnEvidence(data as Parameters<typeof projectSsnEvidence>[0]);
    case "openbdap_ssn_storico_nazionale": return projectSsnHistoryEvidence(data as Parameters<typeof projectSsnHistoryEvidence>[0]);
    case "istat_cofog": return projectIstatCofogEvidence(data as Parameters<typeof projectIstatCofogEvidence>[0]);
    case "eurostat_cofog": return projectEurostatCofogEvidence(data as Parameters<typeof projectEurostatCofogEvidence>[0]);
  }
  if (query.dataset === "anac_operatori") {
    const result = data as ReturnType<typeof queryAnacOperatorAwards>;
    if (result.mode !== "detail") return data;
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        awards: row.awards.slice(0, 3),
        awardsReturned: Math.min(row.awards.length, 3),
        awardsOmittedFromPublished: row.awardsOmittedFromPublished + Math.max(0, row.awards.length - 3),
      })),
      chatProjection: {
        awardsLimit: 3,
        caveat: "La chat mostra al massimo 3 CIG recenti della scheda. awardsOmittedFromPublished conta i CIG pubblicati omessi; awardCount e attributedValue restano i valori completi dello snapshot. Non ricostruire il totale sommando questo campione.",
      },
    };
  }
  if (query.dataset === "mef_irpef_comunale") {
    return {
      ...projectCentFields(data) as Record<string, unknown>,
      chatProjection: {
        monetaryUnit: "EUR",
        caveat: `${EURO_EVIDENCE_NOTE} knownAmountEuros resta un importo noto parziale: non è il totale completo.`,
      },
    };
  }
  if (query.dataset !== "siope_comuni") return data;
  const omitted = new Set(["topMunicipalities", "topMunicipalitiesByValue", "topMunicipalitiesByPerCapita", "distribution", "territorialNormalization"]);
  const entries = Object.entries(data);
  return {
    ...Object.fromEntries(entries.filter(([key]) => !omitted.has(key))),
    chatProjection: {
      omittedSections: entries.filter(([key]) => omitted.has(key)).map(([key]) => key),
      caveat: "Estratto degli aggregati contabili. Non include classifiche dei singoli Comuni, distribuzioni o misure per km². I conteggi activeSiopeMunicipalities, matchedToIpaRegion e unmatchedToIpaRegion si riferiscono all’anagrafica attiva; withMovements, withRegion e withoutRegion agli enti con movimenti. Non usare il denominatore degli enti attivi per withoutRegion. Con filtro regionale, totalPaid resta nazionale: il valore regionale è in regions. Non ricavare queste misure o classifiche dalle righe mancanti.",
    },
  };
}
