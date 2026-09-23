import opencivitas2021PoliziaSource from "../../../scripts/etl/specs/opencivitas-2021-polizia.source.json";
import opencivitas2021SocialeAsiliSource from "../../../scripts/etl/specs/opencivitas-2021-sociale-asili.source.json";
import opencivitas2021ViabilitaSource from "../../../scripts/etl/specs/opencivitas-2021-viabilita.source.json";
import opencivitas2022IstruzioneSource from "../../../scripts/etl/specs/opencivitas-2022-istruzione.source.json";
import { OPENCUP_PRODUCT_INTEGRATION, type SourceId } from "@/lib/data/source-policy";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { educationAtlasCatalogSources } from "@/lib/education-atlas-metadata";
import { INTEGRATED_CORPUS_CONTRACT } from "@/lib/integrated-source-contract";
import { companyAtlasSources } from "@/lib/company-atlas-metadata";
import { sourceCatalog } from "@/lib/sources";
import opencivitas2015Source from "../../../scripts/etl/specs/opencivitas-2015.source.json";
import opencivitas2016Source from "../../../scripts/etl/specs/opencivitas-2016.source.json";
import opencivitas2022RifiutiSource from "../../../scripts/etl/specs/opencivitas-2022-rifiuti.source.json";
import opencivitas2021RifiutiSource from "../../../scripts/etl/specs/opencivitas-2021-rifiuti.source.json";
import opencivitas2022ViabilitaSource from "../../../scripts/etl/specs/opencivitas-2022-viabilita.source.json";
import opencivitas2021AmministrazioneSource from "../../../scripts/etl/specs/opencivitas-2021-amministrazione.source.json";
import opencivitas2022AmministrazioneSource from "../../../scripts/etl/specs/opencivitas-2022-amministrazione.source.json";
import opencivitas2021IstruzioneSource from "../../../scripts/etl/specs/opencivitas-2021-istruzione.source.json";
import opencivitas2022SocialeAsiliSource from "../../../scripts/etl/specs/opencivitas-2022-sociale-asili.source.json";
import opencivitas2022PoliziaSource from "../../../scripts/etl/specs/opencivitas-2022-polizia.source.json";
import istatBesInnovazioneMetadata from "@/data/generated/istat-bes-innovazione-2004-2023.meta.json";
import istatPovertaSogliaAssolutaMetadata from "@/data/generated/istat-poverta-soglia-assoluta-2005-2024.meta.json";
import istatPovertaSogliaRelativaMetadata from "@/data/generated/istat-poverta-soglia-relativa-2014-2024.meta.json";
import istatPovertaRegioniMetadata from "@/data/generated/istat-poverta-regioni-2014-2024.meta.json";
import eurostatAropeMetadata from "@/data/generated/eurostat-arope-2015-2025.meta.json";

function formatItalianInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export const DATASET_IDS = [
  "siope_comuni",
  "siope_entrate_comuni",
  "siope_inventario_enti",
  "siope_asl",
  "siope_province",
  "siope_regioni",
  "siope_citta_metropolitane",
  "openbdap_spesa_stato",
  "openbdap_amministrazione",
  "openbdap_opere_pubbliche",
  "openbdap_ssn_conto_economico",
  "openbdap_ssn_storico_nazionale",
  "salute_posti_letto",
  "salute_dispositivi_medici",
  "openbdap_spesa_legislature",
  "openbdap_legge_bilancio_storico",
  "opencivitas_polizia_2021",
  "opencivitas_sociale_asili_2021",
  "opencivitas_viabilita_2021",
  "opencivitas_istruzione_2022",
  "opencivitas_fabbisogni",
  "opencivitas_fabbisogni_2021",
  "opencivitas_fabbisogni_2015",
  "opencivitas_fabbisogni_2016",
  "opencivitas_fabbisogni_2017",
  "opencivitas_fabbisogni_2018",
  "opencivitas_fabbisogni_2019",
  "opencivitas_rifiuti_2022",
  "opencivitas_rifiuti_2021",
  "opencivitas_viabilita_2022",
  "opencivitas_amministrazione_2021",
  "opencivitas_amministrazione_2022",
  "opencivitas_istruzione_2021",
  "opencivitas_sociale_asili_2022",
  "opencivitas_polizia_2022",
  "opencoesione_progetti",
  "opencup_progetto",
  "pnrr_asili",
  "pnrr_progetti",
  "anac_cig_snapshot",
  "anac_operatori",
  "consip_ordini",
  "eurostat_cofog",
  "eurostat_conti_pa",
  "inps_invalidita_civile",
  "inps_pensioni_vigenti",
  "istat_pensioni_prestazioni",
  "istat_cofog",
  "istat_epea",
  "istat_poverta_assoluta",
  "istat_poverta_relativa",
  "istat_poverta_soglia_assoluta",
  "istat_poverta_soglia_relativa",
  "istat_poverta_regioni",
  "eurostat_arope",
  "istat_bes_economico",
  "istat_bes_salute",
  "istat_bes_istruzione",
  "istat_bes_lavoro",
  "istat_bes_relazioni",
  "istat_bes_politica",
  "istat_bes_sicurezza",
  "istat_bes_paesaggio",
  "istat_bes_servizi",
  "istat_bes_ambiente",
  "istat_bes_innovazione",
  "inps_naspi",
  "inps_assegno_unico",
  "inps_integrazioni_salariali",
  "inps_cig_fondi_solidarieta",
  "inl_vigilanza",
  "aifa_farmaci_spesa",
  "mef_irpef_dettaglio",
  "mef_iva",
  "eu_vat_gap_italy",
  "istat_permessi_costruire",
  "mef_tax_gap_nazionale",
  "eurostat_taxag",
  "eurostat_sha_health",
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
  detail?: "summary" | "income-sources" | "income-bands" | "all";
  code?: string;
  cup?: string;
  area?: string;
  chamber?: "camera" | "senato";
  territory?: string;
  table?: string;
  measure?: string;
  family?: string;
  breakdown?: string;
  tax?: string;
  country?: string;
  cofog?: string;
  channel?: "convenzioni" | "mepa";
  period?: string;
  sector?: string;
  sex?: string;
  cepa?: string;
  band?: string;
  years?: number;
  mission?: string;
  component?: string;
  submeasure?: string;
  schoolType?: string;
  pathway?: string;
  view?: "search" | "aggregate" | "device" | "facts" | "filters";
  deviceType?: "1" | "2";
  deviceNumber?: string;
  dimension?: "territory" | "classification" | "manufacturer";
  value?: string;
  role?: "fabbricante" | "assemblatore";
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

export type DatasetPublicMetadata = Readonly<{
  period: readonly string[];
  units: readonly string[];
  coverage: string;
  queryNotes: readonly string[];
  references: readonly Readonly<{ label: string; url: string }>[];
}>;

export type DatasetLiveFallback = "snapshot";

export type DatasetDescriptor = {
  id: DatasetId;
  title: string;
  summary: string;
  sourceIds: SourceId[];
  sources: DatasetSource[];
  freshness: "snapshot" | "live";
  /** When set, a freshness:"live" dataset may serve a committed snapshot on temporary source failure. */
  liveFallback?: DatasetLiveFallback;
  integration: "active" | "configured";
  publicationCadence?: string;
  filters: string[];
  exampleQuery: DatasetQuery;
  caveat?: string;
  publicMetadata?: DatasetPublicMetadata;
};

type DatasetDescriptorInput = Omit<DatasetDescriptor, "sources" | "exampleQuery" | "integration"> & {
  customSources?: DatasetDescriptor["sources"];
  integration?: DatasetDescriptor["integration"];
};

const sourceById = new Map(sourceCatalog.map((source) => [source.slug, source]));

const nonMunicipalSiopeSources: DatasetSource[] = [
  {
    id: "siope",
    name: "SIOPE",
    owner: "Ragioneria Generale dello Stato · banca dati gestita da Banca d'Italia",
    url: "https://www.siope.it/documenti/siope2/open/last",
    cadence: "File annuali; il file dell’anno in corso è aggiornato dalla fonte",
    role: "Fonte dei movimenti e delle identità SIOPE",
  },
  {
    id: "ipa",
    name: "Indice PA",
    owner: "Dipartimento per la trasformazione digitale",
    url: "https://indicepa.gov.it/ipa-dati/",
    cadence: "Aggiornata dalla fonte",
    role: "Fonte del join CF-IPA",
  },
];

const exampleQueries = {
  siope_comuni: { dataset: "siope_comuni", year: 2025, region: "Calabria" },
  siope_entrate_comuni: { dataset: "siope_entrate_comuni", year: 2025, region: "Calabria", limit: 20 },
  siope_inventario_enti: { dataset: "siope_inventario_enti", year: 2025, limit: 20 },
  siope_asl: { dataset: "siope_asl", year: 2025, region: "Lazio", limit: 20 },
  siope_province: { dataset: "siope_province", year: 2025, region: "Lazio", limit: 20 },
  siope_regioni: { dataset: "siope_regioni", year: 2024, region: "Puglia", limit: 20 },
  siope_citta_metropolitane: { dataset: "siope_citta_metropolitane", year: 2025, region: "Lazio", limit: 20 },
  openbdap_spesa_stato: { dataset: "openbdap_spesa_stato", year: 2026, month: 6 },
  openbdap_amministrazione: { dataset: "openbdap_amministrazione", code: "2", year: 2026 },
  openbdap_opere_pubbliche: { dataset: "openbdap_opere_pubbliche", cup: "I39B05000060005" },
  openbdap_ssn_conto_economico: { dataset: "openbdap_ssn_conto_economico", year: 2024, region: "Calabria", limit: 20 },
  openbdap_ssn_storico_nazionale: { dataset: "openbdap_ssn_storico_nazionale" },
  salute_posti_letto: { dataset: "salute_posti_letto", query: "PIEMONTE", limit: 20 },
  salute_dispositivi_medici: {
    dataset: "salute_dispositivi_medici", view: "search", query: "PRPR0005", year: 2021, limit: 20,
  },
  openbdap_spesa_legislature: { dataset: "openbdap_spesa_legislature" },
  openbdap_legge_bilancio_storico: { dataset: "openbdap_legge_bilancio_storico", years: 6 },
  opencivitas_polizia_2021: { dataset: "opencivitas_polizia_2021", region: "LAZIO", year: 2021, limit: 20 },
  opencivitas_sociale_asili_2021: { dataset: "opencivitas_sociale_asili_2021", region: "LAZIO", year: 2021, limit: 20 },
  opencivitas_viabilita_2021: { dataset: "opencivitas_viabilita_2021", region: "LAZIO", year: 2021, limit: 20 },
  opencivitas_istruzione_2022: { dataset: "opencivitas_istruzione_2022", region: "LAZIO", year: 2022, limit: 20 },
  opencivitas_fabbisogni: { dataset: "opencivitas_fabbisogni", region: "CALABRIA", limit: 20 },
  opencivitas_fabbisogni_2015: { dataset: "opencivitas_fabbisogni_2015", region: "LAZIO", year: 2015, limit: 20 },
  opencivitas_fabbisogni_2016: { dataset: "opencivitas_fabbisogni_2016", region: "LAZIO", year: 2016, limit: 20 },
  opencivitas_fabbisogni_2017: { dataset: "opencivitas_fabbisogni_2017", region: "LAZIO", year: 2017, limit: 20 },
  opencivitas_fabbisogni_2018: { dataset: "opencivitas_fabbisogni_2018", region: "LAZIO", year: 2018, limit: 20 },
  opencivitas_fabbisogni_2019: { dataset: "opencivitas_fabbisogni_2019", region: "LAZIO", year: 2019, limit: 20 },
  opencivitas_fabbisogni_2021: { dataset: "opencivitas_fabbisogni_2021", region: "CALABRIA", limit: 20 },
  opencivitas_rifiuti_2022: { dataset: "opencivitas_rifiuti_2022", region: "LAZIO", year: 2022, limit: 20 },
  opencivitas_rifiuti_2021: { dataset: "opencivitas_rifiuti_2021", region: "LAZIO", year: 2021, limit: 20 },
  opencivitas_viabilita_2022: { dataset: "opencivitas_viabilita_2022", region: "LAZIO", year: 2022, limit: 20 },
  opencivitas_amministrazione_2021: { dataset: "opencivitas_amministrazione_2021", region: "LAZIO", year: 2021, limit: 20 },
  opencivitas_amministrazione_2022: { dataset: "opencivitas_amministrazione_2022", region: "LAZIO", year: 2022, limit: 20 },
  opencivitas_istruzione_2021: { dataset: "opencivitas_istruzione_2021", region: "LAZIO", year: 2021, limit: 20 },
  opencivitas_sociale_asili_2022: { dataset: "opencivitas_sociale_asili_2022", region: "LAZIO", year: 2022, limit: 20 },
  opencivitas_polizia_2022: { dataset: "opencivitas_polizia_2022", region: "LAZIO", year: 2022, limit: 20 },
  opencoesione_progetti: { dataset: "opencoesione_progetti" },
  opencup_progetto: { dataset: "opencup_progetto", cup: "A12B34567890001", limit: 20 },
  pnrr_progetti: { dataset: "pnrr_progetti", mission: "M1", region: "012", limit: 20 },
  pnrr_asili: { dataset: "pnrr_asili", region: "Lazio", limit: 20 },
  anac_cig_snapshot: { dataset: "anac_cig_snapshot", year: 2025 },
  anac_operatori: { dataset: "anac_operatori", query: "autostrade", limit: 5 },
  consip_ordini: { dataset: "consip_ordini", year: 2025, channel: "mepa" },
  eurostat_cofog: { dataset: "eurostat_cofog", country: "IT", year: 2024 },
  eurostat_conti_pa: { dataset: "eurostat_conti_pa", year: 2025 },
  inps_invalidita_civile: { dataset: "inps_invalidita_civile", year: 2023, region: "Calabria" },
  inps_pensioni_vigenti: { dataset: "inps_pensioni_vigenti" },
  istat_pensioni_prestazioni: { dataset: "istat_pensioni_prestazioni", year: 2022 },
  istat_cofog: { dataset: "istat_cofog", territory: "IT", year: 2023 },
  istat_epea: { dataset: "istat_epea", year: 2022, sector: "S13_15", cepa: "CEPA1" },
  istat_poverta_assoluta: { dataset: "istat_poverta_assoluta", territory: "IT", year: 2024 },
  istat_poverta_relativa: { dataset: "istat_poverta_relativa", territory: "IT", year: 2024 },
  istat_poverta_soglia_assoluta: {
    dataset: "istat_poverta_soglia_assoluta",
    territory: "ITC1",
    year: 2024,
    family: "2",
    band: "2",
  },
  istat_poverta_soglia_relativa: {
    dataset: "istat_poverta_soglia_relativa",
    territory: "IT",
    year: 2024,
    band: "N1",
  },
  istat_poverta_regioni: { dataset: "istat_poverta_regioni", territory: "ITC4", year: 2024, limit: 20 },
  eurostat_arope: { dataset: "eurostat_arope", territory: "IT", year: 2025 },
  istat_bes_economico: { dataset: "istat_bes_economico", territory: "IT", year: 2023 },
  istat_bes_salute: { dataset: "istat_bes_salute", territory: "IT", year: 2022 },
  istat_bes_istruzione: { dataset: "istat_bes_istruzione", territory: "IT", year: 2022 },
  istat_bes_lavoro: { dataset: "istat_bes_lavoro", territory: "IT", year: 2024 },
  istat_bes_relazioni: { dataset: "istat_bes_relazioni", territory: "IT", year: 2024 },
  istat_bes_politica: { dataset: "istat_bes_politica", territory: "IT", year: 2024 },
  istat_bes_sicurezza: { dataset: "istat_bes_sicurezza", territory: "IT", year: 2023 },
  istat_bes_paesaggio: { dataset: "istat_bes_paesaggio", territory: "IT", year: 2023 },
  istat_bes_servizi: { dataset: "istat_bes_servizi", territory: "IT", year: 2023 },
  istat_bes_ambiente: { dataset: "istat_bes_ambiente", territory: "IT", year: 2023 },
  istat_bes_innovazione: { dataset: "istat_bes_innovazione", territory: "IT", year: 2022 },
  inps_naspi: { dataset: "inps_naspi", table: "beneficiari_02", year: 2022 },
  inps_assegno_unico: { dataset: "inps_assegno_unico", table: "nuclei", year: 2023, province: "Milano" },
  inps_integrazioni_salariali: {
    dataset: "inps_integrazioni_salariali",
    table: "lavoratori",
    year: 2023,
  },
  inps_cig_fondi_solidarieta: {
    dataset: "inps_cig_fondi_solidarieta",
    year: 2023,
    region: "Lombardia",
    code: "FIS",
  },
  inl_vigilanza: {
    dataset: "inl_vigilanza",
    year: 2025,
    table: "inspectionsOutcome",
    territory: "ITALIA",
  },
  aifa_farmaci_spesa: {
    dataset: "aifa_farmaci_spesa",
    year: 2025,
    region: "030",
    code: "C09",
  },
  mef_iva: { dataset: "mef_iva", year: 2025, breakdown: "regione", limit: 25 },
  eu_vat_gap_italy: { dataset: "eu_vat_gap_italy", year: 2023 },
  istat_permessi_costruire: { dataset: "istat_permessi_costruire", year: 2025, table: "a1" },
  mef_tax_gap_nazionale: { dataset: "mef_tax_gap_nazionale", year: 2022 },
  eurostat_taxag: { dataset: "eurostat_taxag", year: 2025, sector: "S13", tax: "D211" },
  eurostat_sha_health: { dataset: "eurostat_sha_health", year: 2024, code: "HF3" },
  mef_irpef_dettaglio: { dataset: "mef_irpef_dettaglio", family: "tipo_reddito", breakdown: "regione", year: 2025 },
  istat_pensionati_persone: { dataset: "istat_pensionati_persone", year: 2022 },
  cpt_finanza_regionale: { dataset: "cpt_finanza_regionale", year: 2023, region: "Calabria" },
  mef_irpef_comunale: {
    dataset: "mef_irpef_comunale",
    year: 2024,
    level: "municipality",
    query: "Abano",
    detail: "income-bands",
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
  {
    id: "siope_inventario_enti",
    title: "SIOPE · inventario enti",
    summary: "Censimento nazionale SIOPE per tipo di ente e anno, con copertura dei join IPA e movimenti osservati.",
    sourceIds: ["siope", "ipa"],
    customSources: nonMunicipalSiopeSources,
    freshness: "snapshot",
    publicationCadence: "manuale",
    filters: ["year", "query", "limit", "offset", "cursor"],
    caveat: "È un inventario di copertura: non pubblica pagamenti per tipi diversi da ASL, Province, Regioni e Città metropolitane. Zero osservato, assenza di movimenti ed errore di join restano distinti; il 2026 è parziale.",
    publicMetadata: {
      period: [
        "Snapshot acquisito il 2026-09-07: anni 2024, 2025 e 2026.",
        "Il 2026 è un anno in corso e non va trattato come annualità completa.",
      ],
      units: [
        "Conteggi di copertura (anagrafiche, codici SIOPE, mesi osservati, righe movimento) e importi noti in centesimi di euro: non sono pagamenti, salvo i quattro tipi/perimetri pubblicati.",
        "Zero osservato, assenza di movimenti ed errore di join restano distinti; non sommare questo inventario con i dataset di pagamento.",
      ],
      coverage:
        "201 righe pubbliche = 67 tipi di ente × 3 anni (2024–2026) su 20 colonne; il join IPA è riportato per conteggi e importi matched/unmatched/ambiguous, senza valori numerici qui.",
      queryNotes: [
        "Filtri: year, query, limit, offset e cursor; region e code non sono disponibili su questo dataset.",
        "Usa cursor insieme a year/query; offset è ammesso solo senza quei filtri e non è compatibile con cursor.",
        "Snapshot committed aggiornato manualmente; le righe non sono le righe movimento raw della fonte.",
      ],
      references: [],
    },
  },
  { id: "siope_asl", title: "SIOPE · pagamenti delle ASL", summary: "Movimenti mensili di cassa SIOPE delle aziende sanitarie locali 2024–2026, con voci del comparto SAN e join IPA esatto.", sourceIds: ["siope", "ipa"], customSources: nonMunicipalSiopeSources, freshness: "snapshot", publicationCadence: "manuale", filters: ["year", "region", "code", "query", "limit", "offset", "cursor"], caveat: "Solo enti di tipo ASL nel registro SIOPE, non tutti gli enti del SSN. Pagamenti di cassa, distinti dal conto economico OpenBDAP; nessuna somma tra i due perimetri. Il 2026 è parziale.",
    publicMetadata: {
      period: [
        "Snapshot acquisito il 2026-09-07: anni serviti 2024, 2025 e 2026.",
        "Il 2026 è parziale e revisionabile: la fonte aggiorna il file dell'anno in corso, quindi i mesi osservati possono essere meno di dodici e il mese più recente può essere incompleto.",
      ],
      units: [
        "Pagamenti di cassa in centesimi di euro (EUR-cent), flusso uscite: non bilancio, impegni o costo economico di competenza.",
        "Movimenti di cassa del comparto SAN per ente, distinti dal conto economico OpenBDAP: nessuna somma fra i due perimetri.",
      ],
      coverage:
        "334.479 movimenti mensili pubblici e paginati via MCP; 116 schede aggregate server-only con join IPA esatto; unmatched conservati, fuori-validità esclusi e diagnosticati. Solo enti di tipo ASL nel registro SIOPE, non tutti gli enti del SSN. Il 2024 e il 2025 coprono dodici mesi per la quasi totalità delle ASL; il 2026 è parziale.",
      queryNotes: [
        "Filtri: year (2024, 2025 o 2026), region (nome o codice risolto al nome canonico), code (codice IPA o codice fiscale), query (testo).",
        "Usa cursor insieme a year/region/code/query per proseguire la scansione; offset è ammesso solo senza quei filtri e non è compatibile con cursor.",
      ],
      references: [],
    },
  },
  {
    id: "siope_province",
    title: "SIOPE · pagamenti delle Province",
    summary: "Movimenti mensili di cassa SIOPE delle Province 2024–2026, con identità temporale e join IPA esatto.",
    sourceIds: ["siope", "ipa"],
    customSources: nonMunicipalSiopeSources,
    freshness: "snapshot",
    publicationCadence: "manuale",
    filters: ["year", "region", "code", "query", "limit", "offset", "cursor"],
    caveat: "Comparto PRO. Sono pagamenti di cassa dell'amministrazione, non spesa consolidata nel territorio né una classifica; il 2026 è parziale.",
    publicMetadata: {
      period: [
        "Snapshot acquisito il 2026-09-07: anni serviti 2024, 2025 e 2026.",
        "2024: 84 province con dodici mesi e 4 fuori periodo. 2025: 84 con dodici mesi e 4 parziali (6-7 mesi). 2026: 9 mesi per tutte, parziale e revisionabile.",
      ],
      units: [
        "Pagamenti di cassa in centesimi di euro (EUR-cent), flusso uscite: non bilancio, impegni o costo economico di competenza.",
        "Enti di tipo PROVINCIA (comparto SIOPE PRO); le Città metropolitane sono escluse e pubblicate nel dataset separato siope_citta_metropolitane.",
      ],
      coverage:
        "270.194 righe canoniche della proiezione; 88 schede server-only con join IPA esatto e un includedCode per ente. Eventuali movimenti unmatched o fuori validità restano diagnostici nell'audit di provenienza e non sono conteggiati per comparto. Sono pagamenti di cassa dell'amministrazione provinciale, non spesa consolidata nel territorio né una classifica.",
      queryNotes: [
        "Filtri: year (2024, 2025 o 2026), region (nome o codice risolto al nome canonico), code (codice IPA o codice fiscale), query (testo).",
        "Usa cursor insieme a year/region/code/query per proseguire la scansione; offset è ammesso solo senza quei filtri e non è compatibile con cursor.",
      ],
      references: [],
    },
  },
  {
    id: "siope_regioni",
    title: "SIOPE · pagamenti delle Regioni",
    summary: "Movimenti mensili di cassa SIOPE delle Regioni e Province autonome 2024–2026, separati dai Comuni.",
    sourceIds: ["siope", "ipa"],
    customSources: nonMunicipalSiopeSources,
    freshness: "snapshot",
    publicationCadence: "manuale",
    filters: ["year", "region", "code", "query", "limit", "offset", "cursor"],
    caveat: "Comparto REG; comprende le Province autonome registrate da SIOPE. Non è spesa sanitaria né una somma dei Comuni; il 2026 è parziale.",
    publicMetadata: {
      period: [
        "Snapshot acquisito il 2026-09-07: anni serviti 2024, 2025 e 2026.",
        "2024 e 2025: tutti i 22 enti con dodici mesi. 2026: tutti i 22 con nove mesi, parziale e revisionabile.",
      ],
      units: [
        "Pagamenti di cassa in centesimi di euro (EUR-cent), flusso uscite, comparto REG: non spesa sanitaria e non somma dei Comuni.",
        "Movimenti mensili di uscita per ente: non bilancio, impegni o costo economico di competenza.",
      ],
      coverage:
        "150.088 righe canoniche pubbliche contigue della proiezione; 22 schede server-only con join IPA esatto e un includedCode per ente. Tra i 22 enti figurano due Province autonome (Trento e Bolzano).",
      queryNotes: [
        "Filtri: year (2024, 2025 o 2026), region (nome o codice risolto al nome canonico), code (codice IPA o codice fiscale), query (testo).",
        "Usa cursor insieme a year/region/code/query per proseguire la scansione; offset è ammesso solo senza quei filtri e non è compatibile con cursor.",
        "Snapshot committed e aggiornato manualmente; eventuali movimenti non risolti restano diagnostici a livello globale e non sono attribuiti alle Regioni.",
      ],
      references: [],
    },
  },
  {
    id: "siope_citta_metropolitane",
    title: "SIOPE · pagamenti delle Città metropolitane",
    summary: "Movimenti mensili di cassa SIOPE delle Città metropolitane 2024–2026, separati dalle Province.",
    sourceIds: ["siope", "ipa"],
    customSources: nonMunicipalSiopeSources,
    freshness: "snapshot",
    publicationCadence: "manuale",
    filters: ["year", "region", "code", "query", "limit", "offset", "cursor"],
    caveat: "Comparto PRO. Sono pagamenti di cassa dell'amministrazione, non spesa consolidata nel territorio né una classifica; il 2026 è parziale.",
    publicMetadata: {
      period: [
        "Snapshot acquisito il 2026-09-07: anni serviti 2024, 2025 e 2026.",
        "2024: 14 enti con dodici mesi e 1 fuori periodo (Sassari). 2025: 14 con dodici mesi e Sassari con giugno-dicembre. 2026: 15 enti con nove mesi, parziale e revisionabile.",
      ],
      units: [
        "Pagamenti di cassa in centesimi di euro (EUR-cent), flusso uscite, enti di tipo CITTA_METROP (comparto PRO): non spesa consolidata nel territorio né una classifica.",
        "Movimenti mensili di uscita per ente: non bilancio, impegni o costo economico di competenza.",
      ],
      coverage:
        "56.188 righe canoniche pubbliche della proiezione; 15 schede server-only con join IPA esatto e un includedCode ciascuna.",
      queryNotes: [
        "Filtri: year (2024, 2025 o 2026), region (nome o codice risolto al nome canonico), code (codice IPA o codice fiscale esatto), query (testo).",
        "Usa cursor insieme a year/region/code/query per proseguire la scansione; offset è ammesso solo senza quei filtri e non è compatibile con cursor.",
        "Snapshot committed e aggiornato manualmente.",
      ],
      references: [],
    },
  },
  { id: "siope_entrate_comuni", title: "Incassi dei Comuni", summary: "Incassi di cassa SIOPE 2024–2026, aggregati nazionali e regionali e dettaglio comunale completo paginato per codice fiscale o IPA.", sourceIds: ["siope", "ipa", "istat"], freshness: "snapshot", filters: ["year", "region", "code", "query", "limit", "offset"], caveat: "Incasso non è accertamento né entrata di competenza. Il 2026 può essere parziale: verificare period. Nessun saldo di bilancio, residuo fiscale o ranking di efficienza o spreco. national resta nazionale anche con filtri; selection riassume tutti i Comuni selezionati, non soltanto la pagina. Importi nazionali in euro, campi Cents in centesimi. Gli incassi senza Regione IPA restano nel totale nazionale; trasferimenti e partite di giro non sono consolidati." },
  {
    id: "siope_comuni",
    title: "Pagamenti dei Comuni",
    summary: "Pagamenti di cassa SIOPE, serie mensile, titoli, regioni e principali Comuni, con normalizzazione territoriale ISTAT.",
    sourceIds: ["siope", "ipa", "istat"],
    freshness: "snapshot",
    filters: ["year", "region"],
    caveat:
      "I totali nazionali includono gli enti riconosciuti come Comuni in SIOPE; gli aggregati regionali coprono soltanto quelli abbinati tramite IPA e dichiarano conteggi e importi non regionalizzabili. Il campo distribution completo è disponibile solo nella risposta nazionale; le liste comunali contengono i primi 100 nazionali per totale, pro capite o km². Le normalizzazioni sono descrittive e non misurano efficienza, qualità o fabbisogno. Il dataset MCP non isola un singolo Comune: per il dettaglio comunale cerca il Codice IPA nel registro /enti e usa GET /api/enti/{CodiceIPA}, disponibile per i Comuni con join esatto Codice IPA↔codice fiscale nello snapshot; resta un pagamento di cassa, distinto dal bilancio e dal servizio ricevuto.",
    publicMetadata: {
      period: [
        "2024 e 2025 sono anni completi; il 2026 è aggiornato fino al mese presente nello snapshot ed è quindi potenzialmente parziale.",
        "Il mese e la completezza esatti dipendono dalla risposta del dataset per anno: non vengono generalizzati.",
      ],
      units: [
        "L'API espone totalCents, perCapitaCents e perSquareKmCents in centesimi di euro; la pagina rende gli importi in euro e chiarisce il valore per abitante e per km².",
        "Quali misure siano presenti per un singolo anno dipende dalla risposta del dataset.",
      ],
      coverage:
        "Il dettaglio per Comune copre solo gli enti con join esatto Codice IPA↔codice fiscale nello snapshot; i record senza IPA non sono raggiungibili per la scheda comunale. È un pagamento di cassa, distinto dal bilancio e dal servizio ricevuto. Gli aggregati MCP restano nazionali/regionali e top-100; completezza e dettaglio per anno dipendono dalla risposta del dataset.",
      queryNotes: [
        "Il dataset MCP siope_comuni accetta soltanto year e region.",
        "Per un Comune cerca il Codice IPA nel registro /enti e poi usa GET /api/enti/{CodiceIPA}; non inventare code o q per siope_comuni.",
      ],
      references: [
        {
          label: "Registro enti: cerca il Codice IPA del Comune",
          url: "https://www.dovevannoinostrisoldi.com/enti",
        },
      ],
    },
  },
  { id: "openbdap_spesa_stato", title: "Spesa dello Stato", summary: "Pagamenti dello Stato per missione, amministrazione e categoria economica; la query annuale preferisce il consuntivo ufficiale.", sourceIds: ["openbdap"], freshness: "live", filters: ["year", "month"], caveat: "I rilasci mensili sono cumulati dal 1° gennaio al mese indicato; il consuntivo annuale è una serie distinta e non viene mescolato con i mesi." },
  { id: "openbdap_amministrazione", title: "Spesa di una amministrazione statale", summary: "Dettaglio OpenBDAP di una amministrazione per missione e categoria, con consuntivo annuale o rilascio mensile coerente.", sourceIds: ["openbdap"], freshness: "live", filters: ["code", "year", "month"], caveat: "Una query annuale senza mese preferisce il consuntivo; una query con mese resta sul rilascio mensile corrispondente." },
  { id: "openbdap_opere_pubbliche", title: "Opere pubbliche per CUP", summary: "Stato, date, costi e finanziamenti delle opere pubbliche MOP.", sourceIds: ["openbdap"], freshness: "live", filters: ["cup"], caveat: "I segnali di qualità o ritardo richiedono verifica e non provano uno spreco." },
  {
    id: "openbdap_ssn_conto_economico",
    title: "Conto Economico degli enti del SSN",
    summary: "Consuntivo 2024 OpenBDAP con aggregato nazionale, aggregati regionali e dettaglio di 232 enti; costo del personale, acquisti di servizi e voci ufficiali di consulenze, collaborazioni, interinale e altre prestazioni di lavoro.",
    sourceIds: ["openbdap"],
    freshness: "snapshot",
    filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Il nazionale e le Regioni provengono da dataset ufficiali distinti dal dettaglio enti; le 21 righe codeSsn=999 non sono esposte per evitare doppio conteggio. Le voci sono categorie contabili: non equivalgono a gettonisti, cooperative, organico o pagamenti di cassa e non consentono classifiche di efficienza o inferenze sulla qualità sanitaria.",
    publicMetadata: {
      period: [
        "Consuntivo 2024: anno di riferimento 2024, rilevazione CONSUNTIVO di conto economico.",
        "Pubblicazione della fonte: 2026-02-11; osservazione: 2026-02-10. Il dataset è disponibile solo per il 2024.",
      ],
      units: [
        "Importi in centesimi di euro nell'artefatto; competenza economica (conto economico consuntivo), non flussi di cassa.",
        "Il dataset MCP espone cinque metriche selezionate: BZ9999 Totale costi della produzione, BA2080 Totale costo del personale, BA1350 e BA1750 prestazioni di lavoro sanitarie e non sanitarie, BA0390 acquisti di servizi.",
      ],
      coverage:
        "Dettaglio: 232 enti esposti (253 nella fonte, senza le righe aggregate codeSsn=999) su 21 aggregati territoriali regionali, con Trento e Bolzano mantenute separate. Nazionale (5 righe) e regionale (105 righe) sono query OData filtrate sulle stesse cinque metriche, non l'intero perimetro di 554 codici voce della fonte. I tre livelli sono ufficiali e distinti: non si sommano fra loro.",
      queryNotes: [
        "Il filtro year accetta solo il 2024; region e code selezionano il dettaglio, limit e offset paginano. Le metriche non sono filtrabili.",
        "Il flag missing distingue l'assenza del valore da uno zero osservato: detailCoverage.present/missing riconciliano i 232 enti per metrica (es. productionCosts 232/0, personnelCost 218/14).",
        "Le righe aggregate codeSsn=999 e i codici regionali 041/042 sono usati per la verifica di riconciliazione e non sono esposti come enti di dettaglio.",
      ],
      references: [
        {
          label: "Dettaglio enti SSN 2024 (OpenBDAP)",
          url: "https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn",
        },
        {
          label: "Conto Economico SSN 2024 · livello nazionale (OpenBDAP)",
          url: "https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn-livello-nazionale",
        },
        {
          label: "Conto Economico SSN 2024 · livello regionale (OpenBDAP)",
          url: "https://bdap-opendata.rgs.mef.gov.it/content/2024-modello-di-rilevazione-del-conto-economico-degli-enti-del-ssn-livello-regionale",
        },
        {
          label: "Licenza CC BY 3.0",
          url: "https://creativecommons.org/licenses/by/3.0/",
        },
      ],
    },
  },
  { id: "openbdap_ssn_storico_nazionale", title: "Serie storica nazionale del Conto Economico SSN", summary: "Costi della produzione, personale, prestazioni di lavoro e acquisti di servizi a livello nazionale, dal 2012 al 2024.", sourceIds: ["openbdap"], freshness: "live", liveFallback: "snapshot", filters: [], caveat: "Solo livello nazionale: il dettaglio regionale e per ente resta disponibile soltanto per il 2024 in openbdap_ssn_conto_economico. Preferisce la lettura live OpenBDAP e, se i CSV annuali non sono disponibili, usa lo snapshot nazionale committed (dataMode snapshot). Voci di competenza economica, non pagamenti di cassa; non identificano gettonisti, cooperative o organico e non permettono classifiche di efficienza tra anni o Regioni." },
  { id: "openbdap_spesa_legislature", title: "Spesa dello Stato per legislatura", summary: "Confronto descrittivo tra l'anno pre-elettorale e la media degli altri anni completi di ogni legislatura, sulla spesa OpenBDAP RGS per missione (2014-2025).", sourceIds: ["openbdap"], freshness: "live", filters: [], caveat: "Confronto puramente descrittivo, non un test di significatività statistica: due sole legislature complete osservate, la spesa statale cresce anche per motivi non elettorali (trend, inflazione) e il 2020-2021 include la spesa emergenziale COVID-19, dichiarata esplicitamente. La legislatura in corso espone gli anni completi già pubblicati dal consuntivo, senza anno pre-elettorale: l'elezione che la chiuderà non è ancora avvenuta. Non implica causalità né intento elettorale, non copre spesa comunale, regionale o europea." },
  {
    id: "openbdap_legge_bilancio_storico",
    title: "Legge di Bilancio per missione, serie storica",
    summary: "Snapshot verificato degli stanziamenti di competenza per missione nelle Leggi di Bilancio 2017-2026; ultimi sei anni per default, fino a dieci disponibili con years, filtro mission sul nome esatto.",
    sourceIds: ["openbdap"],
    freshness: "snapshot",
    filters: ["years", "mission"],
    caveat: "È lo stanziamento pubblicato dalla Legge di Bilancio (competenza, primo anno), non le misure della manovra né un pagamento osservato. Euro correnti, non corretti per inflazione. L'MCP usa lo snapshot verificato senza download live; pagina Legge di Bilancio e API dichiarano separatamente l'eventuale modalità live. Ricerca e innovazione (017) comprende anche enti non universitari; Istruzione universitaria e formazione post-universitaria (023) resta una missione distinta. Non isola FFO, bilanci atenei o progetti PRIN/PNRR e non misura qualità o efficienza. Il dataset completo include il rimborso lordo del debito pubblico.",
    publicMetadata: {
      period: [
        "Snapshot verificato: anni serviti 2017–2026 (10 anni consecutivi), osservato il 2026-08-28.",
        "La tassonomia delle missioni è stabile dal 2017; gli anni precedenti non sono confrontabili per la rinomina delle missioni.",
      ],
      units: [
        "Stanziamento di competenza del primo anno (CP A1) in euro correnti, non corretto per inflazione.",
        "Importi stanziati dalla Legge di Bilancio pubblicata, non pagamenti di cassa: nessun confronto con SIOPE o col consuntivo è una riconciliazione.",
      ],
      coverage:
        "Lo snapshot completo contiene 34 missioni × 10 anni (2017–2026), 340 allocazioni e 306 delta; la risposta è ridotta dai filtri years (finestra 2–20, default 6) e mission (nome esatto). La fonte AMPMA pubblica 13.876 righe incl. header su 15 colonne, aggregate per anno e missione su amministrazioni, programmi e macroaggregati: l'MCP espone solo l'aggregato anno×missione, non il dettaglio per amministrazione, programma o macroaggregato.",
      queryNotes: [
        "years è la lunghezza della finestra (2–20, default 6) sugli anni più recenti disponibili, non un anno singolo; lo snapshot copre 2017–2026.",
        "mission richiede il nome esatto di una delle 34 missioni; una missione assente in un anno della finestra resta fuori per non mostrare uno zero falso.",
        "L'MCP serve lo snapshot verificato (osservato il 2026-08-28) senza download live; la modalità live vale solo per pagina e API.",
      ],
      references: [
        {
          label: "Catalogo OpenBDAP · prodotto LBF_SPE_CRU_AMPMA_001",
          url: "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_search?q=LBF_SPE_CRU_AMPMA_001&rows=20",
        },
      ],
    },
  },
  { id: "opencivitas_fabbisogni", title: "Fabbisogni e servizi comunali", summary: "Spesa storica, spesa standard e livelli dei servizi dei Comuni coperti da OpenCivitas.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "La differenza dalla spesa standard non è una misura automatica di spreco." },
  { id: "opencivitas_fabbisogni_2021", title: "Fabbisogni e servizi comunali 2021 (FC70TOT)", summary: "Spesa storica, spesa standard e livelli dei servizi dei Comuni RSO, annualità 2021, famiglia FC70TOT.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"], caveat: "Contratto distinto da FC80TOT 2022: non sommare né confrontare in silenzio le due annualità. La differenza dalla spesa standard non è spreco. RSS fuori perimetro." },
  {
    id: "opencivitas_polizia_2021",
    title: "Fabbisogni comunali · Polizia locale 2021 (FC70POLIZIA)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Polizia locale per ${formatItalianInteger(opencivitas2021PoliziaSource.municipalities)} Comuni RSO, annualità ${opencivitas2021PoliziaSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Polizia locale 2021 · FC70POLIZIA",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2021_Ind_FC70POLIZIA_1_csv.zip",
      cadence: "Irregolare; snapshot 2021 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2024-05-30", updatedAt: "2024-05-30", period: "2021",
      sha256: "709732432e95a296625aaf9bf793dbcb2db502a864ee186769d81384a3c68dbd", bytes: 2607887,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 (servizi totali) e dalla funzione Polizia locale 2022: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 9 Comuni con spesa storica vuota nella fonte restano esclusi. Il fabbisogno è riproporzionato sul totale della spesa storica della funzione: l'uguaglianza vale sull'insieme con spesa storica, e i 9 esclusi portano fabbisogno senza contropartita.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2021PoliziaSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2021PoliziaSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2021PoliziaSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 9 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione POLIZIA 2021 (FC70POLIZIA) è distinta da FC70TOT 2021 e dalla stessa funzione nel 2022: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Polizia locale 2021", url: opencivitas2021PoliziaSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_sociale_asili_2021",
    title: "Fabbisogni comunali · Sociale e asili nido 2021 (FC70SOCNID)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Sociale e asili nido per ${formatItalianInteger(opencivitas2021SocialeAsiliSource.municipalities)} Comuni RSO, annualità ${opencivitas2021SocialeAsiliSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Sociale e asili nido 2021 · FC70SOCNID",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2021_Ind_FC70SOCNID_1_csv.zip",
      cadence: "Irregolare; snapshot 2021 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2024-05-30", updatedAt: "2024-05-30", period: "2021",
      sha256: "36cf00aadfd4b1372c4798c9676388acd1bfe62c15820a44805394df5bee9f69", bytes: 3731430,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 (servizi totali) e da FC80SOCNID 2022: nessuna somma o confronto silenzioso fra funzioni o annualità. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 9 Comuni con spesa storica vuota restano esclusi. Canistro (066017) resta fuori perché la fonte pubblica la spesa storica in notazione scientifica.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2021SocialeAsiliSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2021SocialeAsiliSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2021SocialeAsiliSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999…, 9 Comuni con spesa storica incompleta e Canistro (066017), la cui spesa storica è in notazione scientifica`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione SOCIALE E NIDO 2021 (FC70SOCNID) è distinta da FC70TOT 2021 e da FC80SOCNID 2022: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Sociale e asili nido 2021", url: opencivitas2021SocialeAsiliSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_viabilita_2021",
    title: "Fabbisogni comunali · Viabilità e territorio 2021 (FC70TERRVIAB)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Viabilità e territorio per ${formatItalianInteger(opencivitas2021ViabilitaSource.municipalities)} Comuni RSO, annualità ${opencivitas2021ViabilitaSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Viabilità e territorio 2021 · FC70TERRVIAB",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2021_Ind_FC70TERRVIAB_1_csv.zip",
      cadence: "Irregolare; snapshot 2021 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2024-05-30", updatedAt: "2024-05-30", period: "2021",
      sha256: "e56d93a219cc165b72309778116aed6c295fea9a843aae3780392dcd6f00b8ed", bytes: 3394631,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 (servizi totali) e da FC80TERRVIAB 2022: nessuna somma o confronto silenzioso fra funzioni o annualità. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 14 Comuni con spesa storica vuota nella fonte restano esclusi.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2021ViabilitaSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2021ViabilitaSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2021ViabilitaSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 14 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione TERR_VIAB 2021 (FC70TERRVIAB) è distinta da FC70TOT 2021 e da FC80TERRVIAB 2022: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Viabilità e territorio 2021", url: opencivitas2021ViabilitaSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_istruzione_2022",
    title: "Fabbisogni comunali · Istruzione 2022 (FC80ISTRUZ)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Istruzione per ${formatItalianInteger(opencivitas2022IstruzioneSource.municipalities)} Comuni RSO, annualità ${opencivitas2022IstruzioneSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Istruzione 2022 · FC80ISTRUZ",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2022_Ind_FC80ISTRUZ_1_csv.zip",
      cadence: "Irregolare; snapshot 2022 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2025-06-16", updatedAt: "2025-06-16", period: "2022",
      sha256: "a4f1f98f4dc070221798e8b2b2264a7254d27c1beac534355c96304755c861c0", bytes: 2557585,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC80TOT 2022 (servizi totali), FC80RIFIUTI 2022, FC80TERRVIAB 2022, FC80SOCNID 2022 e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 6 Comuni con spesa storica vuota restano esclusi. Fascia (GE) pubblica zero su storica e standard e resta esclusa perché la differenza percentuale non è definita.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2022IstruzioneSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2022IstruzioneSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2022IstruzioneSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999…, 6 Comuni con spesa storica incompleta e Fascia (GE) con storica e standard a zero`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione ISTRUZIONE è distinta da FC80TOT, FC80RIFIUTI, FC80TERRVIAB e FC80SOCNID: non sommare né confrontare in silenzio.",
        "La descrizione ufficiale di SPESA_STORICA usa «euro» minuscolo, a differenza delle altre funzioni 2022.",
      ],
      references: [{ label: "OpenCivitas · Istruzione 2022", url: opencivitas2022IstruzioneSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_rifiuti_2022",
    title: "Fabbisogni comunali · Rifiuti 2022 (FC80RIFIUTI)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Rifiuti per ${formatItalianInteger(opencivitas2022RifiutiSource.municipalities)} Comuni RSO, annualità ${opencivitas2022RifiutiSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Rifiuti 2022 · FC80RIFIUTI",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2022_Ind_FC80RIFIUTI_1_csv.zip",
      cadence: "Irregolare; snapshot 2022 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2025-06-16", updatedAt: "2025-06-16", period: "2022",
      sha256: "6121df0f0c8f302570b0a977da05ccda0622145c306826d7162a1ec55bfe3204", bytes: 1889844,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC80TOT 2022 (servizi totali) e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2022RifiutiSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2022RifiutiSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2022RifiutiSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale e aggregati ZZ999…`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione RIFIUTI è distinta da FC80TOT (servizi totali): non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Rifiuti 2022", url: opencivitas2022RifiutiSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_rifiuti_2021",
    title: "Fabbisogni comunali · Rifiuti 2021 (FC70RIFIUTI)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Rifiuti per ${formatItalianInteger(opencivitas2021RifiutiSource.municipalities)} Comuni RSO, annualità ${opencivitas2021RifiutiSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Rifiuti 2021 · FC70RIFIUTI",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2021_Ind_FC70RIFIUTI_1_csv.zip",
      cadence: "Irregolare; snapshot 2021 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2024-05-30", updatedAt: "2024-05-30", period: "2021",
      sha256: "ab8b417cd957394b25aa278d7f4a788d4a8a1931db8909f68f96a0479ab702f6", bytes: 1725294,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 (servizi totali) e da FC80RIFIUTI 2022: nessuna somma o confronto silenzioso fra funzioni o annualità. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2021RifiutiSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2021RifiutiSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2021RifiutiSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale e aggregati ZZ999…`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione RIFIUTI 2021 (FC70RIFIUTI) è distinta da FC70TOT 2021 e da FC80RIFIUTI 2022: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Rifiuti 2021", url: opencivitas2021RifiutiSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_viabilita_2022",
    title: "Fabbisogni comunali · Viabilità e territorio 2022 (FC80TERRVIAB)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Viabilità e territorio per ${formatItalianInteger(opencivitas2022ViabilitaSource.municipalities)} Comuni RSO, annualità ${opencivitas2022ViabilitaSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Viabilità e territorio 2022 · FC80TERRVIAB",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2022_Ind_FC80TERRVIAB_1_csv.zip",
      cadence: "Irregolare; snapshot 2022 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2025-06-16", updatedAt: "2025-06-16", period: "2022",
      sha256: "dba9ba9e0d5a5aa7d306ba716bf6b2983629516a5e6a460238fede87a78fb9a7", bytes: 3499805,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC80TOT 2022 (servizi totali), FC80RIFIUTI 2022 e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 4 Comuni con spesa storica vuota nella fonte restano esclusi.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2022ViabilitaSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2022ViabilitaSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2022ViabilitaSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 4 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione TERR_VIAB è distinta da FC80TOT e FC80RIFIUTI: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Viabilità e territorio 2022", url: opencivitas2022ViabilitaSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_amministrazione_2021",
    title: "Fabbisogni comunali · Amministrazione 2021 (FC70AMMIN)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Amministrazione per ${formatItalianInteger(opencivitas2021AmministrazioneSource.municipalities)} Comuni RSO, annualità ${opencivitas2021AmministrazioneSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Amministrazione 2021 · FC70AMMIN",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2021_Ind_FC70AMMIN_1_csv.zip",
      cadence: "Irregolare; snapshot 2021 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2024-05-30", updatedAt: "2024-05-30", period: "2021",
      sha256: "26d3eb84d5e17db86827d7a6c7fa20e52e58e51fbc379b6117bea3fb0d291ab1", bytes: 2240179,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 (servizi totali), da FC80AMMIN 2022 (stessa funzione, altra annualità) e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 15 Comuni con spesa storica vuota nella fonte restano esclusi. Il fabbisogno è riproporzionato sul totale della spesa storica della funzione: l'uguaglianza vale sull'insieme completo, e i 15 esclusi portano 13,95 milioni di fabbisogno senza contropartita.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2021AmministrazioneSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2021AmministrazioneSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2021AmministrazioneSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 15 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione AMMINISTRAZIONE 2021 è distinta da FC70TOT 2021 e da FC80AMMIN 2022: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Amministrazione 2021", url: opencivitas2021AmministrazioneSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_amministrazione_2022",
    title: "Fabbisogni comunali · Amministrazione 2022 (FC80AMMIN)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Amministrazione per ${formatItalianInteger(opencivitas2022AmministrazioneSource.municipalities)} Comuni RSO, annualità ${opencivitas2022AmministrazioneSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Amministrazione 2022 · FC80AMMIN",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2022_Ind_FC80AMMIN_1_csv.zip",
      cadence: "Irregolare; snapshot 2022 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2025-06-16", updatedAt: "2025-06-16", period: "2022",
      sha256: "5ff2ccea482e07b3949c955b52f66ffe8d779ab9356b2b4e324677b9dc24e165", bytes: 1783464,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC80TOT 2022 (servizi totali), FC80RIFIUTI 2022, FC80TERRVIAB 2022, FC80SOCNID 2022 e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 9 Comuni con spesa storica vuota nella fonte restano esclusi. Il fabbisogno e riproporzionato sul totale della spesa storica della funzione: l uguaglianza vale sull insieme completo, e i 9 esclusi portano 3,20 milioni di fabbisogno senza contropartita.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2022AmministrazioneSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2022AmministrazioneSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2022AmministrazioneSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 9 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione AMMINISTRAZIONE è distinta da FC80TOT, FC80RIFIUTI, FC80TERRVIAB e FC80SOCNID: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Amministrazione 2022", url: opencivitas2022AmministrazioneSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_istruzione_2021",
    title: "Fabbisogni comunali · Istruzione 2021 (FC70ISTRUZ)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Istruzione per ${formatItalianInteger(opencivitas2021IstruzioneSource.municipalities)} Comuni RSO, annualità ${opencivitas2021IstruzioneSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Istruzione 2021 · FC70ISTRUZ",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2021_Ind_FC70ISTRUZ_1_csv.zip",
      cadence: "Irregolare; snapshot 2021 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2024-05-30", updatedAt: "2024-05-30", period: "2021",
      sha256: "ee4ffe034eb5d8900eabafaa3b9c5e185863bf37b4823b68bf46bd34d26e0e52", bytes: 2336072,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 (servizi totali) e dalla funzione Istruzione 2022: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 15 Comuni con spesa storica vuota nella fonte restano esclusi. Fascia (ISTAT 010022) resta esclusa perché la fonte pubblica fabbisogno zero. Il fabbisogno è riproporzionato sul totale della spesa storica della funzione: l'uguaglianza vale sull'insieme con spesa storica, e i 15 esclusi portano fabbisogno senza contropartita.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2021IstruzioneSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2021IstruzioneSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2021IstruzioneSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999…, 15 Comuni con spesa storica incompleta e Fascia (ISTAT 010022) con fabbisogno zero nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione ISTRUZIONE 2021 (FC70ISTRUZ) è distinta da FC70TOT 2021 e dalla stessa funzione nel 2022: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Istruzione 2021", url: opencivitas2021IstruzioneSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_sociale_asili_2022",
    title: "Fabbisogni comunali · Sociale e asili nido 2022 (FC80SOCNID)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Sociale e asili nido per ${formatItalianInteger(opencivitas2022SocialeAsiliSource.municipalities)} Comuni RSO, annualità ${opencivitas2022SocialeAsiliSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Sociale e asili nido 2022 · FC80SOCNID",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2022_Ind_FC80SOCNID_1_csv.zip",
      cadence: "Irregolare; snapshot 2022 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2025-06-16", updatedAt: "2025-06-16", period: "2022",
      sha256: "2dd0298e9d25e058f68aaf78f188bc271f175bfb5fe4e6ff06be6882d1486c95", bytes: 4162108,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC80TOT 2022 (servizi totali), FC80RIFIUTI 2022, FC80TERRVIAB 2022 e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 3 Comuni con spesa storica vuota nella fonte restano esclusi.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2022SocialeAsiliSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2022SocialeAsiliSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2022SocialeAsiliSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 3 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione SOCIALE E NIDO è distinta da FC80TOT, FC80RIFIUTI e FC80TERRVIAB: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Sociale e asili nido 2022", url: opencivitas2022SocialeAsiliSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_polizia_2022",
    title: "Fabbisogni comunali · Polizia locale 2022 (FC80POLIZIA)",
    summary: `Spesa storica, spesa standard e livelli dei servizi sulla funzione Polizia locale per ${formatItalianInteger(opencivitas2022PoliziaSource.municipalities)} Comuni RSO, annualità ${opencivitas2022PoliziaSource.referenceYear}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Polizia locale 2022 · FC80POLIZIA",
      owner: "Ragioneria Generale dello Stato · pubblicazione Sogei",
      url: "https://docs.opencivitas.it/2022_Ind_FC80POLIZIA_1_csv.zip",
      cadence: "Irregolare; snapshot 2022 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2025-06-16", updatedAt: "2025-06-16", period: "2022",
      sha256: "a57923007cf2c76e645f3e16beed2f4974e0c41dfcf68c688ef1c168cd65ad77", bytes: 2839376,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC80TOT 2022 (servizi totali), FC80RIFIUTI 2022, FC80TERRVIAB 2022, FC80SOCNID 2022 e dalle altre funzioni: nessuna somma o confronto silenzioso. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro. 3 Comuni con spesa storica vuota nella fonte restano esclusi.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2022PoliziaSource.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2022PoliziaSource.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2022PoliziaSource.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale, aggregati ZZ999… e 3 Comuni con spesa storica incompleta nella fonte`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "La funzione POLIZIA è distinta da FC80TOT, FC80RIFIUTI, FC80TERRVIAB e FC80SOCNID: non sommare né confrontare in silenzio.",
      ],
      references: [{ label: "OpenCivitas · Polizia locale 2022", url: opencivitas2022PoliziaSource.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_fabbisogni_2015",
    title: "Fabbisogni e servizi comunali 2015 (FC20TOT)",
    summary: `Spesa storica, spesa standard e livelli dei servizi di ${formatItalianInteger(opencivitas2015Source.municipalities)} Comuni RSO, annualità ${opencivitas2015Source.referenceYear}, famiglia ${opencivitas2015Source.family}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Servizi totali 2015 · FC20TOT",
      owner: "Dipartimento delle Finanze · pubblicazione SOSE",
      url: "https://docs.opencivitas.it/Ind_FC20TOT_2_csv.zip",
      cadence: "Irregolare; snapshot storico 2015 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2019-05-23", updatedAt: "2019-05-23", period: "2015",
      sha256: "9dffeca1c95eaaabb7387a22d9157086eff85b141aa4620f2439c7dbe355b23c", bytes: 4609719,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto dalle annualità 2016-2022: nessuna somma o confronto silenzioso. Nel 2015 il fabbisogno è riproporzionato sul totale nazionale della spesa storica, quindi la differenza aggregata è nulla per costruzione. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2015Source.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2015Source.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2015Source.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale e aggregati ZZ999…`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "Nel 2015 il fabbisogno standard è riproporzionato sul totale nazionale della spesa storica: la differenza aggregata è nulla per costruzione.",
      ],
      references: [{ label: "OpenCivitas · Servizi totali 2015", url: opencivitas2015Source.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_fabbisogni_2016",
    title: "Fabbisogni e servizi comunali 2016 (FC30TOT)",
    summary: `Spesa storica, spesa standard e livelli dei servizi di ${formatItalianInteger(opencivitas2016Source.municipalities)} Comuni RSO, annualità ${opencivitas2016Source.referenceYear}, famiglia ${opencivitas2016Source.family}.`,
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Servizi totali 2016 · FC30TOT",
      owner: "Dipartimento delle Finanze · pubblicazione SOSE",
      url: "https://docs.opencivitas.it/2016_Ind_FC30TOT_1_csv.zip",
      cadence: "Irregolare; snapshot storico 2016 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2019-05-23", updatedAt: "2019-05-23", period: "2016",
      sha256: "b9285a8e66f94e263abb172cce9110074f73afe5342ed3c6e9b9351a42eebdb9", bytes: 4588520,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto dalle altre annualita: nessuna somma o confronto silenzioso. Nel 2016 il fabbisogno e riproporzionato sul totale nazionale della spesa storica, quindi la differenza aggregata e nulla per costruzione. La differenza dalla spesa standard non e spreco ne un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
    publicMetadata: {
      period: [
        `Annualità di riferimento ${opencivitas2016Source.referenceYear}`,
        `Pubblicazione e ultima modifica ${opencivitas2016Source.publishedAt}`,
      ],
      units: [
        "Spesa storica in euro",
        "Spesa standard in euro",
        "Differenza spesa storica − spesa standard in euro",
        "Livelli dei servizi in unità pubblicate dalla fonte per ciascun indicatore",
        "Euro per abitante dove pubblicato dalla fonte",
      ],
      coverage: `${formatItalianInteger(opencivitas2016Source.municipalities)} Comuni RSO delle 15 regioni a statuto ordinario; escluse Province autonome, regioni a statuto speciale e aggregati ZZ999…`,
      queryNotes: [
        "Specificare almeno un filtro fra region e code; limit massimo 100 righe per pagina.",
        "Nel 2016 il fabbisogno standard è riproporzionato sul totale nazionale della spesa storica: la differenza aggregata è nulla per costruzione.",
      ],
      references: [{ label: "OpenCivitas · Servizi totali 2016", url: opencivitas2016Source.datasetPageUrl }],
    },
  },
  {
    id: "opencivitas_fabbisogni_2017",
    title: "Fabbisogni e servizi comunali 2017 (FC40TOT)",
    summary: "Spesa storica, spesa standard e livelli dei servizi di 6.627 Comuni RSO, annualità 2017, famiglia FC40TOT.",
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Servizi totali 2017 · FC40TOT",
      owner: "Ragioneria Generale dello Stato · pubblicazione SOSE",
      url: "https://docs.opencivitas.it/2017_Ind_FC40TOT_1_csv.zip",
      cadence: "Irregolare; snapshot storico 2017 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2021-03-15", updatedAt: "2021-03-15", period: "2017",
      sha256: "266a1dd568df603039e0615cbbf6e9f9484abaeaa03b0dce0deca1ded35729d6", bytes: 5368963,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto dalle annualità 2018, 2019, 2021 e 2022: nessuna somma o confronto silenzioso. Il 2020 non è ricostruito. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
  },
  {
    id: "opencivitas_fabbisogni_2018",
    title: "Fabbisogni e servizi comunali 2018 (FC50TOT)",
    summary: "Spesa storica, spesa standard e livelli dei servizi di 6.606 Comuni RSO, annualità 2018, famiglia FC50TOT.",
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Servizi totali 2018 · FC50TOT",
      owner: "Ragioneria Generale dello Stato · pubblicazione SOSE",
      url: "https://docs.opencivitas.it/2018_Ind_FC50TOT_1_csv.zip",
      cadence: "Irregolare; snapshot storico 2018 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2022-02-14", updatedAt: "2022-02-14", period: "2018",
      sha256: "78107746fe7edac1791ac61d3d6b09ba5bd4d65f80db896c1c6c450e5bca55c0", bytes: 4649896,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC60TOT 2019, FC70TOT 2021 e FC80TOT 2022: nessuna somma o confronto silenzioso tra annualità. Il 2020 non è ricostruito. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
  },
  {
    id: "opencivitas_fabbisogni_2019",
    title: "Fabbisogni e servizi comunali 2019 (FC60TOT)",
    summary: "Spesa storica, spesa standard e livelli dei servizi di 6.567 Comuni RSO, annualità 2019, famiglia FC60TOT.",
    sourceIds: ["opencivitas"],
    customSources: [{
      id: "opencivitas", name: "OpenCivitas · Servizi totali 2019 · FC60TOT",
      owner: "Ragioneria Generale dello Stato · pubblicazione SOSE",
      url: "https://docs.opencivitas.it/2019_Ind_FC60TOT_2_csv.zip",
      cadence: "Irregolare; snapshot storico 2019 vincolato per hash",
      license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      publishedAt: "2023-05-30", updatedAt: "2024-05-30", period: "2019",
      sha256: "5292914fcbda4b26047020fa11bc9cdca70ff7cf93e5b4a0bd33b5153cb1a8d1", bytes: 4631408,
    }],
    freshness: "snapshot", filters: ["year", "region", "code", "limit", "offset"],
    caveat: "Contratto distinto da FC70TOT 2021 e FC80TOT 2022: nessuna somma o confronto silenzioso tra annualità. Il 2020 non è ricostruito. La differenza dalla spesa standard non è spreco né un ranking di efficienza. RSS e aggregati sovracomunali fuori perimetro.",
  },
  { id: "opencoesione_progetti", title: "OpenCoesione", summary: "Aggregati nazionali su costo pubblico, pagamenti, temi, natura e stato dei progetti.", sourceIds: ["opencoesione"], freshness: "snapshot", filters: [], caveat: "Il rapporto pagamenti/costo non misura il completamento o la qualità dei progetti." },
  {
    id: "opencup_progetto",
    title: "OpenCUP · progetti per CUP",
    summary: "Registrazioni del dataset OpenCUP Progetti selezionate per codice CUP esatto, con duplicati della fonte preservati e paginazione stabile.",
    sourceIds: ["opencup"],
    freshness: "snapshot",
    integration: OPENCUP_PRODUCT_INTEGRATION,
    filters: ["cup", "limit", "cursor"],
    caveat: "Il costo dichiarato del progetto, il finanziamento richiesto e gli eventuali pagamenti osservati sono grandezze diverse e non vanno sommati né interpretati come avanzamento. Un CUP può avere più registrazioni sorgente. La presenza nel perimetro OpenCUP non prova l'appartenenza al PNRR; il corpus nazionale resta indisponibile finché manifest e storage non sono promossi.",
  },
  { id: "pnrr_progetti", title: "PNRR · catalogo nazionale dei progetti", summary: "291.398 registrazioni CUP/CLP/submisura ReGiS al 13 giugno 2026; 285.992 CUP validi distinti. Tutte le missioni, con finanziamenti e localizzazioni dichiarate.", sourceIds: ["italiadomani"], freshness: "snapshot", filters: ["cup", "mission", "component", "measure", "submeasure", "code", "region", "province", "territory", "limit", "cursor"], caveat: "Codici esatti: mission=M1, component=M1C1, measure=M1C1I1.01, submeasure=M1C1I1.01.00; code=CF attuatore, region/province a 3 cifre, territory=Provincia+Comune a 6 cifre. Filtri combinati in AND. matchedRows conta registrazioni, non CUP unici. Finanziamento non è pagamento; attuatore non è localizzazione. Progetti non validati inclusi. Cursor vincolato a filtri e rilascio; una pagina può restituire meno di limit per il budget di lettura." },
  { id: "pnrr_asili", title: "PNRR asili e prima infanzia", summary: "Progetti Italia Domani per CUP, localizzazioni, finanziamenti, gare e aggiudicatari.", sourceIds: ["italiadomani"], freshness: "snapshot", filters: ["cup", "query", "region", "province", "limit", "offset"], caveat: "Il finanziamento PNRR non è un pagamento osservato; gare e aggiudicazioni sono livelli distinti." },
  { id: "anac_cig_snapshot", title: "Contratti pubblici ANAC · CIG 2025", summary: "Aggregati verificati sui dodici file mensili CIG 2025, con copertura, hash, procedure e fasce di importo.", sourceIds: ["anac"], freshness: "snapshot", filters: ["year"], caveat: "È uno strumento di screening aggregato: non prova spreco, illecito, corruzione o frazionamento e non consente ancora la ricerca live per CIG." },
  {
    id: "anac_operatori",
    title: "Imprese aggiudicatarie ANAC · indice storico nazionale",
    summary: "Lo stesso indice delle pagine operatori: query cerca una denominazione (3-120 caratteri); code apre un riferimento op-########; measure ordina per awardCount o attributedValue. Usa uno solo di questi filtri. limit 1-10 limita le imprese, oppure i CIG recenti in una scheda.",
    sourceIds: ["anac"],
    freshness: "snapshot",
    filters: ["query", "code", "measure", "limit"],
    customSources: [
      { id: "anac-aggiudicatari", name: "ANAC · aggiudicatari", owner: "Autorità Nazionale Anticorruzione", url: "https://dati.anticorruzione.it/opendata/dataset/aggiudicatari", cadence: "Snapshot; data di osservazione e date delle fonti nella risposta", license: "CC BY-SA 4.0" },
      { id: "anac-aggiudicazioni", name: "ANAC · aggiudicazioni", owner: "Autorità Nazionale Anticorruzione", url: "https://dati.anticorruzione.it/opendata/dataset/aggiudicazioni", cadence: "Snapshot; data di osservazione e date delle fonti nella risposta", license: "CC BY-SA 4.0" },
      { id: "anac-cig-storico", name: "ANAC · CIG annuali 2007-2025", owner: "Autorità Nazionale Anticorruzione", url: "https://dati.anticorruzione.it/opendata/dataset?q=cig-+anno&organization=anticorruzione", cadence: "Snapshot annuali 2007-2025", period: "2007-2025 (dettaglio procedure CIG)", license: "CC BY-SA 4.0" },
    ],
    caveat: "Indice storico cross-temporale; non dichiara la popolazione nazionale corrente. Importi di aggiudicazione dichiarata, non pagamenti o incassi. Valore solo per operatore unico; schede con al massimo 15 CIG pubblicati. Ranking descrittivi, non prove di irregolarità. I riferimenti op-######## valgono nello snapshot consultato.",
    publicMetadata: {
      period: [
        "Snapshot dell'indice operatori osservato il 2026-09-08; struttura cross-temporale, con anno minimo e massimo per operatore riportati nella risposta.",
        "I campi procedura (oggetto, CPV, stazione appaltante) derivano dagli snapshot CIG annuali 2007-2025 e possono mancare se il CIG non compare in quei file.",
      ],
      units: [
        "Importi di aggiudicazione dichiarata in euro (stringhe decimali), non pagamenti o incassi.",
        "awardCount conta le aggiudicazioni, incluse quelle con più operatori; attributedValue attribuisce il valore solo alle aggiudicazioni con operatore unico risolto.",
      ],
      coverage:
        "5.345.384 righe candidate, incluse 3.906 duplicazioni della chiave CIG/aggiudicazione/CF; 3.591 relazioni distinte unmatched; 5.337.887 relazioni distinte risolte. Su 5.437.334 righe eleggibili, 91.950 restano non risolte per codice fiscale non valido. L'indice copre 478.418 operatori con CF valido, 4.478.729 aggiudicazioni attribuite e 1.896.866 aggiudicazioni pubblicate (massimo 15 per operatore). La copertura nazionale corrente non è dichiarata: è uno snapshot cross-temporale, non un censimento.",
      queryNotes: [
        "Usa un solo selettore fra query (3-120 caratteri alfanumerici, ricerca per prefisso e sottostringa su denominazione normalizzata), code (riferimento op-######## dello snapshot) e measure (awardCount oppure attributedValue).",
        "limit 1-10 limita le imprese in ricerca o classifica, oppure i CIG della scheda; le righe restituite non sono il totale e il campione pubblica al massimo 15 CIG per operatore.",
        "I riferimenti op-######## valgono solo nello snapshot osservato e non sono identificativi stabili tra aggiornamenti.",
      ],
      references: [],
    },
  },
  { id: "consip_ordini", title: "Acquisti Consip · ordini Convenzioni e MEPA", summary: "Righe ordinate su Convenzioni e MEPA 2024-2026 aggregate per regione e tipologia di amministrazione, con importi noti e celle soppresse dichiarate.", sourceIds: ["consip"], freshness: "snapshot", filters: ["year", "channel"], caveat: "Gli importi sono limiti inferiori: la fonte sopprime il valore in molte righe (nei file MEPA importo e numero ordini sono mutuamente esclusivi) e pubblica anche storni negativi. Ordinato non è pagato e Consip non è tutta la spesa per acquisti della PA: nessun confronto con ANAC o SIOPE è una riconciliazione." },
  { id: "eurostat_cofog", title: "Eurostat · spesa pubblica per funzione (COFOG)", summary: "Spesa delle Amministrazioni pubbliche per funzione COFOG dal 2014 al 2024, in milioni di euro e in quota di PIL, per UE27, area euro e trenta Stati; per l’Italia anche le sottofunzioni ufficiali di tutte e dieci le divisioni (filtro cofog, per esempio GF1002).", sourceIds: ["eurostat-cofog"], freshness: "snapshot", filters: ["country", "year", "cofog"], caveat: "Competenza economica SEC 2010: non sono pagamenti di cassa, quindi nessun confronto con SIOPE è una riconciliazione e la spesa per funzione non misura efficienza o qualità del servizio. Il totale è quello pubblicato dalla fonte e differisce dalla somma delle dieci divisioni per solo arrotondamento. Le celle con flag «b» segnano una interruzione della serie storica e non sono confrontabili a cavallo; quelle con flag «p» sono provvisorie. Gli aggregati UE27 e area euro contengono già gli Stati membri e non vanno sommati a essi." },
  { id: "eurostat_conti_pa", title: "Eurostat · entrate e uscite delle Amministrazioni pubbliche", summary: "Entrate totali, uscite totali e saldo B9 delle Amministrazioni pubbliche italiane dal 1995 al 2025, con le componenti delle identità SEC e gli interessi D41PAY, in milioni di euro e in quota di PIL.", sourceIds: ["eurostat-gov-main"], freshness: "snapshot", filters: ["year", "code"], caveat: "Competenza economica SEC 2010: non sono incassi né pagamenti di cassa, quindi non si confrontano con SIOPE e non si sommano a CPT, OpenBDAP o COFOG. code seleziona una voce na_item (TR, TE, B9, una componente o D41PAY). I totali sono quelli della fonte e riconciliano con le componenti entro il solo arrotondamento. D41PAY è una voce «di cui» di D4PAY e coincide al centesimo con gli interessi di debito_pubblico_italiano: non va sommata a D4PAY né trattata come seconda fonte." },
  { id: "istat_cofog", title: "ISTAT · consumi finali della PA per funzione (COFOG)", summary: "Consumi finali delle Amministrazioni pubbliche per funzione COFOG dal 1995 al 2023, a prezzi correnti, per Italia, ripartizioni e regioni.", sourceIds: ["istat-cofog"], freshness: "snapshot", filters: ["territory", "year", "cofog"], caveat: "Sono i consumi finali (P3), NON la spesa pubblica totale: nel 2023 circa 383 miliardi contro i circa 1149 della spesa totale delle AP. Nessun confronto o somma con Eurostat COFOG, SIOPE o le missioni del bilancio è una riconciliazione. L\u2019edizione è una revisione e resta fissata: fra due edizioni cambiano centinaia di celle. Le aree composite (Nord, Centro-nord, Mezzogiorno, Trentino Alto Adige) contengono già le loro parti e non vanno sommate a esse. Il dato territoriale è territorio di erogazione contabile, non quanto riceve un cittadino, e non misura efficienza o qualità del servizio.",
    publicMetadata: {
      period: [
        "Edizione fissata 2025M12: anni di riferimento 1995–2023.",
        "Contabilità nazionale a prezzi correnti (valutazione V); le edizioni sono revisioni e non vanno mescolate: fra la 2025M1 e la 2025M12 cambiano 337 delle 704 celle confrontabili.",
        "Osservazione dello snapshot: 2026-09-04.",
      ],
      units: [
        "Consumi finali (P3) delle Amministrazioni pubbliche (S13): una componente della spesa, NON la spesa pubblica totale delle AP.",
        "La fonte pubblica milioni di euro a prezzi correnti; il dataset espone importi in centesimi di euro e non aggiunge precisione.",
      ],
      coverage:
        "Italia, ripartizioni e regioni, 1995–2023: 32 aree — incluse l'Extra-Regio (codice ITZ) e le composite —, totale G e dieci divisioni COFOG (G010–G100) su 29 anni, 10.208 celle attese e osservate. Le aree composite (Nord, Centro-nord, Mezzogiorno, Trentino Alto Adige) contengono già le loro parti e non vanno sommate a esse.",
      queryNotes: [
        "Filtri: year (1995–2023), territory (codice ISTAT dell'area pubblicata) e cofog (G oppure G010…G100); più filtri insieme si combinano in AND.",
        "Consumi finali a competenza economica, non cassa SIOPE: nessun confronto o somma con SIOPE è una riconciliazione.",
      ],
      references: [],
    },
  },
  { id: "istat_epea", title: "ISTAT · spesa per la protezione dell'ambiente (EPEA)", summary: "Conti della spesa per la protezione dell'ambiente, edizione 2025M2, anni 2016–2022, per settore istituzionale e classe CEPA.", sourceIds: ["istat-epea"], freshness: "snapshot", filters: ["year", "sector", "cepa"], caveat: "Contabilità SEC di competenza: non è cassa SIOPE. Non sommare né confrontare in silenzio con RGS, PNRR Missione 2 o SAD/SAF. TOT_CEPA e totali settoriali non vanno sommati alle parti che già li compongono. Edizione 2025M2 fissata.",
    publicMetadata: {
      period: [
        "Edizione fissata 2025M2: anni di riferimento 2016–2022.",
        "Contabilità SEC di competenza economica; le edizioni sono revisioni e non vanno mescolate.",
      ],
      units: [
        "Valori in milioni di euro a prezzi correnti (UNIT_MEAS=EURO, UNIT_MULT=6) nella fonte; il dataset espone centesimi di euro (amountCents) e non aggiunge precisione.",
        "Spesa per la protezione dell'ambiente per settore istituzionale e classe CEPA: contabilità di competenza, non cassa SIOPE.",
      ],
      coverage:
        "Italia, 2016–2022: sette settori istituzionali (S1, S13_15, S14, S1K, S1K_ANC, S1K_SPASEC, S2) e otto classi CEPA (CEPA1, CEPA2, CEPA3, CEPA4, CEPA5, CEPA6, CEPA7_9, TOT_CEPA). Ogni riga porta anche l'aggregato contabile dataTypeAggr (17 valori): aggregati, settori e classi CEPA restano dimensioni distinte e non vanno sommati fra loro. TOT_CEPA e i totali settoriali contengono già le parti e non vanno sommati a esse.",
      queryNotes: [
        "Specificare almeno un filtro fra year (2016–2022), sector e cepa: la serie completa senza filtri viene rifiutata.",
        "sector accetta i codici pubblicati; cepa accetta CEPA1…CEPA7_9 oppure TOT_CEPA.",
        "dataTypeAggr è presente nelle righe (17 aggregati contabili) ma non è offerto come filtro: non è selezionabile.",
      ],
      references: [],
    },
  },
  { id: "istat_poverta_assoluta", title: "ISTAT · povertà assoluta", summary: "Indicatori ufficiali di povertà assoluta, serie corrente post-revisione, anni 2014–2024, per Italia e ripartizioni: incidenza familiare e individuale, intensità, composizione percentuale e conteggi in migliaia di famiglie e individui.", sourceIds: ["istat-poverta"], freshness: "snapshot", filters: ["territory", "year", "measure"], caveat: "NON è spesa pubblica: sono incidenze, intensità e conteggi, mai sommabili né accostabili a SIOPE, OpenBDAP o IRPEF. Incidenza, intensità e composizione sono misure diverse con unità diverse e non si sommano fra loro; famiglie e individui sono denominatori distinti. Solo i conteggi sono sommabili fra territori: sommare le incidenze delle ripartizioni non dà il valore nazionale. Le aree composite Nord e Mezzogiorno contengono già le loro parti. È la serie corrente dal 2014: le serie 34_201/34_202 finiscono nel 2013 e la 34_728 è interrotta, non vanno mai giuntate. ISTAT non pubblica la povertà a livello comunale. Il dato non misura efficacia di una manovra né responsabilità di un governo.", },
  { id: "istat_poverta_relativa", title: "ISTAT · povertà relativa", summary: "Indicatori ufficiali di povertà relativa, serie corrente post-revisione, anni 2014–2024, per Italia e ripartizioni: incidenza familiare e individuale, intensità, composizione percentuale e conteggi in migliaia di famiglie e individui.", sourceIds: ["istat-poverta-relativa"], freshness: "snapshot", filters: ["territory", "year", "measure"], caveat: "NON è la povertà assoluta e NON va sommata né confrontata con essa: la relativa misura la distanza dalla spesa media delle famiglie, l'assoluta il costo di un paniere di beni essenziali. Sono due definizioni diverse della stessa parola. NON è spesa pubblica: nessun accostamento a SIOPE, OpenBDAP o IRPEF. Incidenza, intensità e composizione hanno unità diverse e non si sommano fra loro; famiglie e individui sono denominatori distinti. Solo i conteggi sono sommabili fra territori. Le aree composite Nord e Mezzogiorno contengono già le loro parti. È la serie corrente dal 2014: 34_202 finisce nel 2013 e la 34_728 è interrotta, non vanno mai giuntate. ISTAT non pubblica la povertà a livello comunale.", },
  {
    id: "istat_poverta_soglia_assoluta",
    title: "ISTAT · soglia di povertà assoluta",
    summary: `Soglie monetarie mensili di povertà assoluta (dataflow ${istatPovertaSogliaAssolutaMetadata.source.dataflowId}), anni ${istatPovertaSogliaAssolutaMetadata.period.from}–${istatPovertaSogliaAssolutaMetadata.period.to}, per territorio, tipologia familiare e ampiezza demografica; celle vuote restano null, distinte da zero.`,
    sourceIds: ["istat-poverta-soglia-assoluta"],
    freshness: "snapshot",
    filters: ["territory", "year", "family", "band", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. È una soglia monetaria mensile in centesimi di euro, NON spesa pubblica e NON confrontabile/sommabile con le incidenze 34_727. La soglia relativa 34_212 è chiusa al 2013 e fuori perimetro. family=tipologia familiare, band=ampiezza demografica. Celle vuote restano null ≠ zero. Nord e Mezzogiorno sovrappongono parti. UNIT_MEAS assente nel payload. Licenza not-declared.",
    publicMetadata: {
      ...istatPovertaSogliaAssolutaMetadata.publicMetadata,
      queryNotes: [
        "Specificare almeno un filtro fra territory, year, family e band; limit massimo 100 righe per pagina.",
        "Celle vuote restano null ≠ zero; riga assente è distinta sia da null che da zero.",
      ],
    } satisfies DatasetPublicMetadata,
  },
  {
    id: "istat_poverta_soglia_relativa",
    title: "ISTAT · soglia di povertà relativa",
    summary: `Soglie monetarie mensili di povertà relativa (dataflow ${istatPovertaSogliaRelativaMetadata.source.dataflowId}), anni pubblicati senza il 2021, solo Italia, per ampiezza familiare N1–N7_GE.`,
    sourceIds: ["istat-poverta-soglia-relativa"],
    freshness: "snapshot",
    filters: ["territory", "year", "band", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. È una soglia monetaria mensile in centesimi di euro, NON spesa pubblica e NON confrontabile/sommabile con le incidenze 34_727 né con la soglia assoluta 34_211. Solo territorio IT. L'anno 2021 è escluso dal prodotto. band=N1…N6 o N7_GE. UNIT_MEAS assente nel payload. Licenza not-declared.",
    publicMetadata: {
      ...istatPovertaSogliaRelativaMetadata.publicMetadata,
      queryNotes: [
        "Specificare almeno un filtro fra territory, year e band; limit massimo 100 righe per pagina.",
        "L'anno 2021 è escluso dal prodotto; band=N1…N6 o N7_GE; solo territorio IT.",
      ],
    } satisfies DatasetPublicMetadata,
  },
  {
    id: "istat_poverta_regioni",
    title: "ISTAT · povertà relativa per regione",
    summary: `Incidenza di povertà relativa di famiglie e individui per regione e provincia autonoma (dataflow ${istatPovertaRegioniMetadata.source.dataflowIds.join(" e ")}), 2014–2024, 30 territori.`,
    sourceIds: ["istat-poverta-regioni"],
    freshness: "snapshot",
    filters: ["territory", "measure", "year", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. È un'incidenza percentuale, NON un importo: non sommare fra territori. measure=households o individuals. Povertà RELATIVA: l'incidenza assoluta non è pubblicata per regione e si ferma alle ripartizioni, quindi nessun confronto riga per riga con le altre fette 34_727. I territori sono annidati (Italia, Nord e Mezzogiorno, ripartizioni, regioni, province autonome): sommare le regioni non ricostruisce l'Italia. Celle non diffuse e righe assenti dalla fonte viaggiano con la risposta e non valgono zero. Bolzano non ha alcun valore familiare. UNIT_MEAS assente nel payload. Licenza not-declared.",
    publicMetadata: {
      ...istatPovertaRegioniMetadata.publicMetadata,
      queryNotes: [
        "Specificare almeno un filtro fra territory, measure e year; limit massimo 100 righe per pagina.",
        "measure=households o individuals; territory usa i codici ISTAT, per esempio ITC4 per la Lombardia.",
        "undiffused e missingRows elencano ciò che la fonte non pubblica: non sono zeri.",
      ],
    } satisfies DatasetPublicMetadata,
  },
  {
    id: "eurostat_arope",
    title: "Eurostat · AROPE (Europa 2030)",
    summary: `Rischio di povertà o esclusione sociale (dataset ${eurostatAropeMetadata.source.dataflowId}), Italia 2015–2025: tasso percentuale e persone in migliaia, definizione Europa 2030.`,
    sourceIds: ["eurostat-arope"],
    freshness: "snapshot",
    filters: ["territory", "year", "limit", "offset"],
    caveat: "Specificare almeno un filtro fra territory e year; pagine di massimo 100 righe. NON è spesa pubblica e NON è la povertà assoluta/relativa ISTAT (34_727): definizioni distinte, non sommabili né confrontabili. Solo Italia. Serie Europa 2020 (ilc_peps01) fuori perimetro. PC e THS_PER non si sommano fra loro. Licenza CC BY 4.0.",
    publicMetadata: {
      ...eurostatAropeMetadata.publicMetadata,
      queryNotes: [
        "Specificare almeno un filtro fra territory e year; limit massimo 100 righe per pagina.",
        "Solo territorio IT; definizione Europa 2030 (ilc_peps01n).",
      ],
    } satisfies DatasetPublicMetadata,
  },
  { id: "istat_bes_economico", title: "ISTAT · BES dei territori, benessere economico", summary: "Cinque indicatori del dominio benessere economico del BES dei territori, edizione 2025, per Italia, ripartizioni, regioni e 111 province: reddito medio disponibile pro capite, retribuzione media, importo medio dei redditi pensionistici, quota di pensionati con reddito basso e tasso di ingresso in sofferenza dei prestiti alle famiglie.", sourceIds: ["istat-bes-economico"], freshness: "snapshot", filters: ["territory", "year", "measure", "sex"], caveat: "NON è spesa pubblica: misura quanto le famiglie hanno, non quanto lo Stato spende. Nessuna somma o accostamento con SIOPE, OpenBDAP o IRPEF. Sono medie pro capite e percentuali, quindi NON sommabili fra territori: la media di una ripartizione non è la somma di quelle delle sue province. Il totale per sesso non è la somma di F e M, è la media sull'intera popolazione. Ogni indicatore ha il proprio periodo: non esiste un unico 2004-2024, e confrontare indicatori diversi agli estremi significa confrontare anni diversi. Le aree composite Nord e Mezzogiorno contengono già le loro parti. L'anagrafica delle province non è stabile: include province istituite dopo e le tre sarde soppresse nel 2016. Nessun indice composito e nessuna classifica di territori.", },
  {
    id: "istat_bes_salute",
    title: "ISTAT · BES dei territori, Salute",
    summary: "Sei indicatori ufficiali del dominio BES_01, edizione 2025: speranza di vita, mortalità infantile, per incidenti stradali, tumore, demenze e malattie del sistema nervoso, evitabile. 135 territori, di cui 107 province; periodi propri dal 2004 al 2022, 2023 o 2024.",
    sourceIds: ["istat-bes-salute"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro. Ogni indicatore conserva definizione, unità e periodo: anni medi, per 1.000 nati vivi oppure tassi standardizzati per 10.000 residenti nelle età indicate. T è distinto da F/M; il flag n resta null, distinto da zero e da una riga assente. Dati provinciali, non comunali; geografia non costante nel tempo, compositi Nord/Mezzogiorno e padri esterni di Bolzano/Trento dichiarati. Non è spesa, LEA o efficienza. Nessuna somma, media ricostruita, imputazione, classifica o indice composito. Licenza non dichiarata. La nota inglese della mortalità infantile è discordante: unità inline, codelist e testo italiano indicano 1.000 nati vivi.",
  },
  {
    id: "istat_bes_istruzione",
    title: "ISTAT · BES dei territori, Istruzione",
    summary: "Nove indicatori BES_02 Istruzione e formazione, edizione 2025; 14.952 osservazioni e 139 territori, di cui 111 province. Periodi e disponibilità per sesso distinti per indicatore fra 2004 e 2024.",
    sourceIds: ["istat-bes-istruzione"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Percentuali e tasso specifico di coorte con denominatori propri: non è spesa pubblica né una misura di qualità o efficienza. Nessuna somma geografica o F+M, imputazione comunale, classifica o correlazione SIOPE. Il flag g resta null; riga assente e zero sono distinti. INVALSI senza 2020; 12SER002 appartiene a BES_02. Valori ufficiali di partecipazione scolastica sopra 100% conservati. Compositi e padri esterni dichiarati, geografia non costante. Licenza non dichiarata.",
  },
  {
    id: "istat_bes_lavoro",
    title: "ISTAT · BES dei territori, Lavoro",
    summary: "Sei indicatori BES_03 Lavoro e conciliazione dei tempi di vita, edizione 2025; 19.120 osservazioni e 135 territori, di cui 107 province. Periodi propri fra 2008 e 2024.",
    sourceIds: ["istat-bes-lavoro"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Occupazione, mancata partecipazione, giornate retribuite e infortuni hanno denominatori distinti: non sono spesa pubblica, non si sommano e non formano un indice. F, M e T restano serie separate. Il flag g resta null, distinto da zero e da una riga assente. Dati provinciali, non comunali; compositi, padri esterni e geografia variabile dichiarati. Nessuna imputazione, classifica, causalità politica o giudizio sulla sicurezza di una singola impresa. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_relazioni",
    title: "ISTAT · BES dei territori, Relazioni sociali",
    summary: "Due indicatori BES_05 Relazioni sociali, edizione 2025; 1.330 osservazioni e 135 territori, di cui 107 province. Periodi propri fra 2011 e 2024; payload ufficiale solo SEX=T.",
    sourceIds: ["istat-bes-relazioni"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Scuole accessibili e organizzazioni non profit per 10.000 abitanti hanno denominatori distinti: non sono spesa pubblica, non si sommano e non formano un indice. Solo SEX=T è pubblicato. Il flag n resta null, distinto da zero e da una riga assente. Dati provinciali, non comunali; compositi, padri esterni e geografia variabile dichiarati. Nessuna imputazione, classifica o correlazione SIOPE. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_politica",
    title: "ISTAT · BES dei territori, Politica e istituzioni",
    summary: "Sette indicatori BES_06 Politica e istituzioni, edizione 2025; 15.818 osservazioni e 139 territori, di cui 111 province. Periodi propri fra 2004 e 2024; payload ufficiale solo SEX=T.",
    sourceIds: ["istat-bes-politica"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Partecipazione elettorale, rappresentanza, capacità di riscossione e affollamento carcerario hanno unità e periodi distinti: non sono spesa pubblica, non si sommano e non formano un indice. Solo SEX=T è pubblicato. Celle con OBS_VALUE vuoto restano null senza flag inventato, distinte da zero e da una riga assente. Dati provinciali, non comunali; compositi, padri esterni e geografia variabile dichiarati. Nessuna imputazione, classifica o correlazione SIOPE. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_sicurezza",
    title: "ISTAT · BES dei territori, Sicurezza",
    summary: "Sei indicatori BES_07 Sicurezza, edizione 2025; 14.481 osservazioni e 139 territori, di cui 111 province. Periodi propri fra 2004 e 2023; payload ufficiale solo SEX=T.",
    sourceIds: ["istat-bes-sicurezza"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Tassi di delitti per 100.000 abitanti e mortalità stradale percentuale hanno denominatori distinti: non sono spesa COFOG GF03, non si sommano e non formano un indice. Solo SEX=T è pubblicato. Il flag g resta null, distinto da zero e da una riga assente. Dati provinciali, non comunali; compositi, padri esterni e geografia variabile dichiarati. Nessuna imputazione, classifica o correlazione SIOPE. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_paesaggio",
    title: "ISTAT · BES dei territori, Paesaggio e patrimonio culturale",
    summary: "Tre indicatori BES_09 Paesaggio e patrimonio culturale, edizione 2025; 3.760 osservazioni e 139 territori, di cui 111 province. Periodi propri fra 2004 e 2023; payload ufficiale solo SEX=T.",
    sourceIds: ["istat-bes-paesaggio"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Densità museale, agriturismi e verde storico hanno unità territoriali distinte: non sono spesa pubblica, non si sommano e non formano un indice. Solo SEX=T. Flag n/g restano null. Valori in centesimi. Dati provinciali; compositi e padri esterni dichiarati. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_servizi",
    title: "ISTAT · BES dei territori, Qualità dei servizi",
    summary: "Otto indicatori BES_12 Qualità dei servizi, edizione 2025; 15.858 osservazioni e 139 territori, di cui 111 province. Periodi propri fra 2004 e 2024; payload ufficiale solo SEX=T.",
    sourceIds: ["istat-bes-servizi"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Percentuali, densità per abitanti, medie per utente e posti-km hanno unità distinte: non sono spesa pubblica, non si sommano e non formano un indice. Solo SEX=T. Flag n/g restano null. Valori in decimi. Dati provinciali; compositi e padri esterni dichiarati. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_ambiente",
    title: "ISTAT · BES dei territori, Ambiente",
    summary: "Undici indicatori BES_10 Ambiente, edizione 2025; 13.423 osservazioni e 139 territori, di cui 111 province. Periodi propri fra 2004 e 2023; payload ufficiale solo SEX=T.",
    sourceIds: ["istat-bes-ambiente"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Concentrazioni, percentuali, m²/abitante e kg/abitante hanno unità distinte: non sono spesa pubblica, non si sommano e non formano un indice. Solo SEX=T. Flag g resta null. Valori in centesimi. Per 10AMB018P UNIT_MEAS e note restano vuoti come nel payload. Dati provinciali; compositi e padri esterni dichiarati. Licenza del payload non dichiarata.",
  },
  {
    id: "istat_bes_innovazione",
    title: "ISTAT · BES dei territori, Innovazione, ricerca e creatività",
    summary: `Indicatori del dominio BES_11 Innovazione, ricerca e creatività, edizione ${istatBesInnovazioneMetadata.semantics.provenance.publicationEdition}, per territori ISTAT; periodi propri per indicatore e payload ufficiale solo SEX=T.`,
    sourceIds: ["istat-bes-innovazione"],
    freshness: "snapshot",
    filters: ["territory", "year", "measure", "sex", "limit", "offset"],
    caveat: "Specificare almeno un filtro; pagine di massimo 100 righe. Brevetti, addetti culturali, comuni online e mobilità dei laureati hanno unità distinte: non sono spesa pubblica, non si sommano e non formano un indice. Solo SEX=T. Nessuna cella n/g nel payload; 11RIC025 resta firmato. Valori in decimi. Quattro province sarde storiche assenti. Licenza del payload non dichiarata.",
    publicMetadata: {
      ...istatBesInnovazioneMetadata.publicMetadata,
      queryNotes: [
        "Specificare almeno un filtro fra territory, year, measure e sex; limit massimo 100 righe per pagina.",
        "Ogni indicatore conserva definizione, unità e periodo propri: recuperarli dalla risposta o dalle definizioni del dataflow.",
      ],
    } satisfies DatasetPublicMetadata,
  },
  { id: "inps_naspi", title: "INPS · NASpI beneficiari e trattamenti", summary: "Beneficiari e trattamenti NASpI dal 2018 al 2022 per ripartizione, regione e provincia, con sesso, classe di età e durata teorica, da nove tabelle SDMX.", sourceIds: ["inps-naspi"], freshness: "snapshot", filters: ["table", "measure", "year", "territory"], caveat: "Beneficiari e trattamenti sono misure diverse — persone contro periodi di prestazione — e non vanno sommate né confrontate. Sono conteggi, NON euro: nessuna somma con la spesa per prestazioni, con SIOPE o con i bilanci INPS. È un flusso annuale, non lo stock di pensioni vigenti o di invalidità civile già in piattaforma, e non è sommabile fra anni. Le celle soppresse per privacy restano nulle e non sono zeri osservati. Territorio, sesso, classe di età e durata sono dimensioni distinte e non denominatori intercambiabili. Il numero di beneficiari non dice nulla su adeguatezza o merito della prestazione." },
  { id: "inps_assegno_unico", title: "INPS · Assegno Unico", summary: "Assegno Unico 2022-2024 per provincia: nuclei e figli (AUU a domanda, esclusi RdC). Filtri table, year, province e region opzionali.", sourceIds: ["inps-assegno-unico"], freshness: "snapshot", filters: ["table", "year", "province", "region"], caveat: "Non è la popolazione totale AUU: esclusi i beneficiari RdC. Importi erogati in millesimi di euro. Nuclei, figli e mesi sono nature distinte e non si sommano. Nel package nuclei numero_figli non è documentato come conteggio di figli distinti. Licenza cc-by, distinta da NASpI IODL 2.0. Nessuna lettura di adeguatezza o merito." },
  { id: "inps_integrazioni_salariali", title: "INPS · CIG 2023", summary: "Lavoratori, domande e mensilità per regione/mese/tipo. Filtri table, year, period, region e code (tipo intervento).", sourceIds: ["inps-integrazioni-salariali"], freshness: "snapshot", filters: ["table", "year", "period", "region", "code"], caveat: "Conteggi, non euro. Nature distinte; copertura chiavi non identica. Distinto da NASpI/AUU. Licenza cc-by." },
  { id: "inps_cig_fondi_solidarieta", title: "INPS · CIG Fondi Solidarietà", summary: "Ore autorizzate 2023–2024 per regione/mese/gestione/ramo. Filtri year, period, region, code (gestione) e sector.", sourceIds: ["inps-cig-fondi-solidarieta"], freshness: "snapshot", filters: ["year", "period", "region", "code", "sector"], caveat: "Ore, non euro né lavoratori. Distinto da integrazioni salariali/NASpI/AUU. Licenza cc-by." },
  { id: "inl_vigilanza", title: "INL · vigilanza 2025", summary: "Ispezioni, esiti e recuperi INL 2025 per territorio/settore. Filtri table, year, territory e sector.", sourceIds: ["inl-vigilanza"], freshness: "snapshot", filters: ["table", "year", "territory", "sector"], caveat: "Tasso su controlli mirati, non stima economia. Recuperi ≠ tax gap/VAT/NOE. CC BY 3.0 IT." },
  { id: "aifa_farmaci_spesa", title: "AIFA · spesa e consumo farmaci per ATC", summary: "Spesa e confezioni 2022–2025 per regione (codice ISTAT), classe di rimborsabilità e ATC di II livello, sui canali tracciabilità e convenzionata. Filtri year, region (codice ISTAT), code (ATC II) e band (classe).", sourceIds: ["aifa-spesa-consumi"], freshness: "snapshot", filters: ["year", "region", "code", "band"], caveat: "Tracciabilità (sell-in alle strutture pubbliche, lordo IVA) e convenzionata (farmacie, prezzo al pubblico) sono canali distinti e non vanno sommati. Importi al lordo dei payback: non è spesa netta del SSN e non si somma al Conto economico SSN, a SIOPE sanità o a COFOG GF07. Canale assente resta null, mai zero; i valori negativi della tracciabilità sono resi e note di credito. Le confezioni non sono dosi (DDD). Licenza CC BY 4.0 del catalogo Open Data AIFA." },
  { id: "mef_iva", title: "MEF · dichiarazioni IVA per regione e attività", summary: "Principali grandezze IVA dichiarate: dichiarazioni 2024-2025, anni di imposta 2023-2024. Richiede year (anno di dichiarazione) e breakdown (regione oppure attivita).", sourceIds: ["mef-iva"], freshness: "snapshot", filters: ["year", "breakdown", "limit", "offset"], caveat: "Importi dichiarati, non gettito riscosso o spesa pubblica. Ammontari e medie in centesimi di euro, frequenze e contribuenti in unità: non si sommano. I totali ufficiali non si sommano alle righe di dettaglio né fra i due tagli. Celle oscurate e mancanti restano distinte dagli zeri. Le classificazioni delle attività cambiano fra i due anni e non costituiscono una serie omogenea." },
  { id: "eu_vat_gap_italy", title: "DG TAXUD · VAT gap Italia", summary: "VTTL, VAT revenue e VAT compliance gap per l'Italia dal Report 2025 (foglio IT): anni 2019-2023 e 2024 stima rapida. Filtro year opzionale.", sourceIds: ["eu-vat-gap-italy"], freshness: "snapshot", filters: ["year"], caveat: "Stima di compliance rispetto al VTTL, non evasione accertata e non dichiarazioni MEF né NOE ISTAT. Importi in centesimi di euro; la quota gap è in milionesimi di unità sul VTTL. Il 2024 è rapid-estimate. Celle X e vuote restano non osservate. Nessuna media UE in questa slice." },
  { id: "istat_permessi_costruire", title: "ISTAT · permessi di costruire", summary: "Serie nazionali 2015-2025 sulle tavole introduttive a.1-a.4 (nuova residenziale, ampliamenti, non residenziale). Filtri year e table (a1-a4) opzionali.", sourceIds: ["istat-permessi-costruire-2015-2025"], freshness: "snapshot", filters: ["year", "table"], caveat: "Conteggi, volumi e superfici: non soldi e non opere pubbliche MOP/OpenBDAP. Solo Italia nazionale in questa slice; a.1-a.4 restano serie distinte. Celle vuote restano non osservate. Licenza zip not-declared." },
  { id: "mef_tax_gap_nazionale", title: "MEF · tax gap nazionale", summary: "Gap tributario e contributivo e propensione al gap dalla Relazione evasione 2025 (Tab. I.1 e I.2), anni 2018-2022. Filtri year e tax opzionali.", sourceIds: ["mef-tax-gap-nazionale"], freshness: "snapshot", filters: ["year", "tax"], caveat: "Stima MEF, non evasione accertata né recupero. Il 2022 è semi-definitivo. Forchette min/max restano forchette. Solo nazionale: distinto da VAT gap UE e NOE ISTAT. Importi in centesimi; propensione in decimi di punto percentuale." },
  { id: "eurostat_taxag", title: "Eurostat · aggregati fiscali PA", summary: "Gettito SEC 2010 Italia da gov_10a_taxag, 2014-2025, per voce e sottosettore ESA. Filtri year, sector e tax (na_item) opzionali.", sourceIds: ["eurostat-taxag"], freshness: "snapshot", filters: ["year", "sector", "tax"], caveat: "Competenza SEC, non cassa SIOPE né dichiarazioni MEF né tax gap. S1311 non significa denaro a Roma. Celle assenti restano assenti. Importi in centesimi da milioni di euro." },
  { id: "eurostat_sha_health", title: "Eurostat · spesa sanitaria SHA", summary: "Spesa sanitaria Italia per schema di finanziamento (hlth_sha11_hf), 2014-2025. Filtri year e code (schema SHA) opzionali.", sourceIds: ["eurostat-sha-health"], freshness: "snapshot", filters: ["year", "code"], caveat: "Distinto da CE SSN e COFOG GF07: non sommare. Il 2025 è provvisorio. Importi in centesimi." },
  { id: "mef_irpef_dettaglio", title: "MEF · dettaglio IRPEF per regione, età e sesso", summary: "Tipo di reddito, calcolo IRPEF e bonus dichiarati, incrociati con la classe di reddito complessivo, per regione, classe di età e sesso: dichiarazioni 2017-2025, anni di imposta 2016-2024. Il filtro year indica l’anno di dichiarazione.", sourceIds: ["mef-irpef-dettaglio"], freshness: "snapshot", filters: ["family", "breakdown", "year", "limit", "offset"], caveat: "Imposta e redditi DICHIARATI, non gettito riscosso: nessuna somma con SIOPE o con i bilanci pubblici. Frequenza, Ammontare in euro e Numero contribuenti sono tre nature distinte e non si sommano né si confrontano. Gli anni indicati sono anni di dichiarazione, non di imposta. La famiglia bonus misura due strumenti diversi sotto lo stesso nome — Bonus IRPEF fino al 2020, Trattamento integrativo dal 2022, entrambi nel 2021 — e le serie non sono concatenabili. Una cella vuota non è uno zero osservato. Le dimensioni non sono denominatori intercambiabili e i tagli non si sommano fra loro. Alcune misure esistono in un taglio e non in un altro nello stesso anno: l\u2019assenza è dichiarata, mai riempita." },
  { id: "inps_invalidita_civile", title: "Prestazioni INPS di invalidità civile", summary: "Spesa nazionale, stock di prestazioni e nuove pensioni di invalidità civile per regione.", sourceIds: ["inps"], freshness: "snapshot", filters: ["year", "region"], caveat: "Prestazioni, pensioni, spesa e nuove decorrenze sono misure diverse. I dati aggregati non provano frode e non consentono attribuzioni individuali." },
  { id: "inps_pensioni_vigenti", title: "Pensioni erogate dall'INPS", summary: "Stock di pensioni vigenti al 1 gennaio 2026, composizione per natura, categoria e gestione, e serie dei conteggi 2012-2026.", sourceIds: ["inps"], freshness: "snapshot", filters: [], caveat: "Perimetro solo INPS, inclusa la Gestione dipendenti pubblici ed esclusa Ex Inpgi. Stock, liquidazioni e tavola per anno di decorrenza restano misure diverse. Non è sommabile con il Casellario ISTAT né con la pagina Invalidità civile." },
  { id: "istat_pensioni_prestazioni", title: "Pensioni ISTAT · prestazioni", summary: "Numero di prestazioni pensionistiche, importo lordo annuo e importo lordo medio per categoria, dal 2012 al 2022.", sourceIds: ["istat-casellario-pensioni"], freshness: "snapshot", filters: ["year", "territory"], caveat: "territory omesso restituisce IT; ITTOT comprende Italia, Estero e Non indicato e non coincide con IT. Le finestre delle province sarde differiscono fra i due flussi. Il denominatore è il numero di prestazioni, non il numero di persone. Gli importi sono lordi e nominali, espressi in migliaia di euro per i totali e in euro per la media; i conteggi delle categorie riconciliano esattamente, mentre i relativi importi possono differire dal totale di 1-2 migliaia di euro per arrotondamento della fonte. Non è sommabile con pensionati né con CIVDIS/invalidità civile INPS." },
  { id: "istat_pensionati_persone", title: "Pensionati ISTAT · persone", summary: "Numero di persone pensionate, reddito pensionistico lordo annuo e media lorda, dal 2012 al 2022.", sourceIds: ["istat-casellario-pensioni"], freshness: "snapshot", filters: ["year", "territory"], caveat: "territory omesso restituisce IT; ITTOT comprende Italia, Estero e Non indicato e non coincide con IT. Le finestre delle province sarde differiscono fra i due flussi. Il denominatore è il numero di persone pensionate, non il numero di prestazioni. Gli importi sono lordi e nominali, espressi in migliaia di euro per i totali e in euro per la media. Non è sommabile con le prestazioni pensionistiche né con CIVDIS/invalidità civile INPS; lo snapshot non è una serie INPS 2024." },
  { id: "cpt_finanza_regionale", title: "Entrate e spese pubbliche per territorio", summary: "Entrate, spese e saldo contabile territorializzato della PA consolidata CPT, con valori pro capite e per km² 2023.", sourceIds: ["cpt", "istat"], freshness: "snapshot", filters: ["year", "region"], caveat: "Il saldo è entrate meno spese nello stesso perimetro CPT PA. Le normalizzazioni ISTAT non misurano pressione fiscale, qualità dei servizi, merito politico o trasferimenti netti fra regioni e non sono il residuo fiscale di Banca d'Italia." },
  {
    id: "mef_irpef_comunale",
    title: MEF_IRPEF_SOURCE.mcp.title,
    summary: MEF_IRPEF_SOURCE.mcp.summary,
    sourceIds: [MEF_IRPEF_SOURCE.id],
    freshness: "snapshot",
    filters: ["year", "level", "region", "province", "code", "query", "detail", "limit", "offset"],
    caveat: MEF_IRPEF_SOURCE.mcp.caveat,
    publicMetadata: {
      period: [
        "Anno d'imposta: 2024 — periodo economico delle variabili.",
        "Dichiarazioni: 2025 — il MEF assegna il contribuente al Comune del domicilio fiscale al 31 dicembre dell'anno di presentazione della dichiarazione.",
        "Pubblicazione della fonte MEF: 23 aprile 2026.",
        "Osservazione dello snapshot: 2026-09-04T08:16:29Z.",
      ],
      units: [
        "Contribuenti e frequenze: conteggi in unità di persone fisiche; il numero contribuenti non coincide con la frequenza del reddito complessivo.",
        "Ammontari monetari: interi in centesimi di euro; la fonte pubblica importi in euro e la conversione è esatta, senza aggiungere precisione.",
        "Variabili dichiarative MEF, non incassi di cassa.",
        "Le celle oscurate per tutela statistica restano parziali: null non è zero e non viene stimato.",
      ],
      coverage:
        "7896 Comuni, 107 Province e 20 Regioni; 7897 righe fonte con 1 riga Mancante/errata (5305 contribuenti) tenuta separata e non distribuita sui territori.",
      queryNotes: [
        "Il filtro year accetta solo l'anno d'imposta di riferimento (2024), non l'anno di dichiarazione.",
        "Il filtro level accetta region, province oppure municipality.",
        "Per i Comuni indica almeno uno fra code, query, region oppure province; code e query non insieme.",
      ],
      references: [
        {
          label: "Nota metodologica MEF 2024",
          url: "https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/nota_metodologica_2024.pdf",
        },
        {
          label: "Definizioni delle variabili MEF 2024",
          url: "https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/definizione_variabili_2024_irpef.pdf",
        },
        {
          label: "Licenza CC BY 3.0",
          url: "https://creativecommons.org/licenses/by/3.0/it/",
        },
      ],
    },
  },
  { id: "ipa_enti", title: "Enti pubblici IPA", summary: "Ricerca e scheda degli enti nell’Indice PA.", sourceIds: ["ipa"], freshness: "live", filters: ["query", "code", "limit", "offset"] },
  { id: "ipa_struttura", title: "Struttura organizzativa IPA", summary: "Unità organizzative e aree organizzative omogenee di un ente.", sourceIds: ["ipa-struttura"], freshness: "live", filters: ["code", "limit", "offset"] },
  { id: "mef_partecipazioni", title: "Partecipazioni pubbliche", summary: "Aggregati della rilevazione annuale MEF sulle partecipazioni pubbliche.", sourceIds: ["partecipazioni-pubbliche"], freshness: "snapshot", filters: [] },
  { id: "consulenti_incarichi", title: "Incarichi e consulenze", summary: "Statistiche nazionali ufficiali su incarichi esterni e a dipendenti pubblici.", sourceIds: ["consulenti"], freshness: "snapshot", filters: ["year"] },
  { id: "parlamento_bilanci", title: "Bilanci del Parlamento", summary: "Documenti e valori strutturati verificati per Camera e Senato quando disponibili.", sourceIds: ["camera"], freshness: "snapshot", filters: ["chamber", "year"] },
  { id: "controlli_segnali", title: "Segnali da controllare", summary: "Indicatori, classificazioni e screening derivati che orientano verifiche ulteriori.", sourceIds: ["opencivitas"], freshness: "snapshot", filters: ["area", "year", "region", "limit", "offset"], caveat: "Un segnale, compreso lo screening OpenCivitas, non attribuisce responsabilità e non dimostra da solo spreco o illecito." },
  { id: "debito_pubblico_italiano", title: "Debito pubblico italiano", summary: "Stock Maastricht, variazioni mensili, composizione, detentori, vita residua e interessi annuali.", sourceIds: ["bancaditalia", "eurostat"], freshness: "snapshot", filters: [], caveat: "Stock, flussi netti, detentori e interessi hanno periodi diversi. Le fonti pubblicano importi in milioni di euro: la conversione in centesimi interi non aggiunge precisione alla misura originaria. Gli indicatori per il cittadino descrivono esposizioni e meccanismi, non previsioni né effetti individuali." },
  { id: "registro_fonti", title: "Registro delle fonti", summary: "Proprietari, copertura, formati, cadenza e stato di integrazione delle fonti censite.", sourceIds: [], freshness: "snapshot", filters: ["query"] },
  {
    id: "salute_posti_letto",
    title: "Posti letto per Regione e disciplina",
    summary: "1.019 righe del Ministero della Salute al 1° gennaio 2023: 21 territori, 68 discipline, conteggi di posti letto e reparti.",
    sourceIds: [],
    customSources: [{
      id: "salute-posti-letto-2023", name: "Posti letto per Regione e disciplina 2023",
      owner: "Ministero della Salute",
      url: "https://www.dati.salute.gov.it/it/dataset/posti-letto-regione-e-disciplina-2023/",
      cadence: "Annuale", license: "IODL 2.0", dataAsOf: "2023-01-01", publishedAt: "2025-07-29",
    }],
    freshness: "snapshot",
    filters: ["query", "limit", "cursor", "offset"],
    caveat: "Accesso al corpus salute-posti-letto-2023. Conteggi, non euro; geografia delle strutture, non dei pazienti. La dotazione non misura pazienti curati, tempi di attesa o qualità delle cure. Nido escluso; eventuali modelli HSP12/HSP13 non trasmessi limitano la completezza. Il CE 2024 ha anno e perimetro diversi: nessun costo per posto letto o indice di efficienza.",
  },
  {
    id: "salute_dispositivi_medici",
    title: "Spesa rilevata per dispositivi medici",
    summary: "Cerca i dispositivi BD/RDM presenti nei dati di spesa dal 2018 al 2021. Restituisce anche aggregati per territorio, CND e fabbricante o assemblatore.",
    sourceIds: [],
    customSources: [
      {
        id: "salute-spesa-dispositivi-2018", name: "Dispositivi medici · spesa per azienda sanitaria · 2018",
        owner: "Ministero della Salute", url: "https://www.dati.salute.gov.it/it/dataset/dispositivi-medici-anno-2018-spesa-rilevata-azienda-sanitaria/",
        cadence: "risorsa annuale; promozione manuale", license: "IODL 2.0", publishedAt: "2020-12-28", period: "2018", rows: 718808,
      },
      {
        id: "salute-spesa-dispositivi-2019", name: "Dispositivi medici · spesa per azienda sanitaria · 2019",
        owner: "Ministero della Salute", url: "https://www.dati.salute.gov.it/it/dataset/dispositivi-medici-anno-2019-spesa-rilevata-azienda-sanitaria/",
        cadence: "risorsa annuale; promozione manuale", license: "IODL 2.0", publishedAt: "2020-12-28", period: "2019", rows: 768233,
      },
      {
        id: "salute-spesa-dispositivi-2020", name: "Dispositivi medici · spesa per azienda sanitaria · 2020",
        owner: "Ministero della Salute", url: "https://www.dati.salute.gov.it/it/dataset/dispositivi-medici-anno-2020-spesa-rilevata-azienda-sanitaria/",
        cadence: "risorsa annuale; promozione manuale", license: "IODL 2.0", publishedAt: "2023-03-17", period: "2020", rows: 787845,
      },
      {
        id: "salute-spesa-dispositivi-2021", name: "Dispositivi medici · spesa per azienda sanitaria · 2021",
        owner: "Ministero della Salute", url: "https://www.dati.salute.gov.it/it/dataset/dispositivi-medici-anno-2021-spesa-rilevata-azienda-sanitaria/",
        cadence: "risorsa annuale; promozione manuale", license: "IODL 2.0", publishedAt: "2023-03-17", period: "2021", rows: 846878,
      },
      {
        id: "salute-dispositivi-bdrdm", name: "Banca dati e Repertorio dei dispositivi medici",
        owner: "Ministero della Salute", url: "https://www.dati.salute.gov.it/it/dataset/dispositivi-medici/",
        cadence: "snapshot verificato", license: "IODL 2.0", dataAsOf: "2026-09-14", rows: 2416708,
      },
      {
        id: "salute-classificazione-cnd", name: "Classificazione nazionale dei dispositivi medici",
        owner: "Ministero della Salute", url: "https://www.dati.salute.gov.it/it/dataset/classificazione-nazionale-dei-dispositivi-medici-cnd/",
        cadence: "snapshot verificato", license: "IODL 2.0", dataAsOf: "2026-09-01", rows: 11115,
      },
    ],
    freshness: "snapshot",
    filters: ["view", "query", "deviceType", "deviceNumber", "year", "region", "code", "dimension", "value", "role", "limit", "cursor"],
    caveat: "La fonte riporta la spesa di acquisto nel perimetro pubblicato. Non riporta prezzi unitari, pagamenti al fabbricante o la spesa completa del SSN. Il fabbricante o assemblatore proviene dalla BD/RDM aggiornata al 14 settembre 2026 e non prova un ruolo storico. Non sommare questi importi con CE SSN, SIOPE o aggiudicazioni.",
  },
  {
    id: "spesa_pa_dettaglio",
    title: "Dettaglio integrato della spesa pubblica",
    summary:
      `Accesso uniforme ai ${INTEGRATED_CORPUS_CONTRACT.datasets} dataset integrati su affidamenti, fornitori, incarichi, consulenze, personale, spese operative, trasparenza, benchmark, contesto demografico ISTAT A misura di Comune, sedi scolastiche statali MIM e avvisi TED con committenti in Italia.`,
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

export const registeredDatasetCatalog: DatasetDescriptor[] = datasetDescriptors.map((dataset) => {
  const { customSources, ...descriptor } = dataset;
  return {
    ...descriptor,
    integration: dataset.integration ?? "active",
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

/** Only promoted datasets are advertised by the public MCP server. */
export const datasetCatalog = registeredDatasetCatalog.filter(
  (dataset) => dataset.integration === "active",
);
export const ACTIVE_DATASET_IDS = datasetCatalog.map(
  (dataset) => dataset.id,
) as [DatasetId, ...DatasetId[]];

const businessDatasetIdSet = new Set<string>(BUSINESS_DATASET_IDS);

export const businessDatasetCatalog = datasetCatalog.filter((dataset) =>
  businessDatasetIdSet.has(dataset.id),
);

const educationDatasetIdSet = new Set<string>(EDUCATION_DATASET_IDS);

export const educationDatasetCatalog = datasetCatalog.filter((dataset) =>
  educationDatasetIdSet.has(dataset.id),
);
