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
