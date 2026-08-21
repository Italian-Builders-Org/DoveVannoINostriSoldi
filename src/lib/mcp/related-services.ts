export type RelatedMcpService = {
  id: string;
  name: string;
  owner: string;
  endpoint: string;
  aboutUrl: string;
  repositoryUrl: string;
  scope: string;
  access: string;
  rateLimit: string;
  preferredWorkflow: readonly string[];
  caveats: readonly string[];
  lastVerifiedAt: string;
  status: "external";
  proxiedByDvns: false;
};

/**
 * Public MCP services that complement this portal without becoming DVNS data
 * sources. Keeping them separate preserves provenance and prevents a remote
 * aggregator from being mistaken for a locally validated adapter.
 */
export const relatedMcpServices = [
  {
    id: "cruscotto-italia-agid",
    name: "Cruscotto Italia",
    owner: "AgID · Agenzia per l'Italia Digitale",
    endpoint: "https://cruscotto-italia-mcp.agid.workers.dev/mcp",
    aboutUrl: "https://cruscotto-italia.dati.gov.it/about.html#accesso-mcp",
    repositoryUrl: "https://github.com/AgID/cruscotto-italia",
    scope:
      "Dati ricomposti per Comune e codice ISTAT: demografia, SIOPE, contratti, opere, PNRR, sanità territoriale e altri domini civici.",
    access: "MCP pubblico, stateless, read-only e senza autenticazione dichiarata.",
    rateLimit: "60 richieste al minuto per IP dichiarate dal gestore.",
    preferredWorkflow: [
      "search_comune per risolvere il codice ISTAT",
      "comune_kpi per domande puntuali e confronti",
      "comune_dashboard solo quando servono array e serie di dettaglio",
    ],
    caveats: [
      "Servizio gestito e aggiornato separatamente da DoveVannoINostriSoldi.",
      "Le risposte ricompongono fonti primarie: verificare date, copertura e licenza della singola sezione.",
      "I tool sono orientati al singolo Comune, non a classifiche nazionali o regionali in una sola chiamata.",
      "Il catalogo e la versione del protocollo possono cambiare: il client deve scoprirli al momento della connessione.",
    ],
    lastVerifiedAt: "2026-08-21T00:00:00Z",
    status: "external",
    proxiedByDvns: false,
  },
] as const satisfies readonly RelatedMcpService[];
