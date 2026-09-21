import type { RepublicMap, RepublicMapPerson } from "@/lib/politici-repubblica";

export type GraphSelection =
  | { kind: "overview"; }
  | { kind: "person"; id: string; }
  | { kind: "group"; id: string; }
  | { kind: "institution"; id: string; };
export type AtlasScope = "camera" | "senato" | "governo" | "repubblica" | "grafo" | "condanne" | "storico-voti";
export type AtlasMode = "mappa" | "elenco";
export type RoleFilter = "tutti" | "governo" | "presidenza" | "capigruppo";
export type ThemeChamberFilter = "tutti" | "camera" | "senato";
export type AtlasPanelTab = "profilo" | "atti" | "temi" | "notizie";
export type AtlasState = {
  scope: AtlasScope;
  selection: GraphSelection;
  mode: AtlasMode;
  query: string;
  family: string | null;
  role: RoleFilter;
  /** Tema attivo nella vista Storico voti (e deep-link). */
  themeId: string | null;
  themeChamber: ThemeChamberFilter;
  /** Solo parlamentari con almeno un voto espresso F/C/A sul tema. */
  themeExpressedOnly: boolean;
  /** Tab iniziale della scheda persona (es. da Storico voti). */
  panelTab: AtlasPanelTab | null;
};
export type SearchHit = { key: string; label: string; detail: string; selection: GraphSelection; };

export const SCOPES: ReadonlyArray<{ id: AtlasScope; label: string; }> = [
  { id: "camera", label: "Camera" },
  { id: "senato", label: "Senato" },
  { id: "governo", label: "Governo" },
  { id: "repubblica", label: "Repubblica" },
  { id: "grafo", label: "Grafo" },
  { id: "condanne", label: "Condanne" },
  { id: "storico-voti", label: "Storico voti" },
];
export const ROLES: ReadonlyArray<{ id: RoleFilter; label: string; }> = [
  { id: "tutti", label: "Tutti gli incarichi" },
  { id: "governo", label: "Membri del Governo" },
  { id: "presidenza", label: "Presidenze e uffici" },
  { id: "capigruppo", label: "Capigruppo" },
];
export const THEME_CHAMBERS: ReadonlyArray<{ id: ThemeChamberFilter; label: string; }> = [
  { id: "tutti", label: "Camera e Senato" },
  { id: "camera", label: "Solo Camera" },
  { id: "senato", label: "Solo Senato" },
];
/** Keep in sync with `VOTE_THEMES` ids in politici-voti-tema-catalog. */
export const KNOWN_THEME_IDS = [
  "lavoro",
  "sicurezza",
  "sanita",
  "istruzione",
  "giustizia",
  "parita",
  "ambiente",
  "europa",
] as const;
export const DEFAULT_THEME_ID = "lavoro";

export function resolveThemeId(value: string | null | undefined): string | null {
  if (!value) return null;
  return (KNOWN_THEME_IDS as readonly string[]).includes(value) ? value : null;
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT").replaceAll(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return (words.length > 1 ? [words[0], words.at(-1)] : words)
    .map((word) => Array.from(word ?? "")[0] ?? "").join("").toLocaleUpperCase("it-IT");
}

export function longDate(value: string | null | undefined): string {
  if (!value) return "Data non disponibile";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/u.exec(value);
  if (!match) return "Data non disponibile";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Data non disponibile";
  }
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

export function defaultSelection(scope: AtlasScope): GraphSelection {
  return scope === "repubblica" || scope === "grafo" || scope === "condanne" || scope === "storico-voti"
    ? { kind: "overview" }
    : { kind: "institution", id: scope };
}

export function scopeForSelection(selection: GraphSelection, map: RepublicMap, current: AtlasScope = "camera"): AtlasScope {
  if (selection.kind === "overview") {
    if (current === "grafo") return "grafo";
    if (current === "condanne") return "condanne";
    if (current === "storico-voti") return "storico-voti";
    return "repubblica";
  }
  if (selection.kind === "institution") {
    if (selection.id === "camera" || selection.id === "senato" || selection.id === "governo") return selection.id;
    if (current === "grafo") return "grafo";
    if (current === "condanne") return "condanne";
    if (current === "storico-voti") return "storico-voti";
    return "repubblica";
  }
  if (selection.kind === "group") {
    return map.groups.find((group) => group.id === selection.id)?.chamberId ?? current;
  }
  const person = map.people.find((candidate) => candidate.id === selection.id);
  if (!person) return current;
  if (current === "grafo" && (person.government || person.roleKind === "capo-stato")) return "grafo";
  if (current === "condanne") return "condanne";
  if (current === "storico-voti") return "storico-voti";
  if (person.government && current === "governo") return "governo";
  return person.chamberId ?? (person.government ? "governo" : current === "grafo" ? "grafo" : "repubblica");
}

export function validSelection(selection: GraphSelection, map: RepublicMap): boolean {
  if (selection.kind === "overview") return true;
  if (selection.kind === "person") return map.people.some((person) => person.id === selection.id);
  if (selection.kind === "group") return map.groups.some((group) => group.id === selection.id);
  return map.institutions.some((institution) => institution.id === selection.id);
}

/** The URL is shared by the subdomain and /politici; never rewrite the host or discard unrelated parameters. */
export function readAtlasState(params: URLSearchParams, map: RepublicMap): { state: AtlasState; invalidSelection: boolean; } {
  const requestedScope = params.get("vista");
  let scope: AtlasScope = SCOPES.find((item) => item.id === requestedScope)?.id ?? "camera";
  const person = params.get("person") ?? (params.get("deputy") ? `dep-${params.get("deputy")}` : null);
  const group = params.get("group");
  const institution = params.get("istituzione");
  const requested: GraphSelection = person ? { kind: "person", id: person }
    : group ? { kind: "group", id: group }
      : institution ? { kind: "institution", id: institution } : defaultSelection(scope);
  const invalidSelection = !validSelection(requested, map);
  const selection = invalidSelection ? defaultSelection(scope) : requested;
  scope = scopeForSelection(selection, map, scope);
  const family = params.get("famiglia");
  const themeId = resolveThemeId(params.get("tema"))
    ?? (scope === "storico-voti" ? DEFAULT_THEME_ID : null);
  const ramo = params.get("ramo");
  const themeChamber: ThemeChamberFilter = ramo === "camera" || ramo === "senato" ? ramo : "tutti";
  const scheda = params.get("scheda");
  const panelTab: AtlasPanelTab | null = scheda === "temi" || scheda === "atti" || scheda === "notizie" || scheda === "profilo"
    ? scheda
    : null;
  return {
    invalidSelection,
    state: {
      scope, selection,
      mode: params.get("modo") === "elenco" ? "elenco" : "mappa",
      query: (params.get("q") ?? "").slice(0, 120),
      family: map.partyFamilies.some((item) => item.id === family) ? family : null,
      role: ROLES.find((item) => item.id === params.get("incarico"))?.id ?? "tutti",
      themeId: scope === "storico-voti" ? themeId : resolveThemeId(params.get("tema")),
      themeChamber: scope === "storico-voti" ? themeChamber : "tutti",
      themeExpressedOnly: params.get("espressi") === "0" ? false : true,
      panelTab: selection.kind === "person" ? panelTab : null,
    },
  };
}

export function atlasUrl(href: string, state: AtlasState): string {
  const url = new URL(href);
  for (const name of ["person", "deputy", "group", "istituzione", "vista", "modo", "q", "famiglia", "incarico", "tema", "ramo", "espressi", "scheda"]) {
    url.searchParams.delete(name);
  }
  url.searchParams.set("vista", state.scope);
  if (state.selection.kind === "person") url.searchParams.set("person", state.selection.id);
  if (state.selection.kind === "group") url.searchParams.set("group", state.selection.id);
  if (state.selection.kind === "institution") url.searchParams.set("istituzione", state.selection.id);
  if (state.mode === "elenco") url.searchParams.set("modo", "elenco");
  if (state.query.trim()) url.searchParams.set("q", state.query.trim());
  if (state.family) url.searchParams.set("famiglia", state.family);
  if (state.role !== "tutti") url.searchParams.set("incarico", state.role);
  if (state.scope === "storico-voti") {
    url.searchParams.set("tema", state.themeId ?? DEFAULT_THEME_ID);
    if (state.themeChamber !== "tutti") url.searchParams.set("ramo", state.themeChamber);
    if (!state.themeExpressedOnly) url.searchParams.set("espressi", "0");
  } else if (state.themeId) {
    url.searchParams.set("tema", state.themeId);
  }
  if (state.selection.kind === "person" && state.panelTab && state.panelTab !== "profilo") {
    url.searchParams.set("scheda", state.panelTab);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function belongsToScope(person: RepublicMapPerson, scope: AtlasScope): boolean {
  if (scope === "repubblica" || scope === "grafo" || scope === "condanne" || scope === "storico-voti") return true;
  if (scope === "governo") return person.government;
  return person.chamberId === scope;
}

export function matchesRole(person: RepublicMapPerson, role: RoleFilter): boolean {
  if (role === "tutti") return true;
  if (role === "governo") return person.government;
  if (role === "capigruppo") return person.groupLeader;
  return ["capo-stato", "presidente-assemblea", "vicepresidente-assemblea", "questore", "segretario-presidenza"].includes(person.roleKind);
}

export function filteredPeople(map: RepublicMap, state: AtlasState): RepublicMapPerson[] {
  const groups = new Map(map.groups.map((group) => [group.id, group]));
  const tokens = normalizeSearch(state.query).split(" ").filter(Boolean);
  return map.people.filter((person) => {
    if (!belongsToScope(person, state.scope) || !matchesRole(person, state.role)) return false;
    if (state.family && person.family !== state.family) return false;
    const group = person.groupId ? groups.get(person.groupId) : null;
    const text = normalizeSearch(`${person.name} ${person.roleLabel} ${group?.label ?? ""} ${group?.shortLabel ?? ""}`);
    return tokens.every((token) => text.includes(token));
  }).sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

export function searchAtlas(map: RepublicMap, query: string, limit = 8): SearchHit[] {
  const normalized = normalizeSearch(query);
  if (!normalized || limit <= 0) return [];
  const tokens = normalized.split(" ");
  const groups = new Map(map.groups.map((group) => [group.id, group]));
  const hits: SearchHit[] = [];
  for (const person of map.people) {
    const group = person.groupId ? groups.get(person.groupId) : null;
    if (tokens.every((token) => normalizeSearch(`${person.name} ${person.roleLabel} ${group?.label ?? ""} ${group?.shortLabel ?? ""}`).includes(token))) {
      hits.push({ key: person.id, label: person.name, detail: person.roleLabel, selection: { kind: "person", id: person.id } });
    }
  }
  for (const group of map.groups) {
    if (tokens.every((token) => normalizeSearch(`${group.label} ${group.shortLabel}`).includes(token))) {
      hits.push({ key: `group:${group.id}`, label: group.shortLabel, detail: `${group.chamberId === "camera" ? "Camera" : "Senato"} · ${group.memberCount} componenti`, selection: { kind: "group", id: group.id } });
    }
  }
  return hits.sort((a, b) => Number(normalizeSearch(b.label).startsWith(normalized)) - Number(normalizeSearch(a.label).startsWith(normalized))
    || a.label.localeCompare(b.label, "it") || a.key.localeCompare(b.key)).slice(0, limit);
}

export function selectionPeople(map: RepublicMap, selection: GraphSelection): Set<string> | null {
  if (selection.kind === "overview") return null;
  if (selection.kind === "person") return new Set([selection.id]);
  if (selection.kind === "group") return new Set(map.people.filter((person) => person.groupId === selection.id).map((person) => person.id));
  return new Set(map.people.filter((person) => selection.id === "presidenza-repubblica"
    ? person.roleKind === "capo-stato"
    : belongsToScope(person, selection.id as AtlasScope)).map((person) => person.id));
}
