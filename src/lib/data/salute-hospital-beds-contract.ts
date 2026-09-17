import type { IntegratedPublicRow } from "../integrated-source-contract";

export const HOSPITAL_BEDS_DATASET = "salute-posti-letto-2023";
export const HOSPITAL_BEDS_ROWS = 1_019;
export const HOSPITAL_BEDS_HEADERS = [
  "Anno", "Codice Regione", "Descrizione Regione", "Codice disciplina",
  "Descrizione disciplina", "Tipo di Disciplina", "N° Reparti",
  "Posti letto degenza ordinaria", "Posti letto degenza a pagamento",
  "Posti letto Day Hospital", "Posti letto Day Surgery", "Totale posti letto",
] as const;

// Ministry codes identify the place of the hospitals, including the two autonomous provinces.
export const HOSPITAL_BEDS_REGIONS = {
  "010": "Piemonte", "020": "Valle d’Aosta", "030": "Lombardia",
  "041": "P. A. Bolzano", "042": "P. A. Trento", "050": "Veneto",
  "060": "Friuli Venezia Giulia", "070": "Liguria", "080": "Emilia-Romagna",
  "090": "Toscana", "100": "Umbria", "110": "Marche", "120": "Lazio",
  "130": "Abruzzo", "140": "Molise", "150": "Campania", "160": "Puglia",
  "170": "Basilicata", "180": "Calabria", "190": "Sicilia", "200": "Sardegna",
} as const;

export type HospitalBedsRegion = {
  code: string;
  name: string;
  acute: number;
  rehabilitation: number;
  longTerm: number;
  total: number;
};

function count(value: string | null | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("Posti letto: conteggio mancante o non valido.");
  }
  return Number(value);
}

/** Aggregate only disjoint region × discipline rows from the locked 2023 release. */
export function aggregateHospitalBeds(headers: readonly string[], rows: readonly IntegratedPublicRow[]) {
  if (headers.join("\0") !== HOSPITAL_BEDS_HEADERS.join("\0") || rows.length !== HOSPITAL_BEDS_ROWS) {
    throw new Error("Posti letto: schema o copertura divergente.");
  }
  const regions = new Map<string, HospitalBedsRegion>();
  const seen = new Set<string>();
  const disciplines = new Set<string>();
  for (const { cells } of rows) {
    const code = cells["Codice Regione"] ?? "";
    const discipline = cells["Codice disciplina"] ?? "";
    const key = `${code}:${discipline}`;
    if (
      cells.Anno !== "2023" || !Object.hasOwn(HOSPITAL_BEDS_REGIONS, code) ||
      !/^\d{2}$/.test(discipline) || discipline === "31" || seen.has(key) ||
      !cells["Descrizione Regione"]?.trim() || !cells["Descrizione disciplina"]?.trim()
    ) {
      throw new Error("Posti letto: periodo, territorio o disciplina non validi o duplicati.");
    }
    seen.add(key);
    disciplines.add(discipline);
    const type = discipline === "60" ? "LUNGODEGENZA"
      : ["28", "56", "75"].includes(discipline) ? "RIABILITAZIONE" : "ACUTI";
    if (cells["Tipo di Disciplina"] !== type) {
      throw new Error("Posti letto: tipo di disciplina incoerente con il dizionario.");
    }
    count(cells["N° Reparti"]);
    const modes = HOSPITAL_BEDS_HEADERS.slice(7, 11).map((header) => count(cells[header]));
    const total = count(cells["Totale posti letto"]);
    if (modes.reduce((sum, value) => sum + value, 0) !== total) {
      throw new Error("Posti letto: totale non riconciliato con le modalità di degenza.");
    }
    const region = regions.get(code) ?? {
      code, name: HOSPITAL_BEDS_REGIONS[code as keyof typeof HOSPITAL_BEDS_REGIONS],
      acute: 0, rehabilitation: 0, longTerm: 0, total: 0,
    };
    const group = type === "ACUTI" ? "acute" : type === "RIABILITAZIONE" ? "rehabilitation" : "longTerm";
    region[group] += total;
    region.total += total;
    if (!Number.isSafeInteger(region.total)) throw new Error("Posti letto: aggregato fuori limite.");
    regions.set(code, region);
  }
  if (regions.size !== 21 || disciplines.size !== 68) {
    throw new Error("Posti letto: copertura territoriale o delle discipline incompleta.");
  }
  return [...regions.values()].sort((a, b) => a.code.localeCompare(b.code));
}
