import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";

export const CANONICAL_REGION_NAMES = Object.freeze(
  Object.values(REGION_NAME_BY_ISTAT_CODE),
);

/** Lowercase aliases used in natural-language prompts and MCP filters. */
export const REGION_PROMPT_ALIASES = Object.freeze(
  new Map<string, string>([
    ["abruzzo", "Abruzzo"],
    ["basilicata", "Basilicata"],
    ["calabria", "Calabria"],
    ["campania", "Campania"],
    ["emilia romagna", "Emilia-Romagna"],
    ["friuli venezia giulia", "Friuli-Venezia Giulia"],
    ["lazio", "Lazio"],
    ["liguria", "Liguria"],
    ["lombardia", "Lombardia"],
    ["marche", "Marche"],
    ["molise", "Molise"],
    ["piemonte", "Piemonte"],
    ["puglia", "Puglia"],
    ["sardegna", "Sardegna"],
    ["sicilia", "Sicilia"],
    ["toscana", "Toscana"],
    ["trentino alto adige", "Trentino-Alto Adige/Südtirol"],
    ["umbria", "Umbria"],
    ["valle d aosta", "Valle d'Aosta/Vallée d'Aoste"],
    ["veneto", "Veneto"],
  ]),
);

const REGION_BY_COMPARISON_KEY = buildRegionLookup();

function buildRegionLookup(): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const name of CANONICAL_REGION_NAMES) {
    lookup.set(regionComparisonKey(name), name);
  }
  for (const [alias, canonical] of REGION_PROMPT_ALIASES) {
    lookup.set(regionComparisonKey(alias), canonical);
  }
  for (const [code, name] of Object.entries(REGION_NAME_BY_ISTAT_CODE)) {
    lookup.set(code, name);
  }
  return lookup;
}

/** Collapses spaces and hyphens so "Emilia Romagna" and "Emilia-Romagna" match. */
export function regionComparisonKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[‘’`´']/g, " ")
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveCanonicalRegionName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}$/.test(trimmed)) {
    const padded = trimmed.padStart(2, "0");
    const byCode = REGION_NAME_BY_ISTAT_CODE[padded as keyof typeof REGION_NAME_BY_ISTAT_CODE];
    if (byCode) return byCode;
  }
  return REGION_BY_COMPARISON_KEY.get(regionComparisonKey(trimmed)) ?? null;
}

export function formatRegionNotFoundError(value: string): string {
  const trimmed = value.trim();
  const suggestion = resolveCanonicalRegionName(trimmed.replace(/\s+/g, "-"));
  if (suggestion && suggestion !== trimmed) {
    return `Regione non trovata: ${trimmed}. Prova con il nome ufficiale ${suggestion}.`;
  }
  return `Regione non trovata: ${trimmed}. Usa uno dei nomi ufficiali ISTAT, ad esempio Emilia-Romagna.`;
}

export function resolveOpenCivitasRegionName(value: string): string | null {
  const canonical = resolveCanonicalRegionName(value);
  return canonical ? canonical.toLocaleUpperCase("it-IT") : null;
}
