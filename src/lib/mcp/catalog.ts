import type { SourceId } from "@/lib/data/source-policy";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { educationAtlasCatalogSources } from "@/lib/education-atlas-metadata";
import { INTEGRATED_CORPUS_CONTRACT } from "@/lib/integrated-source-contract";
import { companyAtlasSources } from "@/lib/company-atlas-metadata";
import { publicSources } from "@/lib/sources";

export const DATASET_IDS = [
  "siope_comuni",
  "openbdap_spesa_stato",
  "openbdap_amministrazione",
  "openbdap_opere_pubbliche",
  "openbdap_ssn_conto_economico",
  "openbdap_ssn_storico_nazionale",
  "openbdap_spesa_legislature",
  "openbdap_legge_bilancio_storico",
  "opencivitas_fabbisogni",
  "opencoesione_progetti",
  "pnrr_asili",
  "anac_cig_snapshot",
  "inps_invalidita_civile",
  "istat_pensioni_prestazioni",
  "istat_pensionati_persone",
  "cpt_finanza_regionale",
  "mef_irpef_comunale",
  "ipa_enti",
  "ipa_struttura",
  "mef_partecipazioni",
  "consulenti_incarichi",
  "parlamento_bilanci",
  "controlli_segnali",
  "debito_pubblico_italiano",
  "registro_fonti",
  "spesa_pa_dettaglio",
  "company_active_enterprises",
  "company_workforce",
  "company_production_value_bands",
  "company_turnover_istat",
  "education_students_by_pathway",
] as const;

export type DatasetId = (typeof DATASET_IDS)[number];

export const BUSINESS_DATASET_IDS = [
  "company_active_enterprises",
  "company_workforce",
  "company_production_value_bands",
  "company_turnover_istat",
] as const;

export const EDUCATION_DATASET_IDS = [
  "education_students_by_pathway",
] as const;

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
  period?: string;
  sector?: string;
  band?: string;
  years?: number;
  schoolType?: string;
  pathway?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
};

export type DatasetSource = {
  id: string;
  name: string;
  owner: string;
  url: string;
  cadence: string;
  license?: string;
  licenseUrl?: string;
  publishedAt?: string;
  dataAsOf?: string;
  updatedAt?: string;
  period?: string;
  schoolType?: string;
  role?: string;
  sha256?: string;
  bytes?: number;
  rows?: number;
};

export type DatasetDescriptor = {
  id: DatasetId;
  title: string;
  summary: string;
  sourceIds: SourceId[];
  sources: DatasetSource[];
  freshness: "snapshot" | "live";
  filters: string[];
  exampleQuery: DatasetQuery;
  caveat?: string;
};

type DatasetDescriptorInput = Omit<DatasetDescriptor, "sources" | "exampleQuery"> & {
  customSources?: DatasetDescriptor["sources"];
};

const sourceById = new Map(publicSources.map((source) => [source.slug, source]));

const exampleQueries = {
  siope_comuni: { dataset: "siope_comuni", year: 2025, region: "Calabria" },
  openbdap_spesa_stato: { dataset: "openbdap_spesa_stato", year: 2026, month: 6 },
  openbdap_amministrazione: { dataset: "openbdap_amministrazione", code: "2", year: 2026 },
  openbdap_opere_pubbliche: { dataset: "openbdap_opere_pubbliche", cup: "I39B05000060005" },
  openbdap_ssn_conto_economico: { dataset: "openbdap_ssn_conto_economico", year: 2024, region: "Calabria", limit: 20 },
  openbdap_ssn_storico_nazionale: { dataset: "openbdap_ssn_storico_nazionale" },
  openbdap_spesa_legislature: { dataset: "openbdap_spesa_legislature" },
  openbdap_legge_bilancio_storico: { dataset: "openbdap_legge_bilancio_storico", years: 6 },
  opencivitas_fabbisogni: { dataset: "opencivitas_fabbisogni", region: "CALABRIA", limit: 20 },
  opencoesione_progetti: { dataset: "opencoesione_progetti" },
  pnrr_asili: { dataset: "pnrr_asili", region: "Lazio", limit: 20 },
  anac_cig_snapshot: { dataset: "anac_cig_snapshot", year: 2025 },
  inps_invalidita_civile: { dataset: "inps_invalidita_civile", year: 2023, region: "Calabria" },
  istat_pensioni_prestazioni: { dataset: "istat_pensioni_prestazioni", year: 2022 },
  istat_pensionati_persone: { dataset: "istat_pensionati_persone", year: 2022 },
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
  debito_pubblico_italiano: { dataset: "debito_pubblico_italiano" },
  registro_fonti: { dataset: "registro_fonti", query: "SIOPE" },
  spesa_pa_dettaglio: {
    dataset: "spesa_pa_dettaglio",
    code: "consulenze-legali",
    limit: 20,
  },
  company_active_enterprises: {
    dataset: "company_active_enterprises",
    period: "2026-07-31",
    region: "03",
    sector: "G",
    limit: 20,
  },
  company_workforce: {
    dataset: "company_workforce",
    period: "2026-Q2",
    region: "03",
    sector: "C",
    limit: 20,
  },
  company_production_value_bands: {
    dataset: "company_production_value_bands",
    period: "2025-12-31",
    band: "50M_OVER",
    limit: 20,
  },
  company_turnover_istat: {
    dataset: "company_turnover_istat",
    period: "2024",
    region: "15",
    sector: "INDUSTRIA",
    limit: 20,
  },
  education_students_by_pathway: {
    dataset: "education_students_by_pathway",
    period: "202425",
    region: "15",
    schoolType: "state",
    pathway: "SCIENTIFICO",
    limit: 20,
  },
} as const satisfies Record<DatasetId, DatasetQuery>;

const COMPANY_ATLAS_SOURCES: DatasetDescriptor["sources"] = Object.values(companyAtlasSources).map((source) => ({
  id: source.id,
  name: source.label,
  owner: source.publisher,
  url: source.url,
  cadence: source.cadence,
  license: source.license,
}));

const datasetDescriptors: DatasetDescriptorInput[] = [
  { id: "siope_comuni", title: "Pagamenti dei Comuni", summary: "Pagamenti di cassa SIOPE, serie mensile, titoli, regioni e principali Comuni, con normalizzazione territoriale ISTAT.", sourceIds: ["siope", "ipa", "istat"], freshness: "snapshot", filters: ["year", "region"], caveat: "I totali nazionali includono gli enti riconosciuti come Comuni in SIOPE; gli aggregati regionali coprono soltanto quelli abbinati tramite IPA e dichiarano conteggi e importi non regionalizzabili. Il campo distribution completo è disponibile solo nella risposta nazionale; le liste comunali contengono i primi 100 nazionali per totale, pro capite o km². Le normalizzazioni sono descrittive e non misurano efficienza, qualità o fabbisogno." },
  { id: "openbdap_spesa_stato", title: "Spesa dello Stato", summary: "Pagamenti dello Stato per missione, amministrazione e categoria economica; la query annuale preferisce il consuntivo ufficiale.", sourceIds: ["openbdap"], freshness: "live", filters: ["year", "month"], caveat: "I rilasci mensili sono cumulati dal 1° gennaio al mese indicato; il consuntivo annuale è una serie distinta e non viene mescolato con i mesi." },
  { id: "openbdap_amministrazione", title: "Spesa di una amministrazione statale", summary: "Dettaglio OpenBDAP di una amministrazione per missione e categoria, con consuntivo annuale o rilascio mensile coerente.", sourceIds: ["openbdap"], freshness: "live", filters: ["code", "year", "month"], caveat: "Una query annuale senza mese preferisce il consuntivo; una query con mese resta sul rilascio mensile corrispondente." },
  { id: "openbdap_opere_pubbliche", title: "Opere pubbliche per CUP", summary: "Stato, date, costi e finanziamenti delle opere pubbliche MOP.", sourceIds: ["openbdap"], freshness: "live", filters: ["cup"], caveat: "I segnali di qualità o ritardo richiedono verifica e non provano uno spreco." },
  { id: "openbdap_ssn_conto_economico", title: "Conto Economico degli enti del SSN", summary: "Consuntivo 2024 OpenBDAP con aggregato nazionale, aggregati regionali e dettaglio di 232 enti; costo del personale, acquisti di servizi e voci ufficiali di consulenze, collaborazioni, interinale e altre prestazioni di lavoro.", sourceIds: ["openbdap"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "Il nazionale e le Regioni provengono da dataset ufficiali distinti dal dettaglio enti; le 21 righe codeSsn=999 non sono esposte per evitare doppio conteggio. Le voci sono categorie contabili: non equivalgono a gettonisti, cooperative, organico o pagamenti di cassa e non consentono classifiche di efficienza o inferenze sulla qualità sanitaria." },
  { id: "openbdap_ssn_storico_nazionale", title: "Serie storica nazionale del Conto Economico SSN", summary: "Costi della produzione, personale, prestazioni di lavoro e acquisti di servizi a livello nazionale, dal 2012 al 2024.", sourceIds: ["openbdap"], freshness: "live", filters: [], caveat: "Solo livello nazionale: il dettaglio regionale e per ente resta disponibile soltanto per il 2024 in openbdap_ssn_conto_economico. Voci di competenza economica, non pagamenti di cassa; non identificano gettonisti, cooperative o organico e non permettono classifiche di efficienza tra anni o Regioni." },
  { id: "openbdap_spesa_legislature", title: "Spesa dello Stato per legislatura", summary: "Confronto descrittivo tra l'anno pre-elettorale e la media degli altri anni completi di ogni legislatura, sulla spesa OpenBDAP RGS per missione (2014-2025).", sourceIds: ["openbdap"], freshness: "live", filters: [], caveat: "Confronto puramente descrittivo, non un test di significatività statistica: due sole legislature complete osservate, la spesa statale cresce anche per motivi non elettorali (trend, inflazione) e il 2020-2021 include la spesa emergenziale COVID-19, dichiarata esplicitamente. Non implica causalità né intento elettorale, non copre spesa comunale, regionale o europea." },
  { id: "openbdap_legge_bilancio_storico", title: "Legge di Bilancio per missione, serie storica", summary: "Stanziamento di competenza pubblicato dalla Legge di Bilancio per missione, ultime leggi di bilancio confrontabili (dal 2017), con variazione anno su anno.", sourceIds: ["openbdap"], freshness: "live", filters: ["years"], caveat: "È lo stanziamento enacted pubblicato dalla Legge di Bilancio (competenza, primo anno), non le misure della manovra né un pagamento osservato: non isola un fondo, un bonus o un'aliquota specifici, per cui serve la lettura editoriale di UPB o Corte dei Conti. Copre solo missioni con nome stabile dal 2017 (prima di allora la tassonomia è stata rinominata) e include il rimborso lordo del debito pubblico, che domina la missione Debito pubblico indipendentemente dalle scelte di policy dell'anno." },
  { id: "opencivitas_fabbisogni", title: "Fabbisogni e servizi comunali", summary: "Spesa storica, spesa standard e livelli dei servizi dei Comuni coperti da OpenCivitas.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "La differenza dalla spesa standard non è una misura automatica di spreco." },
  { id: "opencoesione_progetti", title: "OpenCoesione", summary: "Aggregati nazionali su costo pubblico, pagamenti, temi, natura e stato dei progetti.", sourceIds: ["opencoesione"], freshness: "snapshot", filters: [], caveat: "Il rapporto pagamenti/costo non misura il completamento o la qualità dei progetti." },
  { id: "pnrr_asili", title: "PNRR asili e prima infanzia", summary: "Progetti Italia Domani per CUP, localizzazioni, finanziamenti, gare e aggiudicatari.", sourceIds: ["italiadomani"], freshness: "snapshot", filters: ["cup", "query", "region", "province", "limit", "offset"], caveat: "Il finanziamento PNRR non è un pagamento osservato; gare e aggiudicazioni sono livelli distinti." },
  { id: "anac_cig_snapshot", title: "Contratti pubblici ANAC · CIG 2025", summary: "Aggregati verificati sui dodici file mensili CIG 2025, con copertura, hash, procedure e fasce di importo.", sourceIds: ["anac"], freshness: "snapshot", filters: ["year"], caveat: "È uno strumento di screening aggregato: non prova spreco, illecito, corruzione o frazionamento e non consente ancora la ricerca live per CIG." },
  { id: "inps_invalidita_civile", title: "Prestazioni INPS di invalidità civile", summary: "Spesa nazionale, stock di prestazioni e nuove pensioni di invalidità civile per regione.", sourceIds: ["inps"], freshness: "snapshot", filters: ["year", "region"], caveat: "Prestazioni, pensioni, spesa e nuove decorrenze sono misure diverse. I dati aggregati non provano frode e non consentono attribuzioni individuali." },
  { id: "istat_pensioni_prestazioni", title: "Pensioni ISTAT · prestazioni", summary: "Numero di prestazioni pensionistiche, importo lordo annuo e importo lordo medio per categoria, dal 2012 al 2022.", sourceIds: ["istat-casellario-pensioni"], freshness: "snapshot", filters: ["year"], caveat: "Il denominatore è il numero di prestazioni, non il numero di persone. Gli importi sono lordi e nominali, espressi in migliaia di euro per i totali e in euro per la media; i conteggi delle categorie riconciliano esattamente, mentre i relativi importi possono differire dal totale di 1-2 migliaia di euro per arrotondamento della fonte. Non è sommabile con pensionati né con CIVDIS/invalidità civile INPS." },
  { id: "istat_pensionati_persone", title: "Pensionati ISTAT · persone", summary: "Numero di persone pensionate, reddito pensionistico lordo annuo e media lorda, dal 2012 al 2022.", sourceIds: ["istat-casellario-pensioni"], freshness: "snapshot", filters: ["year"], caveat: "Il denominatore è il numero di persone pensionate, non il numero di prestazioni. Gli importi sono lordi e nominali, espressi in migliaia di euro per i totali e in euro per la media. Non è sommabile con le prestazioni pensionistiche né con CIVDIS/invalidità civile INPS; lo snapshot non è una serie INPS 2024." },
  { id: "cpt_finanza_regionale", title: "Entrate e spese pubbliche per territorio", summary: "Entrate, spese e saldo contabile territorializzato della PA consolidata CPT, con valori pro capite e per km² 2023.", sourceIds: ["cpt", "istat"], freshness: "snapshot", filters: ["year", "region"], caveat: "Il saldo è entrate meno spese nello stesso perimetro CPT PA. Le normalizzazioni ISTAT non misurano pressione fiscale, qualità dei servizi, merito politico o trasferimenti netti fra regioni e non sono il residuo fiscale di Banca d'Italia." },
  { id: "mef_irpef_comunale", title: MEF_IRPEF_SOURCE.mcp.title, summary: MEF_IRPEF_SOURCE.mcp.summary, sourceIds: [MEF_IRPEF_SOURCE.id], freshness: "snapshot", filters: ["year", "level", "region", "province", "code", "query", "limit", "offset"], caveat: MEF_IRPEF_SOURCE.mcp.caveat },
  { id: "ipa_enti", title: "Enti pubblici IPA", summary: "Ricerca e scheda degli enti nell’Indice PA.", sourceIds: ["ipa"], freshness: "live", filters: ["query", "code", "limit", "offset"] },
  { id: "ipa_struttura", title: "Struttura organizzativa IPA", summary: "Unità organizzative e aree organizzative omogenee di un ente.", sourceIds: ["ipa-struttura"], freshness: "live", filters: ["code", "limit", "offset"] },
  { id: "mef_partecipazioni", title: "Partecipazioni pubbliche", summary: "Aggregati della rilevazione annuale MEF sulle partecipazioni pubbliche.", sourceIds: ["partecipazioni-pubbliche"], freshness: "snapshot", filters: [] },
  { id: "consulenti_incarichi", title: "Incarichi e consulenze", summary: "Statistiche nazionali ufficiali su incarichi esterni e a dipendenti pubblici.", sourceIds: ["consulenti"], freshness: "snapshot", filters: ["year"] },
  { id: "parlamento_bilanci", title: "Bilanci del Parlamento", summary: "Documenti e valori strutturati verificati per Camera e Senato quando disponibili.", sourceIds: ["camera"], freshness: "snapshot", filters: ["chamber", "year"] },
  { id: "controlli_segnali", title: "Segnali da controllare", summary: "Indicatori, classificazioni e screening derivati che orientano verifiche ulteriori.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["area", "year", "region", "limit", "offset"], caveat: "Un segnale, compreso lo screening OpenCivitas, non attribuisce responsabilità e non dimostra da solo spreco o illecito." },
  { id: "debito_pubblico_italiano", title: "Debito pubblico italiano", summary: "Stock Maastricht, variazioni mensili, composizione, detentori, vita residua e interessi annuali.", sourceIds: ["bancaditalia", "eurostat"], freshness: "snapshot", filters: [], caveat: "Stock, flussi netti, detentori e interessi hanno periodi diversi. Le fonti pubblicano importi in milioni di euro: la conversione in centesimi interi non aggiunge precisione alla misura originaria. Gli indicatori per il cittadino descrivono esposizioni e meccanismi, non previsioni né effetti individuali." },
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
  {
    id: "company_active_enterprises",
    title: "Atlante imprese attive",
    summary: "Stock mensile delle sedi di impresa attive per regione e sezione ATECO 2025.",
    sourceIds: [],
    customSources: [COMPANY_ATLAS_SOURCES[0]!],
    freshness: "snapshot",
    filters: ["period", "region", "sector", "limit", "offset"],
    caveat: `${companyAtlasSources["active-stock"].caveat} Non è un registro di aziende con nome, identificativo o ricavi.`,
  },
  {
    id: "company_workforce",
    title: "Atlante addetti e localizzazioni",
    summary: "Addetti e localizzazioni attive aggregati per regione e sezione ATECO 2025.",
    sourceIds: [],
    customSources: [COMPANY_ATLAS_SOURCES[1]!],
    freshness: "snapshot",
    filters: ["period", "region", "sector", "limit", "offset"],
    caveat: `${companyAtlasSources.workforce.caveat} Le righe risultanti sono aggregati regionali per sezione ATECO e non un elenco di aziende.`,
  },
  {
    id: "company_production_value_bands",
    title: "Atlante per fasce di valore della produzione",
    summary: "Conteggi per fascia di valore della produzione dichiarata nei bilanci, per regione e settore.",
    sourceIds: [],
    customSources: [COMPANY_ATLAS_SOURCES[2]!],
    freshness: "snapshot",
    filters: ["period", "region", "sector", "band", "limit", "offset"],
    caveat: `${companyAtlasSources["production-value"].caveat} Le fasce non identificano singole aziende.`,
  },
  {
    id: "company_turnover_istat",
    title: "Atlante fatturato aggregato delle imprese (ISTAT)",
    summary: "Fatturato aggregato delle imprese per regione e macro-settore economico (Industria e Servizi), in migliaia di euro (Stima anticipata ISTAT 2024).",
    sourceIds: [],
    customSources: [{
      id: "istat-frame-territoriale-2024",
      name: "Stima anticipata dei dati economici delle imprese · Frame Territoriale 2024",
      owner: "Istituto Nazionale di Statistica (ISTAT)",
      url: "https://www.istat.it/wp-content/uploads/2026/03/Tavole20marzo2026.zip",
      cadence: "annuale",
      license: "CC BY 4.0",
    }],
    freshness: "snapshot",
    filters: ["period", "region", "sector", "limit", "offset"],
    caveat: "Dati aggregati per territorio e macro-settore ATECO 2007 agg. 2022 dal Registro Frame Territoriale Anticipato ISTAT 2024. Il perimetro copre le unità locali con almeno un dipendente (non l'universo delle sedi attive). I valori sono espressi in migliaia di euro; totale e macro-settori provengono da tavole pubblicate separatamente e piccole differenze tra somme e totale possono riflettere gli arrotondamenti della fonte. Non contiene dati nominativi, partite IVA o fatturati di singole aziende.",
  },
  {
    id: "education_students_by_pathway",
    title: "Atlante istruzione: studenti per percorso",
    summary: "Studenti aggregati della scuola secondaria di II grado per Regione, tipo di scuola, percorso e anno scolastico.",
    sourceIds: [],
    customSources: [...educationAtlasCatalogSources],
    freshness: "snapshot",
    filters: ["period", "region", "schoolType", "pathway", "limit", "offset"],
    caveat: "Studenti aggregati per Regione e percorso nel file MIM. Le variazioni descrivono la presenza nel dato osservato: non misurano qualità, esiti, domanda futura o carenze occupazionali. Le Regioni assenti dalla fonte restano n.d. e non vengono imputate.",
  },
];

export const datasetCatalog: DatasetDescriptor[] = datasetDescriptors.map((dataset) => {
  const { customSources, ...descriptor } = dataset;
  return {
    ...descriptor,
    exampleQuery: exampleQueries[dataset.id],
    sources: customSources ?? dataset.sourceIds.map((sourceId) => {
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
  };
});

const businessDatasetIdSet = new Set<string>(BUSINESS_DATASET_IDS);

export const businessDatasetCatalog = datasetCatalog.filter((dataset) =>
  businessDatasetIdSet.has(dataset.id),
);

const educationDatasetIdSet = new Set<string>(EDUCATION_DATASET_IDS);

export const educationDatasetCatalog = datasetCatalog.filter((dataset) =>
  educationDatasetIdSet.has(dataset.id),
);
