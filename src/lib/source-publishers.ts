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
