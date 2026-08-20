export type SourceId =
  | "ipa"
  | "ipa-struttura"
  | "openbdap"
  | "siope"
  | "anac-bdncp"
  | "art-4-bis"
  | "opencoesione"
  | "regis"
  | "consulenti"
  | "camera"
  | "senato"
  | "istat-s13"
  | "partecipazioni-pubbliche"
  | "partecipazioni-stato"
  | "anac-in-house-storico"
  | "anac-ausa";

export type SourceCadence =
  | "giornaliera"
  | "settimanale"
  | "mensile"
  | "bimestrale"
  | "annuale"
  | "periodica"
  | "per-amministrazione"
  | "su-pubblicazione";

export type SourcePolicy = {
  id: SourceId;
  label: string;
  owner: string;
  sourceUrl: string;
  cadence: SourceCadence;
  cadenceNote: string;
  discoveryRevalidateSeconds: number;
  dataRevalidateSeconds: number;
  staleAfterSeconds: number | null;
  timeoutMs: number;
  maxRetries: number;
  tags: readonly string[];
};

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Operational freshness policies for DoveVannoINostriSoldi.
 *
 * `cadence` describes the publication cadence declared by the source when it
 * is known. Revalidation is intentionally more frequent than publication: it
 * lets us notice a new official release shortly after it appears without
 * pretending the underlying dataset itself is real-time.
 *
 * `staleAfterSeconds` is null when the publisher does not promise a stable
 * cadence. In that case we expose the source timestamp without assigning a
 * misleading "stale" judgement.
 */
export const SOURCE_POLICIES: Readonly<Record<SourceId, SourcePolicy>> = {
  ipa: {
    id: "ipa",
    label: "Indice PA",
    owner: "AgID",
    sourceUrl: "https://www.indicepa.gov.it/ipa-dati/dataset/enti",
    cadence: "giornaliera",
    cadenceNote: "Il dataset Enti IPA dichiara aggiornamento giornaliero.",
    discoveryRevalidateSeconds: HOUR,
    dataRevalidateSeconds: HOUR,
    staleAfterSeconds: 2 * DAY,
    timeoutMs: 9_000,
    maxRetries: 1,
    tags: ["source:ipa", "domain:entities"],
  },
  "ipa-struttura": {
    id: "ipa-struttura",
    label: "IPA · UO e AOO",
    owner: "AgID",
    sourceUrl: "https://www.indicepa.gov.it/ipa-dati/dataset/unita-organizzative",
    cadence: "giornaliera",
    cadenceNote: "I dataset UO e AOO IPA dichiarano aggiornamento giornaliero.",
    discoveryRevalidateSeconds: HOUR,
    dataRevalidateSeconds: HOUR,
    staleAfterSeconds: 2 * DAY,
    timeoutMs: 9_000,
    maxRetries: 1,
    tags: ["source:ipa-struttura", "domain:organization-structure"],
  },
  openbdap: {
    id: "openbdap",
    label: "OpenBDAP",
    owner: "Ragioneria Generale dello Stato",
    sourceUrl: "https://bdap-opendata.rgs.mef.gov.it/",
    cadence: "mensile",
    cadenceNote:
      "Le viste dei Pagamenti del Bilancio dello Stato usate oggi dalla piattaforma sono rilasciate per mese contabile.",
    discoveryRevalidateSeconds: 2 * HOUR,
    dataRevalidateSeconds: 6 * HOUR,
    staleAfterSeconds: 45 * DAY,
    timeoutMs: 15_000,
    maxRetries: 1,
    tags: ["source:openbdap", "domain:state-spending"],
  },
  siope: {
    id: "siope",
    label: "SIOPE / SIOPE+",
    owner: "RGS · banca dati gestita da Banca d'Italia",
    sourceUrl: "https://www.siope.it/documenti/siope2/open/last/",
    cadence: "periodica",
    cadenceNote:
      "La piattaforma controlla ogni ora i validator dei file open data nazionali e rigenera lo snapshot solo quando la fonte ufficiale cambia.",
    discoveryRevalidateSeconds: HOUR,
    dataRevalidateSeconds: HOUR,
    staleAfterSeconds: null,
    timeoutMs: 15_000,
    maxRetries: 1,
    tags: ["source:siope", "domain:local-spending"],
  },
  "anac-bdncp": {
    id: "anac-bdncp",
    label: "ANAC / BDNCP",
    owner: "ANAC",
    sourceUrl:
      "https://www.anticorruzione.it/-/portale-dei-dati-aperti-dell-autorita-nazionale-anticorruzione",
    cadence: "mensile",
    cadenceNote:
      "I dataset aperti scaricabili del portale ANAC dichiarano aggiornamento mensile; Analytics ha una frequenza distinta.",
    discoveryRevalidateSeconds: 3 * HOUR,
    dataRevalidateSeconds: 12 * HOUR,
    staleAfterSeconds: 45 * DAY,
    timeoutMs: 15_000,
    maxRetries: 1,
    tags: ["source:anac-bdncp", "domain:contracts"],
  },
  "art-4-bis": {
    id: "art-4-bis",
    label: "Pagamenti art. 4-bis",
    owner: "Singole amministrazioni · schema ANAC",
    sourceUrl: "https://guida-servizi.anticorruzione.it/it/help/trasparenza/schemi/art.4-bis/",
    cadence: "per-amministrazione",
    cadenceNote:
      "La frequenza effettiva dipende dalla pubblicazione della singola amministrazione.",
    discoveryRevalidateSeconds: 3 * HOUR,
    dataRevalidateSeconds: 6 * HOUR,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:art-4-bis", "domain:payments"],
  },
  opencoesione: {
    id: "opencoesione",
    label: "OpenCoesione",
    owner: "Dipartimento per le Politiche di Coesione",
    sourceUrl: "https://opencoesione.gov.it/it/opendata/",
    cadence: "bimestrale",
    cadenceNote: "I principali dataset OpenCoesione dichiarano frequenza prevista bimestrale.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: 24 * HOUR,
    staleAfterSeconds: 90 * DAY,
    timeoutMs: 15_000,
    maxRetries: 1,
    tags: ["source:opencoesione", "domain:cohesion"],
  },
  regis: {
    id: "regis",
    label: "ReGiS / PNRR Open Data",
    owner: "MEF",
    sourceUrl: "https://open.gov.it/governo-aperto/piano-nazionale/6nap/azione-3/impegno-6",
    cadence: "periodica",
    cadenceNote: "Le pubblicazioni sono estrazioni periodiche da ReGiS; non assegniamo una soglia stale arbitraria.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: 12 * HOUR,
    staleAfterSeconds: null,
    timeoutMs: 15_000,
    maxRetries: 1,
    tags: ["source:regis", "domain:pnrr"],
  },
  consulenti: {
    id: "consulenti",
    label: "Consulenti Pubblici",
    owner: "Dipartimento della Funzione Pubblica",
    sourceUrl: "https://consulentipubblici.dfp.gov.it/",
    cadence: "per-amministrazione",
    cadenceNote: "L'aggiornamento dipende dalle comunicazioni delle singole amministrazioni.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: 6 * HOUR,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:consulenti", "domain:appointments"],
  },
  camera: {
    id: "camera",
    label: "Camera Trasparente",
    owner: "Camera dei deputati",
    sourceUrl: "https://trasparenza.camera.it/",
    cadence: "su-pubblicazione",
    cadenceNote: "Documenti e dati seguono la pubblicazione istituzionale.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: 12 * HOUR,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:camera", "domain:parliament"],
  },
  senato: {
    id: "senato",
    label: "Senato · Spese e trasparenza",
    owner: "Senato della Repubblica",
    sourceUrl: "https://www.senato.it/relazioni-con-i-cittadini/spese-trasparenza/spese-e-trasparenza",
    cadence: "su-pubblicazione",
    cadenceNote: "Documenti e dati seguono la pubblicazione istituzionale.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: 12 * HOUR,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:senato", "domain:parliament"],
  },
  "istat-s13": {
    id: "istat-s13",
    label: "Classificazione ISTAT S13",
    owner: "ISTAT · OpenBDAP/RGS",
    sourceUrl: "https://bdap-opendata.rgs.mef.gov.it/content/anagrafica-enti-classificazione-istat-s13",
    cadence: "annuale",
    cadenceNote: "Fonte censita; nessun adapter anagrafico machine-readable attivo.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:istat-s13", "domain:entities"],
  },
  "partecipazioni-pubbliche": {
    id: "partecipazioni-pubbliche",
    label: "Censimento partecipazioni pubbliche",
    owner: "MEF · Dipartimento dell'Economia",
    sourceUrl: "https://www.de.mef.gov.it/it/attivita_istituzionali/partecipazioni_pubbliche/open_data_partecipazioni/index.html",
    cadence: "annuale",
    cadenceNote: "Rilevazione annuale con ritardo di pubblicazione variabile; discovery giornaliera.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 60_000,
    maxRetries: 1,
    tags: ["source:partecipazioni-pubbliche", "domain:public-holdings"],
  },
  "partecipazioni-stato": {
    id: "partecipazioni-stato",
    label: "Partecipazioni dirette dello Stato",
    owner: "MEF · Dipartimento dell'Economia",
    sourceUrl: "https://www.de.mef.gov.it/it/attivita_istituzionali/partecipazioni/elenco_partecipazioni/",
    cadence: "su-pubblicazione",
    cadenceNote: "Elenco istituzionale corrente senza una cadenza di rilascio garantita.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:partecipazioni-stato", "domain:public-holdings"],
  },
  "anac-in-house-storico": {
    id: "anac-in-house-storico",
    label: "Elenco ANAC in-house · storico",
    owner: "ANAC",
    sourceUrl: "https://www.anticorruzione.it/-/adempimenti-art.-192-del-d.lgs.-n.-50/2016",
    cadence: "su-pubblicazione",
    cadenceNote: "Archivio storico: l'elenco non è più operativo dal 1° luglio 2023.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:anac-in-house-storico", "domain:public-holdings"],
  },
  "anac-ausa": {
    id: "anac-ausa",
    label: "AUSA · Stazioni appaltanti",
    owner: "ANAC",
    sourceUrl: "https://www.anticorruzione.it/-/anagrafe-unica-delle-stazioni-appaltanti-ausa-",
    cadence: "annuale",
    cadenceNote: "Identificativi aggiornati almeno annualmente; AUSA non certifica lo status in-house.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:anac-ausa", "domain:contracting-authorities"],
  },
};

export const SOURCE_IDS = Object.freeze(Object.keys(SOURCE_POLICIES) as SourceId[]);

export function getSourcePolicy(sourceId: SourceId): SourcePolicy {
  return SOURCE_POLICIES[sourceId];
}
