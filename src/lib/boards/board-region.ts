/** Opzioni regione per l’inspector boards e normalizzazione verso i filtri MCP. */

export type BoardRegionOption = {
  value: string;
  label: string;
};

/** Nomi usati da OpenCivitas / SIOPE (maiuscolo senza accenti speciali). */
export const BOARD_REGION_NAMES: readonly BoardRegionOption[] = [
  { value: "ABRUZZO", label: "Abruzzo" },
  { value: "BASILICATA", label: "Basilicata" },
  { value: "CALABRIA", label: "Calabria" },
  { value: "CAMPANIA", label: "Campania" },
  { value: "EMILIA-ROMAGNA", label: "Emilia-Romagna" },
  { value: "FRIULI-VENEZIA GIULIA", label: "Friuli-Venezia Giulia" },
  { value: "LAZIO", label: "Lazio" },
  { value: "LIGURIA", label: "Liguria" },
  { value: "LOMBARDIA", label: "Lombardia" },
  { value: "MARCHE", label: "Marche" },
  { value: "MOLISE", label: "Molise" },
  { value: "PIEMONTE", label: "Piemonte" },
  { value: "PUGLIA", label: "Puglia" },
  { value: "SARDEGNA", label: "Sardegna" },
  { value: "SICILIA", label: "Sicilia" },
  { value: "TOSCANA", label: "Toscana" },
  { value: "TRENTINO-ALTO ADIGE", label: "Trentino-Alto Adige" },
  { value: "UMBRIA", label: "Umbria" },
  { value: "VALLE D'AOSTA", label: "Valle d'Aosta" },
  { value: "VENETO", label: "Veneto" },
] as const;

/** Codici ISTAT a tre cifre (AIFA e affini). */
export const BOARD_REGION_ISTAT3: readonly BoardRegionOption[] = [
  { value: "010", label: "Piemonte" },
  { value: "020", label: "Valle d'Aosta" },
  { value: "030", label: "Lombardia" },
  { value: "041", label: "PA Bolzano" },
  { value: "042", label: "PA Trento" },
  { value: "050", label: "Veneto" },
  { value: "060", label: "Friuli-Venezia Giulia" },
  { value: "070", label: "Liguria" },
  { value: "080", label: "Emilia-Romagna" },
  { value: "090", label: "Toscana" },
  { value: "100", label: "Umbria" },
  { value: "110", label: "Marche" },
  { value: "120", label: "Lazio" },
  { value: "130", label: "Abruzzo" },
  { value: "140", label: "Molise" },
  { value: "150", label: "Campania" },
  { value: "160", label: "Puglia" },
  { value: "170", label: "Basilicata" },
  { value: "180", label: "Calabria" },
  { value: "190", label: "Sicilia" },
  { value: "200", label: "Sardegna" },
] as const;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim();
}

const NAME_TO_ISTAT3 = new Map<string, string>();
for (const option of BOARD_REGION_ISTAT3) {
  NAME_TO_ISTAT3.set(fold(option.label), option.value);
}
NAME_TO_ISTAT3.set(fold("VALLE D AOSTA"), "020");
NAME_TO_ISTAT3.set(fold("FRIULI VENEZIA GIULIA"), "060");
NAME_TO_ISTAT3.set(fold("EMILIA ROMAGNA"), "080");
NAME_TO_ISTAT3.set(fold("TRENTINO ALTO ADIGE"), "041");
NAME_TO_ISTAT3.set(fold("PA BOLZANO"), "041");
NAME_TO_ISTAT3.set(fold("PA TRENTO"), "042");
NAME_TO_ISTAT3.set(fold("BOLZANO"), "041");
NAME_TO_ISTAT3.set(fold("TRENTO"), "042");

export function boardRegionOptionsForDataset(datasetId: string): readonly BoardRegionOption[] {
  if (datasetId === "aifa_farmaci_spesa" || datasetId.startsWith("aifa_")) {
    return BOARD_REGION_ISTAT3;
  }
  return BOARD_REGION_NAMES;
}

/**
 * Allinea il filtro `region` al contratto del dataset.
 * - AIFA: codice ISTAT a 3 cifre
 * - OpenCivitas / default: nome regione MAIUSCOLO
 */
export function normalizeBoardRegionFilter(
  datasetId: string,
  region: string | undefined | null,
): string | undefined {
  if (region === undefined || region === null) return undefined;
  const raw = String(region).trim();
  if (!raw) return undefined;

  if (datasetId === "aifa_farmaci_spesa" || datasetId.startsWith("aifa_")) {
    if (/^\d{3}$/u.test(raw)) return raw;
    if (/^\d{2}$/u.test(raw)) return raw.padStart(3, "0");
    return NAME_TO_ISTAT3.get(fold(raw));
  }

  // OpenCivitas e molti adapter accettano il nome in maiuscolo.
  const folded = fold(raw);
  const hit = BOARD_REGION_NAMES.find((option) => fold(option.label) === folded || fold(option.value) === folded);
  if (hit) return hit.value;
  return raw.toUpperCase();
}
