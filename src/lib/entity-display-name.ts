// Display form of the capitalised entity names published by SIOPE/IPA.
// Presentation only: links, search and data keep the raw registry value.

const CONNECTORS = new Set([
  "di", "del", "della", "dello", "dei", "degli", "delle",
  "da", "dal", "dalla", "dai", "e", "ed", "per", "in", "nel", "nella",
  "sul", "sulla", "con", "tra", "fra", "a", "al", "alla",
  "il", "lo", "la", "i", "gli", "le",
]);
const ARTICLES = new Set(["il", "lo", "la", "i", "gli", "le"]);
const ELISIONS = new Set(["l", "d", "dell", "dall", "nell", "sull", "all", "coll", "un", "quell"]);
// Acronyms of health and local authorities that read wrong in title case.
const ACRONYMS = new Set([
  "ASL", "ASP", "ASM", "AUSL", "USL", "ULSS", "ATS", "ASST", "ASREM", "ARES",
  "IRCCS", "AO", "AOU", "ASUR", "AST", "ASUFC", "ASUGI", "ASFO", "SPA",
]);
const DISTRICT_EXCLUDED = new Set(["di", "da", "de", "ed", "in"]);
const ROMAN = /^(?:II|III|IV|VI|VII|VIII|IX|XI|XII|XIII|XIV|XV|XX)$/;
const ACCENTS: Readonly<Record<string, string>> = { a: "à", e: "è", i: "ì", o: "ò", u: "ù" };

function capitalise(word: string): string {
  const lower = word.toLocaleLowerCase("it-IT");
  const index = lower.search(/\p{L}/u);
  if (index < 0) return lower;
  return lower.slice(0, index) + lower.charAt(index).toLocaleUpperCase("it-IT") + lower.slice(index + 1);
}

function accent(word: string): string {
  const lower = word.toLocaleLowerCase("it-IT");
  return capitalise(lower.slice(0, -1) + (ACCENTS[lower.slice(-1)] ?? lower.slice(-1)));
}

function casePart(part: string, previous: string | null, isFirst: boolean): string {
  const bare = part.replace(/[^\p{L}\p{N}.']/gu, "");
  const lower = bare.toLocaleLowerCase("it-IT");
  if (ACRONYMS.has(bare) || ROMAN.test(bare) || /^(?:\p{Lu}\.){2,}$/u.test(bare)) return part;
  if (/^\p{Lu}+\d+$/u.test(bare)) return part; // health-district codes: CN1, TO4
  // Two-letter province codes after "Locale"/"ASL": NO di Novara, ASL AT.
  // "AL" doubles as the article "al", so only true prepositions are excluded.
  if (/^\p{Lu}{2}$/u.test(bare) && !DISTRICT_EXCLUDED.has(lower) && (previous === "locale" || previous === "asl")) return part;

  const elided = /^(\p{L}+)'(\p{L}.*)$/u.exec(part);
  if (elided) {
    const prefix = elided[1].toLocaleLowerCase("it-IT");
    if (ELISIONS.has(prefix)) {
      const head = prefix === "l" || prefix === "un" || isFirst ? capitalise(prefix) : prefix;
      return `${head}'${capitalise(elided[2])}`;
    }
    // FORLI'CESENA: an accented vowel written as an apostrophe between two names.
    if (/[aeiou]$/.test(prefix)) return `${accent(elided[1])}-${capitalise(elided[2])}`;
  }
  if (/^\p{L}+'$/u.test(part) && /[aeiou]'$/i.test(part)) return accent(part.slice(0, -1));

  if (!isFirst && CONNECTORS.has(lower) && !(ARTICLES.has(lower) && previous === "di")) return lower;
  return capitalise(part);
}

export function displayEntityName(raw: string): string {
  const spaced = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  // Names already published in mixed case are the publisher's own spelling.
  if (/\p{Ll}/u.test(spaced)) return spaced;
  let previous: string | null = null;
  return spaced
    .split(" ")
    .map((word, index) => {
      const cased = word
        .split("-")
        .map((part, partIndex) => (part ? casePart(part, partIndex === 0 ? previous : null, index === 0 && partIndex === 0) : part))
        .join("-");
      previous = word.toLocaleLowerCase("it-IT");
      return cased;
    })
    .join(" ");
}
