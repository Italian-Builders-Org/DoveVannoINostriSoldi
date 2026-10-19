import "server-only";
import raw from "@/data/generated/documenti-declassificati.json";
import {
  parseDocumentiDeclassificatiSnapshot,
  type DocumentoDeclassificato,
  type DocumentiDeclassificatiSnapshot,
} from "@/lib/data/documenti-declassificati-contract";

const snapshot = parseDocumentiDeclassificatiSnapshot(raw);

export function getDocumentiDeclassificati(): DocumentiDeclassificatiSnapshot {
  return snapshot;
}

export function listDocumentiDeclassificati(filters?: {
  theme?: string;
  issuingBody?: string;
  accessStatus?: string;
}): DocumentoDeclassificato[] {
  return snapshot.documents.filter((doc) => {
    if (filters?.theme && doc.theme !== filters.theme) return false;
    if (filters?.issuingBody && doc.issuingBody !== filters.issuingBody) return false;
    if (filters?.accessStatus && doc.accessStatus !== filters.accessStatus) return false;
    return true;
  });
}

export function getDocumentoDeclassificato(id: string): DocumentoDeclassificato | null {
  return snapshot.documents.find((doc) => doc.id === id) ?? null;
}

export const THEME_LABELS: Record<string, string> = {
  moro: "Caso Moro",
  "terrorismo-stragi": "Terrorismo e stragi",
  "declassifica-procedure": "Procedure di declassifica",
};

export const ACCESS_LABELS: Record<string, string> = {
  "public-online": "Consultabile online",
  "spid-required": "Richiesta SPID / accreditamento",
  "on-site-only": "Consultazione in sede",
  "request-required": "Su richiesta",
};

export const BODY_LABELS: Record<string, string> = {
  camera: "Camera",
  senato: "Senato",
  acs: "Archivio Centrale dello Stato",
  stato: "Normativa / Stato",
};

export const READINESS_LABELS: Record<string, string> = {
  "metadata-only": "Solo metadati verificati",
  "summary-curated": "Riassunto e punti chiave curati",
};

export const ACCESS_HELP: Record<string, string> = {
  "public-online":
    "La fonte ufficiale espone il documento (o la scheda) su HTTPS senza autenticazione obbligatoria per la consultazione base.",
  "spid-required":
    "Il portale richiede in genere SPID o accreditamento per aprire i fascicoli; la scheda pubblica resta leggibile senza login.",
  "on-site-only":
    "Il materiale integrale si consulta tipicamente in sala di studio o su appuntamento; online restano elenchi e guide.",
  "request-required":
    "Serve una richiesta formale all'ente detentore; non c'è lettura libera online dell'integrale.",
};

export const CLASSIFICATION_HELP: Record<string, string> = {
  "non-applicabile": "Non era un atto classificato: è un documento pubblico o normativo.",
  riservato: "Primo livello di classifica (l. 124/2007).",
  riservatissimo: "Secondo livello di classifica.",
  segreto: "Terzo livello di classifica.",
  segretissimo: "Livello massimo di classifica.",
  classificato: "Era sotto classifica (livello non sempre dichiarato pezzo per pezzo).",
  "segreto-di-stato-o-classificato": "Segreto di Stato e/o classifica amministrativa (distinti in legge).",
  libero: "Reso disponibile come documento libero (spesso con obliterazioni privacy).",
  pubblico: "Pubblico / consultabile come atto ufficiale.",
  declassificato: "Tolto dalla classifica precedente; non implica da solo la pubblicazione online.",
  "desecretato-o-declassificato": "Desecretato e/o declassificato a seconda del pezzo.",
};

export function formatIsoDateIt(value: string | null | undefined): string {
  if (!value) return "non dichiarata";
  if (/^\d{4}$/u.test(value)) return value;
  if (/^\d{4}-\d{2}$/u.test(value)) {
    const [y, m] = value.split("-");
    return `${m}/${y}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
