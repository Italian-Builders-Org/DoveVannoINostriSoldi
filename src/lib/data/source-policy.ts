export type SourceId =
  | "ipa"
  | "ipa-struttura"
  | "openbdap"
  | "anac"
  | "siope"
  | "opencoesione"
  | "opencivitas"
  | "consulenti"
  | "camera"
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
      "I pagamenti dello Stato sono rilasciati per mese contabile. Il dataset MOP espone una propria data di aggiornamento e viene ricontrollato insieme allo schema.",
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
