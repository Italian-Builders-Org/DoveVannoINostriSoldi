import type { RepublicMap, RepublicMapPerson } from "@/lib/politici-repubblica";

export type GraphSelection =
  | { kind: "overview"; }
  | { kind: "person"; id: string; }
  | { kind: "group"; id: string; }
  | { kind: "institution"; id: string; };
export type AtlasScope = "camera" | "senato" | "governo" | "repubblica" | "grafo";
export type AtlasMode = "mappa" | "elenco";
export type RoleFilter = "tutti" | "governo" | "presidenza" | "capigruppo";
export type AtlasState = {
  scope: AtlasScope;
  selection: GraphSelection;
  mode: AtlasMode;
  query: string;
  family: string | null;
  role: RoleFilter;
};
export type SearchHit = { key: string; label: string; detail: string; selection: GraphSelection; };

export const SCOPES: ReadonlyArray<{ id: AtlasScope; label: string; }> = [
  { id: "camera", label: "Camera" },
  { id: "senato", label: "Senato" },
  { id: "governo", label: "Governo" },
  { id: "repubblica", label: "Repubblica" },
  { id: "grafo", label: "Grafo" },
];
export const ROLES: ReadonlyArray<{ id: RoleFilter; label: string; }> = [
  { id: "tutti", label: "Tutti gli incarichi" },
  { id: "governo", label: "Membri del Governo" },
  { id: "presidenza", label: "Presidenze e uffici" },
  { id: "capigruppo", label: "Capigruppo" },
];

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
  return scope === "repubblica" || scope === "grafo" ? { kind: "overview" } : { kind: "institution", id: scope };
}

export function scopeForSelection(selection: GraphSelection, map: RepublicMap, current: AtlasScope = "camera"): AtlasScope {
  if (selection.kind === "overview") return current === "grafo" ? "grafo" : "repubblica";
  if (selection.kind === "institution") {
    if (selection.id === "camera" || selection.id === "senato" || selection.id === "governo") return selection.id;
    return current === "grafo" ? "grafo" : "repubblica";
  }
  if (selection.kind === "group") {
    return map.groups.find((group) => group.id === selection.id)?.chamberId ?? current;
  }
  const person = map.people.find((candidate) => candidate.id === selection.id);
  if (!person) return current;
  if (current === "grafo" && (person.government || person.roleKind === "capo-stato")) return "grafo";
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
  return {
    invalidSelection,
    state: {
      scope, selection,
      mode: params.get("modo") === "elenco" ? "elenco" : "mappa",
      query: (params.get("q") ?? "").slice(0, 120),
      family: map.partyFamilies.some((item) => item.id === family) ? family : null,
      role: ROLES.find((item) => item.id === params.get("incarico"))?.id ?? "tutti",
    },
  };
}

export function atlasUrl(href: string, state: AtlasState): string {
  const url = new URL(href);
  for (const name of ["person", "deputy", "group", "istituzione", "vista", "modo", "q", "famiglia", "incarico"]) {
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
  return `${url.pathname}${url.search}${url.hash}`;
}

export function belongsToScope(person: RepublicMapPerson, scope: AtlasScope): boolean {
  if (scope === "repubblica" || scope === "grafo") return true;
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
