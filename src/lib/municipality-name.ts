/**
 * SIOPE stores entity names as registry shouting: "COMUNE DI VENEZIA",
 * "ROMA CAPITALE", "S. MARIA CAPUA VETERE". Tables read far better in normal
 * case, so we tidy the presentation without renaming the entity — the "COMUNE
 * DI" prefix is dropped because the column already says these are Comuni, and
 * nothing else is removed.
 */

const lowercaseParticles = new Set([
  "di", "de", "del", "della", "delle", "dei", "degli", "dell", "da", "dal",
  "dalla", "d", "in", "nel", "nella", "nelle", "nell", "su", "sul", "sulla",
  "sull", "e", "a", "al", "alla", "all", "con", "per", "lo", "la", "le", "il",
  "i", "gli",
]);

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase("it-IT") + word.slice(1).toLocaleLowerCase("it-IT");
}

/** Title-cases one token, keeping the parts of hyphenated and elided names. */
function titleCaseToken(token: string, index: number): string {
  const lower = token.toLocaleLowerCase("it-IT");

  if (index > 0 && lowercaseParticles.has(lower.replace(/[.']/g, ""))) {
    return lower;
  }

  // "L'AQUILA" and "SANT'ANGELO" capitalise on both sides of the apostrophe;
  // "CORIGLIANO-ROSSANO" does the same across the hyphen.
  return lower
    .split(/(['’-])/)
    .map((part) => (/['’-]/.test(part) ? part : part ? capitalize(part) : part))
    .join("");
}

export function municipalityName(raw: string): string {
  const withoutPrefix = raw.replace(/^COMUNE\s+DI\s+/i, "").trim();
  const source = withoutPrefix || raw.trim();

  return source
    .split(/\s+/)
    .map((token, index) => titleCaseToken(token, index))
    .join(" ");
}
