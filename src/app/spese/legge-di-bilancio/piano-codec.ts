/**
 * Codifica del piano di riallocazione nella query string, per condividere lo
 * scenario con un link. Le missioni sono referenziate per uno slug stabile
 * derivato dal nome, non dalla posizione in un elenco ordinato: un vecchio
 * link continua a puntare alla missione giusta anche se il catalogo cambia
 * (nuove missioni, riordinamenti). Il formato porta un prefisso di versione
 * così una futura revisione del codec può riconoscere ed escludere i link
 * nel formato precedente invece di interpretarli in modo scorretto.
 */

const SLIDER_LIMIT = 50;
const FORMAT_VERSION = "v1";
const SLUG_MAX_LENGTH = 40;
/** Più delle missioni realmente pubblicate (circa 34): margine per una
 * futura crescita della tassonomia senza dover cambiare questo limite. */
const MAX_PLAN_ENTRIES = 40;
const MAX_ENCODED_LENGTH = 2_000;

const ENTRY_PATTERN = /^([a-z0-9-]{1,40}):(-?\d{1,3})$/;

function slugify(mission: string): string {
  const normalized = mission
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, SLUG_MAX_LENGTH);
}

/**
 * Mantiene solo le missioni il cui slug è univoco nell'elenco: due nomi che
 * collidessero (dopo normalizzazione/troncamento) resterebbero entrambi privi
 * di uno slug condivisibile invece di puntare a un dato ambiguo.
 */
function buildSlugIndex(missions: readonly string[]): {
  slugToMission: Map<string, string>;
  missionToSlug: Map<string, string>;
} {
  const bySlug = new Map<string, string[]>();
  for (const mission of missions) {
    const slug = slugify(mission);
    if (!slug) continue;
    const existing = bySlug.get(slug);
    if (existing) existing.push(mission);
    else bySlug.set(slug, [mission]);
  }

  const slugToMission = new Map<string, string>();
  const missionToSlug = new Map<string, string>();
  for (const [slug, candidates] of bySlug) {
    if (candidates.length !== 1) continue;
    slugToMission.set(slug, candidates[0]);
    missionToSlug.set(candidates[0], slug);
  }
  return { slugToMission, missionToSlug };
}

export function orderedMissionList(missions: readonly string[]): string[] {
  return [...missions].sort((left, right) => left.localeCompare(right, "it"));
}

export function encodePiano(
  scenario: Record<string, number>,
  missions: readonly string[],
): string {
  const { missionToSlug } = buildSlugIndex(missions);
  const parts = Object.entries(scenario)
    .map(([mission, pct]) => {
      const slug = missionToSlug.get(mission);
      return !slug || pct === 0 ? null : `${slug}:${pct}`;
    })
    .filter((part): part is string => part !== null)
    .sort()
    .slice(0, MAX_PLAN_ENTRIES);
  return parts.length === 0 ? "" : `${FORMAT_VERSION}:${parts.join(",")}`;
}

export function decodePiano(
  raw: string | string[] | undefined,
  missions: readonly string[],
): Record<string, number> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length > MAX_ENCODED_LENGTH) return {};

  const prefix = `${FORMAT_VERSION}:`;
  if (!value.startsWith(prefix)) return {};

  const { slugToMission } = buildSlugIndex(missions);
  const scenario: Record<string, number> = {};
  const entries = value.slice(prefix.length).split(",").slice(0, MAX_PLAN_ENTRIES);
  for (const entry of entries) {
    const match = ENTRY_PATTERN.exec(entry);
    if (!match) continue;
    const [, slug, rawPct] = match;
    const mission = slugToMission.get(slug);
    const pct = Number(rawPct);
    if (!mission || pct === 0) continue;
    scenario[mission] = Math.max(-SLIDER_LIMIT, Math.min(SLIDER_LIMIT, Math.round(pct)));
  }
  return scenario;
}
