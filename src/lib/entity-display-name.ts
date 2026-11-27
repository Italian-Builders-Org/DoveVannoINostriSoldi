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

function casePart(part: string, previous: string | null, isFirst: boolean, acronyms: ReadonlySet<string>): string {
  const bare = part.replace(/[^\p{L}\p{N}.']/gu, "");
  const lower = bare.toLocaleLowerCase("it-IT");
  if (ACRONYMS.has(bare) || acronyms.has(bare.replace(/\.+$/, "")) || ROMAN.test(bare) || /^(?:\p{Lu}\.){2,}$/u.test(bare)) return part;
  if (/^\p{Lu}+\d+$/u.test(bare)) return part; // health-district codes: CN1, TO4
  // Two-letter province codes after "Locale"/"ASL": NO di Novara, ASL AT.
  // "AL" doubles as the article "al", so only true prepositions are excluded.
  if (/^\p{Lu}{2}$/u.test(bare) && !DISTRICT_EXCLUDED.has(lower) && (previous === "locale" || previous === "asl")) return part;

  const elided = /^(\p{L}+)'(\p{L}.*)$/u.exec(part);
  if (elided) {
    const prefix = elided[1].toLocaleLowerCase("it-IT");
    if (ELISIONS.has(prefix)) {
      const head = prefix === "l" || prefix === "un" || isFirst ? capitalise(prefix) : prefix;
      // DELL'UNIVERSITA': the noun after the elision can end in an accent too.
      const tail = /[aeiou]'$/i.test(elided[2]) ? accent(elided[2].slice(0, -1)) : capitalise(elided[2]);
      return `${head}'${tail}`;
    }
    // FORLI'CESENA: an accented vowel written as an apostrophe between two names.
    if (/[aeiou]$/.test(prefix)) return `${accent(elided[1])}-${capitalise(elided[2])}`;
  }
  if (/^\p{L}+'$/u.test(part) && /[aeiou]'$/i.test(part)) return accent(part.slice(0, -1));

  if (!isFirst && CONNECTORS.has(lower) && !(ARTICLES.has(lower) && previous === "di")) return lower;
  return capitalise(part);
}

function titleCase(spaced: string, acronyms: ReadonlySet<string> = new Set()): string {
  let previous: string | null = null;
  return spaced
    .split(" ")
    .map((word, index) => {
      const cased = word
        .split("-")
        .map((part, partIndex) =>
          part ? casePart(part, partIndex === 0 ? previous : null, index === 0 && partIndex === 0, acronyms) : part,
        )
        .join("-");
      previous = word.toLocaleLowerCase("it-IT");
      return cased;
    })
    .join(" ");
}

// IPA spells the ministries in three styles ("dell'istruzione e del merito",
// "della Giustizia", "MIMIT - Ministero ..."). They are re-cased together so
// the list on /enti reads as one register; the acronym prefix appears on a
// single ministry and is dropped.
const MINISTRY = /^(?:\p{Lu}{2,8}\s+-\s+)?(Ministero\s.*)$/u;
// Mixed-case names keep the publisher's spelling, except words whose accent
// was typed as an apostrophe ("Universita'"). Only word endings that are
// always accented in Italian, so a closing quote ("'Banca Etica'") is kept.
const APOSTROPHE_ACCENT = /(\p{L}*(?:it|Citt|citt|Societ|societ|Libert|libert|Facolt|facolt|Propriet|propriet|Solidariet|solidariet|Realt|realt))a'(?=[\s,.;:)]|$)/gu;

export function displayEntityName(raw: string): string {
  const spaced = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (/\p{Ll}/u.test(spaced)) {
    const ministry = MINISTRY.exec(spaced);
    if (ministry) return titleCase(ministry[1].toLocaleUpperCase("it-IT"));
    // Otherwise names already published in mixed case are the publisher's own spelling.
    return spaced.replace(APOSTROPHE_ACCENT, "$1à");
  }
  return titleCase(spaced);
}

// Acronyms in the MEF participation names that title case would turn into
// ordinary words (CAP Holding, SMAT, SET Distribuzione).
const COMPANY_ACRONYMS = new Set(["CAP", "CEV", "SMA", "SMAT", "SET", "BPE", "SII"]);
// One spelling per legal form; applied to the title-cased name, so the
// patterns are case-insensitive. Lookarounds keep words such as "Spazio" or
// "Srls" intact.
const LEGAL_FORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![\p{L}.])Soc\.\s*Cons\.\s*a\s*R\.\s*L\.?(?![\p{L}\p{N}])/giu, "Soc. cons. a r.l."],
  [/(?<![\p{L}.])S\.C\.\s*A\s*R\.\s*L\.?(?![\p{L}\p{N}])/giu, "S.c. a r.l."],
  [/(?<![\p{L}.])S\.C\.P\.A\.?(?![\p{L}\p{N}])/giu, "S.c.p.A."],
  [/(?<![\p{L}.])S\.?P\.?A\.?(?![\p{L}\p{N}])/giu, "S.p.A."],
  [/(?<![\p{L}.])S\.?R\.?L\.?(?![\p{L}\p{N}])/giu, "S.r.l."],
];
// Words that introduce an alternative name ("IN SIGLA SET DISTRIBUZIONE").
const ALIAS_MARKERS = /\s(in alternativa|ovvero|in sigla|siglabile|o in forma abbreviata|o)(?=\s)/giu;

/**
 * Display form of a company name from the MEF participations register:
 * Italian title case with one spelling per legal form ("S.p.A.", "S.r.l.",
 * "Soc. cons. a r.l."). Presentation only: tax code and raw name stay in
 * the data.
 */
export function displayCompanyName(raw: string): string {
  const spaced = raw.replace(/\s+/g, " ").trim();
  if (/\p{Ll}/u.test(spaced)) return spaced;
  // Quoted aliases ('BANCA ETICA') become typographic quotes first, so the
  // closing apostrophe is not read as an accented vowel.
  const quoted = spaced.replace(/(^|\s)'([^']+)'(?=[\s.,;:]|$)/g, "$1\u201c$2\u201d");
  let cased = titleCase(quoted, COMPANY_ACRONYMS);
  for (const [pattern, form] of LEGAL_FORMS) cased = cased.replace(pattern, form);
  return cased.replace(ALIAS_MARKERS, (match) => match.toLocaleLowerCase("it-IT"));
}
