import type { SourceId } from "@/lib/data/source-policy";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { INTEGRATED_CORPUS_CONTRACT } from "@/lib/integrated-source-contract";
import { publicSources } from "@/lib/sources";

export const DATASET_IDS = [
  "siope_comuni",
  "openbdap_spesa_stato",
  "openbdap_amministrazione",
  "openbdap_opere_pubbliche",
  "openbdap_ssn_conto_economico",
  "opencivitas_fabbisogni",
  "opencoesione_progetti",
  "pnrr_asili",
  "anac_cig_snapshot",
  "inps_invalidita_civile",
  "cpt_finanza_regionale",
  "mef_irpef_comunale",
  "ipa_enti",
  "ipa_struttura",
  "mef_partecipazioni",
  "consulenti_incarichi",
  "parlamento_bilanci",
  "controlli_segnali",
  "registro_fonti",
  "spesa_pa_dettaglio",
] as const;

export type DatasetId = (typeof DATASET_IDS)[number];

export type DatasetQuery = {
  dataset: DatasetId;
  year?: number;
  month?: number;
  query?: string;
  region?: string;
  province?: string;
  level?: "region" | "province" | "municipality";
  code?: string;
  cup?: string;
  area?: string;
  chamber?: "camera" | "senato";
  limit?: number;
  offset?: number;
  cursor?: string;
};

export type DatasetDescriptor = {
  id: DatasetId;
  title: string;
  summary: string;
  sourceIds: SourceId[];
  sources: Array<{
    id: SourceId;
    name: string;
    owner: string;
    url: string;
    cadence: string;
  }>;
  freshness: "snapshot" | "live";
  filters: string[];
  exampleQuery: DatasetQuery;
  caveat?: string;
};

type DatasetDescriptorInput = Omit<DatasetDescriptor, "sources" | "exampleQuery">;

const sourceById = new Map(publicSources.map((source) => [source.slug, source]));

const exampleQueries = {
  siope_comuni: { dataset: "siope_comuni", year: 2025, region: "Calabria" },
  openbdap_spesa_stato: { dataset: "openbdap_spesa_stato", year: 2026, month: 6 },
  openbdap_amministrazione: { dataset: "openbdap_amministrazione", code: "2", year: 2026 },
  openbdap_opere_pubbliche: { dataset: "openbdap_opere_pubbliche", cup: "I39B05000060005" },
  openbdap_ssn_conto_economico: { dataset: "openbdap_ssn_conto_economico", year: 2024, region: "Calabria", limit: 20 },
  opencivitas_fabbisogni: { dataset: "opencivitas_fabbisogni", region: "CALABRIA", limit: 20 },
  opencoesione_progetti: { dataset: "opencoesione_progetti" },
  pnrr_asili: { dataset: "pnrr_asili", region: "Lazio", limit: 20 },
  anac_cig_snapshot: { dataset: "anac_cig_snapshot", year: 2025 },
  inps_invalidita_civile: { dataset: "inps_invalidita_civile", year: 2023, region: "Calabria" },
  cpt_finanza_regionale: { dataset: "cpt_finanza_regionale", year: 2023, region: "Calabria" },
  mef_irpef_comunale: {
    dataset: "mef_irpef_comunale",
    year: 2024,
    level: "municipality",
    query: "Abano",
    limit: 20,
  },
  ipa_enti: { dataset: "ipa_enti", query: "Agenzia per l'Italia Digitale", limit: 10 },
  ipa_struttura: { dataset: "ipa_struttura", code: "agid", limit: 20 },
  mef_partecipazioni: { dataset: "mef_partecipazioni" },
  consulenti_incarichi: { dataset: "consulenti_incarichi", year: 2024 },
  parlamento_bilanci: { dataset: "parlamento_bilanci", chamber: "camera", year: 2024 },
  controlli_segnali: { dataset: "controlli_segnali", area: "spesa-comuni", year: 2022, limit: 20 },
  registro_fonti: { dataset: "registro_fonti", query: "SIOPE" },
  spesa_pa_dettaglio: {
    dataset: "spesa_pa_dettaglio",
    code: "consulenze-legali",
    limit: 20,
  },
} as const satisfies Record<DatasetId, DatasetQuery>;

const datasetDescriptors: DatasetDescriptorInput[] = [
  { id: "siope_comuni", title: "Pagamenti dei Comuni", summary: "Pagamenti di cassa SIOPE, serie mensile, titoli, regioni e principali Comuni, con normalizzazione territoriale ISTAT.", sourceIds: ["siope", "ipa", "istat"], freshness: "snapshot", filters: ["year", "region"], caveat: "I totali nazionali includono gli enti riconosciuti come Comuni in SIOPE; gli aggregati regionali coprono soltanto quelli abbinati tramite IPA e dichiarano conteggi e importi non regionalizzabili. Il campo distribution completo è disponibile solo nella risposta nazionale; le liste comunali contengono i primi 100 nazionali per totale, pro capite o km². Le normalizzazioni sono descrittive e non misurano efficienza, qualità o fabbisogno." },
  { id: "openbdap_spesa_stato", title: "Spesa dello Stato", summary: "Pagamenti dello Stato per missione, amministrazione e categoria economica; la query annuale preferisce il consuntivo ufficiale.", sourceIds: ["openbdap"], freshness: "live", filters: ["year", "month"], caveat: "I rilasci mensili sono cumulati dal 1° gennaio al mese indicato; il consuntivo annuale è una serie distinta e non viene mescolato con i mesi." },
  { id: "openbdap_amministrazione", title: "Spesa di una amministrazione statale", summary: "Dettaglio OpenBDAP di una amministrazione per missione e categoria, con consuntivo annuale o rilascio mensile coerente.", sourceIds: ["openbdap"], freshness: "live", filters: ["code", "year", "month"], caveat: "Una query annuale senza mese preferisce il consuntivo; una query con mese resta sul rilascio mensile corrispondente." },
  { id: "openbdap_opere_pubbliche", title: "Opere pubbliche per CUP", summary: "Stato, date, costi e finanziamenti delle opere pubbliche MOP.", sourceIds: ["openbdap"], freshness: "live", filters: ["cup"], caveat: "I segnali di qualità o ritardo richiedono verifica e non provano uno spreco." },
  { id: "openbdap_ssn_conto_economico", title: "Conto Economico degli enti del SSN", summary: "Consuntivo 2024 OpenBDAP con aggregato nazionale, aggregati regionali e dettaglio di 232 enti; costo del personale, acquisti di servizi e voci ufficiali di consulenze, collaborazioni, interinale e altre prestazioni di lavoro.", sourceIds: ["openbdap"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "Il nazionale e le Regioni provengono da dataset ufficiali distinti dal dettaglio enti; le 21 righe codeSsn=999 non sono esposte per evitare doppio conteggio. Le voci sono categorie contabili: non equivalgono a gettonisti, cooperative, organico o pagamenti di cassa e non consentono classifiche di efficienza o inferenze sulla qualità sanitaria." },
  { id: "opencivitas_fabbisogni", title: "Fabbisogni e servizi comunali", summary: "Spesa storica, spesa standard e livelli dei servizi dei Comuni coperti da OpenCivitas.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "La differenza dalla spesa standard non è una misura automatica di spreco." },
  { id: "opencoesione_progetti", title: "OpenCoesione", summary: "Aggregati nazionali su costo pubblico, pagamenti, temi, natura e stato dei progetti.", sourceIds: ["opencoesione"], freshness: "snapshot", filters: [], caveat: "Il rapporto pagamenti/costo non misura il completamento o la qualità dei progetti." },
  { id: "pnrr_asili", title: "PNRR asili e prima infanzia", summary: "Progetti Italia Domani per CUP, localizzazioni, finanziamenti, gare e aggiudicatari.", sourceIds: ["italiadomani"], freshness: "snapshot", filters: ["cup", "query", "region", "province", "limit", "offset"], caveat: "Il finanziamento PNRR non è un pagamento osservato; gare e aggiudicazioni sono livelli distinti." },
  { id: "anac_cig_snapshot", title: "Contratti pubblici ANAC · CIG 2025", summary: "Aggregati verificati sui dodici file mensili CIG 2025, con copertura, hash, procedure e fasce di importo.", sourceIds: ["anac"], freshness: "snapshot", filters: ["year"], caveat: "È uno strumento di screening aggregato: non prova spreco, illecito, corruzione o frazionamento e non consente ancora la ricerca live per CIG." },
  { id: "inps_invalidita_civile", title: "Prestazioni INPS di invalidità civile", summary: "Spesa nazionale, stock di prestazioni e nuove pensioni di invalidità civile per regione.", sourceIds: ["inps"], freshness: "snapshot", filters: ["year", "region"], caveat: "Prestazioni, pensioni, spesa e nuove decorrenze sono misure diverse. I dati aggregati non provano frode e non consentono attribuzioni individuali." },
  { id: "cpt_finanza_regionale", title: "Entrate e spese pubbliche per territorio", summary: "Entrate, spese e saldo contabile territorializzato della PA consolidata CPT, con valori pro capite e per km² 2023.", sourceIds: ["cpt", "istat"], freshness: "snapshot", filters: ["year", "region"], caveat: "Il saldo è entrate meno spese nello stesso perimetro CPT PA. Le normalizzazioni ISTAT non misurano pressione fiscale, qualità dei servizi, merito politico o trasferimenti netti fra regioni e non sono il residuo fiscale di Banca d'Italia." },
  { id: "mef_irpef_comunale", title: MEF_IRPEF_SOURCE.mcp.title, summary: MEF_IRPEF_SOURCE.mcp.summary, sourceIds: [MEF_IRPEF_SOURCE.id], freshness: "snapshot", filters: ["year", "level", "region", "province", "code", "query", "limit", "offset"], caveat: MEF_IRPEF_SOURCE.mcp.caveat },
  { id: "ipa_enti", title: "Enti pubblici IPA", summary: "Ricerca e scheda degli enti nell’Indice PA.", sourceIds: ["ipa"], freshness: "live", filters: ["query", "code", "limit", "offset"] },
  { id: "ipa_struttura", title: "Struttura organizzativa IPA", summary: "Unità organizzative e aree organizzative omogenee di un ente.", sourceIds: ["ipa-struttura"], freshness: "live", filters: ["code", "limit", "offset"] },
  { id: "mef_partecipazioni", title: "Partecipazioni pubbliche", summary: "Aggregati della rilevazione annuale MEF sulle partecipazioni pubbliche.", sourceIds: ["partecipazioni-pubbliche"], freshness: "snapshot", filters: [] },
  { id: "consulenti_incarichi", title: "Incarichi e consulenze", summary: "Statistiche nazionali ufficiali su incarichi esterni e a dipendenti pubblici.", sourceIds: ["consulenti"], freshness: "snapshot", filters: ["year"] },
  { id: "parlamento_bilanci", title: "Bilanci del Parlamento", summary: "Documenti e valori strutturati verificati per Camera e Senato quando disponibili.", sourceIds: ["camera"], freshness: "snapshot", filters: ["chamber", "year"] },
  { id: "controlli_segnali", title: "Segnali da controllare", summary: "Indicatori, classificazioni e screening derivati che orientano verifiche ulteriori.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["area", "year", "region", "limit", "offset"], caveat: "Un segnale, compreso lo screening OpenCivitas, non attribuisce responsabilità e non dimostra da solo spreco o illecito." },
  { id: "registro_fonti", title: "Registro delle fonti", summary: "Proprietari, copertura, formati, cadenza e stato di integrazione delle fonti censite.", sourceIds: [], freshness: "snapshot", filters: ["query"] },
  {
    id: "spesa_pa_dettaglio",
    title: "Dettaglio integrato della spesa pubblica",
    summary:
      `Accesso uniforme ai ${INTEGRATED_CORPUS_CONTRACT.datasets} dataset integrati su affidamenti, fornitori, incarichi, consulenze, personale, spese operative, trasparenza e benchmark.`,
    sourceIds: [],
    freshness: "snapshot",
    filters: ["code", "query", "limit", "cursor", "offset"],
    caveat:
      "code è l’identificativo restituito dal catalogo /dati. cursor continua una scansione limitata ed è legato a dataset, rilascio e ricerca; offset resta compatibile soltanto senza ricerca testuale. Importi mancanti e zero restano distinti; segnali, confronti e documenti mancanti non dimostrano automaticamente spreco o illecito.",
  },
];

export const datasetCatalog: DatasetDescriptor[] = datasetDescriptors.map((dataset) => ({
  ...dataset,
  exampleQuery: exampleQueries[dataset.id],
  sources: dataset.sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`Fonte MCP non registrata: ${sourceId}`);
    return {
      id: sourceId,
      name: source.name,
      owner: source.owner,
      url: source.url,
      cadence: source.cadence,
    };
  }),
}));
