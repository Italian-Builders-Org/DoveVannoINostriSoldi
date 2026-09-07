import type { DatasetQuery } from "@/lib/mcp/catalog";

/** SIOPE's public response also carries national rankings and geographic distributions.
 * The chat's year/region query uses the complete accounting aggregates, not those lists.
 * Every omitted section is declared; scalar values, coverage, dates and sources survive.
 */
function euroAmount(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid monetary evidence");
  const cents = BigInt(value);
  const absolute = cents < BigInt(0) ? -cents : cents;
  return `${cents < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

function mefEuroEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mefEuroEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (key === "amountCents") return ["amountEuros", euroAmount(entry)];
    if (key === "knownAmountCents") return ["knownAmountEuros", euroAmount(entry)];
    return [key, mefEuroEvidence(entry)];
  }));
}

export function projectChatEvidence(query: DatasetQuery, data: unknown): unknown {
  if (query.dataset === "mef_irpef_comunale" && data && typeof data === "object" && !Array.isArray(data)) {
    return {
      ...mefEuroEvidence(data) as Record<string, unknown>,
      chatProjection: {
        monetaryUnit: "EUR",
        caveat: "Gli importi amountEuros e knownAmountEuros sono già in euro, espressi come stringhe decimali con due cifre dopo il punto. Conversione esatta dagli interi in centesimi dell’adapter; non moltiplicare o dividere ancora per 100. Le note metodologiche sui centesimi descrivono il formato originale. knownAmountEuros resta un importo noto parziale: non è il totale completo. Frequenze, conteggi, copertura, periodi e provenance restano invariati.",
      },
    };
  }
  if (query.dataset !== "siope_comuni" || !data || typeof data !== "object" || Array.isArray(data)) return data;
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
