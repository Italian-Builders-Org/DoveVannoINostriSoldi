import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { PNRR_CHILDCARE_SOURCE } from "@/lib/data/pnrr-childcare-source";

export type SourceId =
  | "ipa"
  | "ipa-struttura"
  | "openbdap"
  | "anac"
  | "inps"
  | "cpt"
  | "mef-irpef"
  | "siope"
  | "opencoesione"
  | "italiadomani"
  | "opencivitas"
  | "consulenti"
  | "camera"
  | "senato"
  | "pcm"
  | "partecipazioni-pubbliche";

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
      "I pagamenti dello Stato sono rilasciati per mese contabile e, a chiusura dell'esercizio, come consuntivo annuale. Il dataset MOP espone una propria data di aggiornamento e viene ricontrollato insieme allo schema.",
    discoveryRevalidateSeconds: 2 * HOUR,
    dataRevalidateSeconds: 6 * HOUR,
    staleAfterSeconds: 45 * DAY,
    timeoutMs: 15_000,
    maxRetries: 1,
    tags: ["source:openbdap", "domain:state-spending"],
  },
  anac: {
    id: "anac",
    label: "BDNCP / dati aperti ANAC",
    owner: "Autorità Nazionale Anticorruzione",
    sourceUrl: "https://dati.anticorruzione.it/opendata/dataset",
    cadence: "mensile",
    cadenceNote:
      "Gli open data BDNCP sono aggiornati con rilasci mensili e file delta; Analytics dichiara aggiornamento settimanale e ANAC documenta endpoint API OCDS.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: 45 * DAY,
    timeoutMs: 20_000,
    maxRetries: 1,
    tags: ["source:anac", "domain:public-procurement"],
  },
  inps: {
    id: "inps",
    label: "INPS",
    owner: "Istituto Nazionale della Previdenza Sociale",
    sourceUrl: "https://www.inps.it/it/it/dati-e-bilanci.html",
    cadence: "su-pubblicazione",
    cadenceNote:
      "Rendiconti e analisi statistiche seguono la pubblicazione istituzionale; ogni nuova edizione richiede la riconciliazione del contratto dati.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 20_000,
    maxRetries: 1,
    tags: ["source:inps", "domain:social-benefits"],
  },
  cpt: {
    id: "cpt",
    label: "Conti Pubblici Territoriali",
    owner: "Dipartimento per le Politiche di Coesione e per il Sud",
    sourceUrl: "https://politichecoesione.governo.it/it/politica-di-coesione/misurazione-valutazione-e-trasparenza/la-misurazione-delle-politiche-di-coesione/conti-pubblici-territoriali-cpt/i-dati/catalogo-open-cpt/",
    cadence: "annuale",
    cadenceNote: "Il Sistema CPT pubblica serie consolidate annuali; lo snapshot viene rigenerato solo dopo la validazione congiunta di entrate e spese.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: 540 * DAY,
    timeoutMs: 20_000,
    maxRetries: 1,
    tags: ["source:cpt", "domain:regional-public-finance"],
  },
  "mef-irpef": {
    id: MEF_IRPEF_SOURCE.id,
    label: MEF_IRPEF_SOURCE.label,
    owner: MEF_IRPEF_SOURCE.owner,
    sourceUrl: MEF_IRPEF_SOURCE.sourceUrl,
    ...MEF_IRPEF_SOURCE.policy,
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
  italiadomani: {
    id: PNRR_CHILDCARE_SOURCE.id,
    label: PNRR_CHILDCARE_SOURCE.label,
    owner: PNRR_CHILDCARE_SOURCE.owner,
    sourceUrl: PNRR_CHILDCARE_SOURCE.sourceUrl,
    ...PNRR_CHILDCARE_SOURCE.policy,
  },
  opencivitas: {
    id: "opencivitas",
    label: "OpenCivitas",
    owner: "Sogei",
    sourceUrl: "https://www.opencivitas.it/it/open-data",
    cadence: "periodica",
    cadenceNote:
      "La fonte dichiara frequenza irregolare. Il rilascio 2022 viene verificato ogni giorno; una nuova annualità richiede la convalida del contratto dati.",
    discoveryRevalidateSeconds: DAY,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 60_000,
    maxRetries: 1,
    tags: ["source:opencivitas", "domain:municipal-standard-needs"],
  },
  consulenti: {
    id: "consulenti",
    label: "Consulenti Pubblici",
    owner: "Dipartimento della Funzione Pubblica",
    sourceUrl: "https://consulentipubblici.dfp.gov.it/progetto",
    cadence: "per-amministrazione",
    cadenceNote:
      "L'aggiornamento dipende dalle comunicazioni delle singole amministrazioni; lo snapshot nazionale viene controllato ogni 6 ore.",
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
    cadenceNote: "I documenti contabili seguono la pubblicazione istituzionale; gli importi restano esclusi finché il PDF non è acquisito e verificato.",
    discoveryRevalidateSeconds: 6 * HOUR,
    dataRevalidateSeconds: 12 * HOUR,
    staleAfterSeconds: null,
    timeoutMs: 12_000,
    maxRetries: 1,
    tags: ["source:senato", "domain:parliament"],
  },
  pcm: {
    id: "pcm",
    label: "Bilanci della Presidenza del Consiglio",
    owner: "Presidenza del Consiglio dei ministri",
    sourceUrl: "https://presidenza.governo.it/AmministrazioneTrasparente/Bilanci/BilancioPreventivoConsultivo/index.html",
    cadence: "annuale",
    cadenceNote: "Bilanci e rendiconti seguono l'approvazione e la pubblicazione istituzionale; ogni nuovo workbook richiede una verifica di schema.",
    discoveryRevalidateSeconds: 12 * HOUR,
    dataRevalidateSeconds: DAY,
    staleAfterSeconds: null,
    timeoutMs: 20_000,
    maxRetries: 1,
    tags: ["source:pcm", "domain:presidency-spending"],
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
};

export const SOURCE_IDS = Object.freeze(Object.keys(SOURCE_POLICIES) as SourceId[]);

export function getSourcePolicy(sourceId: SourceId): SourcePolicy {
  return SOURCE_POLICIES[sourceId];
}
