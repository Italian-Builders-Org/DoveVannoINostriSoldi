export const DATASET_IDS = [
  "siope_comuni",
  "openbdap_spesa_stato",
  "openbdap_amministrazione",
  "openbdap_opere_pubbliche",
  "opencivitas_fabbisogni",
  "opencoesione_progetti",
  "anac_cig_snapshot",
  "ipa_enti",
  "ipa_struttura",
  "mef_partecipazioni",
  "consulenti_incarichi",
  "parlamento_bilanci",
  "controlli_segnali",
  "registro_fonti",
] as const;

export type DatasetId = (typeof DATASET_IDS)[number];

export type DatasetQuery = {
  dataset: DatasetId;
  year?: number;
  month?: number;
  query?: string;
  region?: string;
  code?: string;
  cup?: string;
  area?: string;
  chamber?: "camera" | "senato";
  limit?: number;
  offset?: number;
};

export type DatasetDescriptor = {
  id: DatasetId;
  title: string;
  summary: string;
  sourceIds: string[];
  freshness: "snapshot" | "live";
  filters: string[];
  caveat?: string;
};

export const datasetCatalog: DatasetDescriptor[] = [
  { id: "siope_comuni", title: "Pagamenti dei Comuni", summary: "Pagamenti di cassa SIOPE, serie mensile, titoli, regioni e principali Comuni.", sourceIds: ["siope", "ipa"], freshness: "snapshot", filters: ["year", "region"] },
  { id: "openbdap_spesa_stato", title: "Spesa dello Stato", summary: "Pagamenti cumulati dello Stato per missione, amministrazione e categoria economica.", sourceIds: ["openbdap"], freshness: "live", filters: ["year", "month"] },
  { id: "openbdap_amministrazione", title: "Spesa di una amministrazione statale", summary: "Dettaglio OpenBDAP di una amministrazione per missione e categoria.", sourceIds: ["openbdap"], freshness: "live", filters: ["code", "year", "month"] },
  { id: "openbdap_opere_pubbliche", title: "Opere pubbliche per CUP", summary: "Stato, date, costi e finanziamenti delle opere pubbliche MOP.", sourceIds: ["openbdap"], freshness: "live", filters: ["cup"], caveat: "I segnali di qualità o ritardo richiedono verifica e non provano uno spreco." },
  { id: "opencivitas_fabbisogni", title: "Fabbisogni e servizi comunali", summary: "Spesa storica, spesa standard e livelli dei servizi dei Comuni coperti da OpenCivitas.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "La differenza dalla spesa standard non è una misura automatica di spreco." },
  { id: "opencoesione_progetti", title: "OpenCoesione", summary: "Aggregati nazionali su costo pubblico, pagamenti, temi, natura e stato dei progetti.", sourceIds: ["opencoesione"], freshness: "snapshot", filters: [], caveat: "Il rapporto pagamenti/costo non misura il completamento o la qualità dei progetti." },
  { id: "anac_cig_snapshot", title: "Contratti pubblici ANAC · CIG 2025", summary: "Aggregati verificati sui dodici file mensili CIG 2025, con copertura, hash, procedure e fasce di importo.", sourceIds: ["anac"], freshness: "snapshot", filters: ["year"], caveat: "È uno strumento di screening aggregato: non prova spreco, illecito, corruzione o frazionamento e non consente ancora la ricerca live per CIG." },
  { id: "ipa_enti", title: "Enti pubblici IPA", summary: "Ricerca e scheda degli enti nell’Indice PA.", sourceIds: ["ipa"], freshness: "live", filters: ["query", "code", "limit", "offset"] },
  { id: "ipa_struttura", title: "Struttura organizzativa IPA", summary: "Unità organizzative e aree organizzative omogenee di un ente.", sourceIds: ["ipa-struttura"], freshness: "live", filters: ["code", "limit", "offset"] },
  { id: "mef_partecipazioni", title: "Partecipazioni pubbliche", summary: "Aggregati della rilevazione annuale MEF sulle partecipazioni pubbliche.", sourceIds: ["partecipazioni-pubbliche"], freshness: "snapshot", filters: [] },
  { id: "consulenti_incarichi", title: "Incarichi e consulenze", summary: "Statistiche nazionali ufficiali su incarichi esterni e a dipendenti pubblici.", sourceIds: ["consulenti"], freshness: "snapshot", filters: ["year"] },
  { id: "parlamento_bilanci", title: "Bilanci del Parlamento", summary: "Documenti e valori strutturati verificati per Camera e Senato quando disponibili.", sourceIds: ["camera"], freshness: "snapshot", filters: ["chamber", "year"] },
  { id: "controlli_segnali", title: "Segnali da controllare", summary: "Indicatori, classificazioni e confronti che orientano verifiche ulteriori.", sourceIds: [], freshness: "snapshot", filters: ["area", "year"], caveat: "Un segnale non attribuisce responsabilità e non dimostra da solo spreco o illecito." },
  { id: "registro_fonti", title: "Registro delle fonti", summary: "Proprietari, copertura, formati, cadenza e stato di integrazione delle fonti censite.", sourceIds: [], freshness: "snapshot", filters: ["query"] },
];
