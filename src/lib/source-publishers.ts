// Groups the public source registry by publisher for /fonti. The registry
// keeps each publisher's full legal name (also served to MCP); the page shows
// one short name per publisher as a group heading instead of repeating it on
// every row.

export type SourcePublisher = { name: string; detail: string | null };

// Spellings of the same institution, matched on the normalised full name.
const ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:istat\b|istituto nazionale di statistica\b)/i, "ISTAT"],
  [/^(?:inps\b|istituto nazionale della previdenza sociale\b)/i, "INPS"],
  [/^eurostat\b/i, "Eurostat"],
  [/^aifa\b/i, "AIFA"],
  [/^presidenza del consiglio dei ministri\b/i, "Presidenza del Consiglio dei ministri"],
];
// Text after the separator that only spells out the acronym, not a department.
const EXPANSIONS = /^(?:istituto nazionale|agenzia italiana del farmaco|commissione europea$)/i;
// Joint publishers: the part after "·" is a co-publisher, not a department.
const JOINT = new Set(["RGS · Banca d'Italia"]);

export function sourcePublisher(owner: string): SourcePublisher {
  const trimmed = owner.trim();
  if (JOINT.has(trimmed)) return { name: trimmed, detail: null };
  const [head, ...rest] = trimmed.split(/\s+[—–·]\s+|,\s+/);
  const base = head.replace(/\s*\((?:commissione europea|istat)\)$/i, "").trim();
  const alias = ALIASES.find(([pattern]) => pattern.test(base))?.[1] ?? base;
  const remainder = rest.join(" · ").trim();
  const detail = remainder && !EXPANSIONS.test(remainder) ? remainder : null;
  return { name: alias, detail };
}

type GroupableSource = { slug: string; name: string; owner: string };

export type PublisherGroup<T extends GroupableSource> = {
  name: string;
  sources: { source: T; title: string; detail: string | null }[];
};

function withoutPublisherPrefix(name: string, publisher: string): string {
  const prefix = new RegExp(`^${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+·\\s+`, "i");
  const stripped = name.replace(prefix, "").trim();
  if (!stripped || stripped === name) return name;
  // "ISTAT · povertà assoluta" becomes "Povertà assoluta"; dataset codes
  // such as "gov_10a_main" keep their published spelling.
  const firstWord = stripped.split(/\s/)[0];
  return /[_\d]/.test(firstWord) ? stripped : stripped.charAt(0).toLocaleUpperCase("it-IT") + stripped.slice(1);
}

export function groupSourcesByPublisher<T extends GroupableSource>(sources: readonly T[]): PublisherGroup<T>[] {
  const groups = new Map<string, PublisherGroup<T>>();
  for (const source of sources) {
    const publisher = sourcePublisher(source.owner);
    const group = groups.get(publisher.name) ?? { name: publisher.name, sources: [] };
    group.sources.push({ source, title: withoutPublisherPrefix(source.name, publisher.name), detail: publisher.detail });
    groups.set(publisher.name, group);
  }
  // Largest publishers first; ties keep registry order (Array.sort is stable).
  return [...groups.values()].sort((left, right) => right.sources.length - left.sources.length);
}

const STOPWORDS = new Set([
  "a", "ad", "al", "alla", "alle", "allo", "ai", "agli", "con", "da", "dal", "dalla", "dai", "de", "del",
  "dell", "della", "delle", "dello", "dei", "degli", "di", "e", "ed", "fra", "gli", "i", "il", "in", "l",
  "la", "le", "lo", "nel", "nella", "nei", "o", "per", "su", "sul", "sulla", "sui", "tra", "un", "una", "uno",
]);

// Lower-cased, accent-free word stems (first five letters), so "funzione" and
// "funzioni" match; "Amministrazioni pubbliche", "spesa pubblica" and "PA"
// name the same subject.
function stems(text: string): Set<string> {
  const normalised = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/\b(?:amministrazion[ei] pubblich[ea]|pubblic[ah] amministrazion[ei])\b/g, "pa")
    .replace(/\bpubblic[aoeih]+\b/g, "pa");
  return new Set(
    normalised
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word && !STOPWORDS.has(word))
      .map((word) => word.slice(0, 5)),
  );
}

/**
 * True when the subtitle mostly restates the title: at least three quarters
 * of its significant words already appear in the title. Used to hide a
 * subtitle that adds nothing, never to change a title.
 */
export function subtitleRepeatsTitle(title: string, subtitle: string): boolean {
  const subtitleStems = stems(subtitle);
  if (subtitleStems.size === 0) return false;
  const titleStems = stems(title);
  let shared = 0;
  for (const stem of subtitleStems) if (titleStems.has(stem)) shared += 1;
  return shared / subtitleStems.size >= 0.75;
}

type ClusterableEntry = { source: { slug: string; area: string }; title: string; detail: string | null };

export type PublisherItem<E extends ClusterableEntry> =
  | { kind: "source"; entry: E }
  | { kind: "cluster"; label: string; entries: E[] };

// Smallest run of sources sharing one theme that is shown as a sub-group.
const MIN_CLUSTER = 3;

// "BES dei territori, Salute" and "BES dei territori, Lavoro" share the
// prefix "BES dei territori, "; inside the sub-group only the rest is shown.
function commonLabelPrefix(titles: readonly string[]): string {
  if (titles.length < 2) return "";
  let prefix = titles[0];
  for (const title of titles.slice(1)) {
    while (prefix && !title.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const boundary = Math.max(prefix.lastIndexOf(", "), prefix.lastIndexOf(" · "));
  return boundary > 0 ? prefix.slice(0, boundary + (prefix[boundary] === "," ? 2 : 3)) : "";
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
}

/**
 * Within one publisher, sources that share a theme (`area`) at least three
 * times become one sub-group headed by that theme. Sources without a
 * sub-group come first, in registry order, and the sub-groups close the
 * publisher: a plain row after a sub-group read as one of its members.
 * Every source still appears exactly once; titles lose only a prefix common
 * to the whole sub-group.
 */
export function clusterPublisherSources<E extends ClusterableEntry>(entries: readonly E[]): PublisherItem<E>[] {
  const byArea = new Map<string, E[]>();
  for (const entry of entries) {
    const members = byArea.get(entry.source.area) ?? [];
    members.push(entry);
    byArea.set(entry.source.area, members);
  }
  const items: PublisherItem<E>[] = [];
  const clusters: PublisherItem<E>[] = [];
  const emitted = new Set<string>();
  for (const entry of entries) {
    const members = byArea.get(entry.source.area) ?? [entry];
    if (members.length < MIN_CLUSTER) {
      items.push({ kind: "source", entry });
      continue;
    }
    if (emitted.has(entry.source.area)) continue;
    emitted.add(entry.source.area);
    const prefix = commonLabelPrefix(members.map((member) => member.title));
    clusters.push({
      kind: "cluster",
      label: entry.source.area,
      entries: members.map((member) => ({
        ...member,
        title: prefix ? capitalise(member.title.slice(prefix.length).trim()) : member.title,
      })),
    });
  }
  return [...items, ...clusters];
}

/** Fragment id for a publisher heading on /fonti. */
export function publisherAnchor(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `editore-${slug}`;
}

/**
 * Display form of registry text: an unspaced range dash ("2014–2024")
 * becomes a plain hyphen, as elsewhere on the site. A spaced dash between
 * clauses is punctuation, not a range, and is left alone.
 */
export function plainRangeLabel(label: string): string {
  return label.replace(/(\S)[–—](?=\S)/g, "$1-");
}

/**
 * Display form of a source description next to its "Periodo coperto" cell:
 * a year range that is its own clause (", 2014-2024;") and equals the
 * covered period is dropped, so the years are not read twice in one row.
 * The registry text, also served to MCP, is unchanged.
 */
export function coverageWithoutPeriod(coverage: string, period: string | null): string {
  const plain = plainRangeLabel(coverage);
  if (!period || !/^\d{4}-\d{4}$/.test(period)) return plain;
  const range = period.replace("-", "[-–—]");
  const stripped = plain.replace(new RegExp(`,\\s*${range}(?=[;:.]|$)`), "");
  return stripped.trim() ? stripped : plain;
}

/**
 * The cadence shared by every source of a theme sub-group, shown once in the
 * sub-group heading instead of on each row; null when the rows differ or the
 * group is too small to be a sub-group.
 */
export function sharedCadence(entries: readonly { source: { cadence: string } }[]): string | null {
  if (entries.length < 2) return null;
  const [first, ...rest] = entries.map((entry) => entry.source.cadence);
  return rest.every((cadence) => cadence === first) ? first : null;
}

// A clamped description must hide at least this much text; a shorter rest is
// shown whole, since a toggle that reveals three words costs more than it saves.
const MIN_HIDDEN_CHARACTERS = 40;

/**
 * Preview of a long description for /fonti: the text up to the last word
 * boundary within `limit` characters, without trailing punctuation, then an
 * ellipsis ("persone." becomes "persone…", never ".…"). Null when the text is
 * short enough, or the hidden rest under MIN_HIDDEN_CHARACTERS, to show whole.
 */
export function coveragePreview(text: string, limit: number): string | null {
  const full = text.trim();
  if (full.length - limit < MIN_HIDDEN_CHARACTERS) return null;
  const boundary = full.lastIndexOf(" ", limit);
  const cut = boundary > 0 ? boundary : limit;
  if (full.slice(cut).trim().length < MIN_HIDDEN_CHARACTERS) return null;
  const head = full.slice(0, cut).replace(/[\s.,;:·(\-]+$/u, "");
  return head ? `${head}…` : null;
}
