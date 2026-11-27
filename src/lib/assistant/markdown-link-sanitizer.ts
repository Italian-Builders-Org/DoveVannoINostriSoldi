const MAX_PASSES = 4;

/**
 * For each `[` and `(` the index of its matching closer on the same line, or -1.
 * Escapes and inline code spans are skipped, mirroring how the main pass reads them,
 * so every bracket costs O(1) to resolve instead of a rescan of the line.
 */
function matchingClosers(text: string): Int32Array {
  const closers = new Int32Array(text.length).fill(-1);
  const brackets: number[] = [];
  const parens: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") { brackets.length = 0; parens.length = 0; continue; }
    if (char === "\\" && index + 1 < text.length && text[index + 1] !== "\n") { index += 1; continue; }
    if (char === "`") {
      const end = codeSpanEnd(text, index);
      if (end !== -1) { index = end; continue; }
    }
    if (char === "[") brackets.push(index);
    else if (char === "(") parens.push(index);
    else if (char === "]" && brackets.length) closers[brackets.pop()!] = index;
    else if (char === ")" && parens.length) closers[parens.pop()!] = index;
  }
  return closers;
}

function codeSpanEnd(text: string, start: number): number {
  const close = text.indexOf("`", start + 1);
  const newline = text.indexOf("\n", start + 1);
  return close !== -1 && (newline === -1 || close < newline) ? close : -1;
}

/** One linear pass: keeps `[label](href)` only for allowed hrefs, otherwise the label. Images keep only their alt text. */
function sanitizePass(text: string, allowed: ReadonlySet<string>): string {
  const closers = matchingClosers(text);
  // Pending links whose label is being copied: where the label ends, what to emit there, where to resume.
  const open: { labelEnd: number; suffix: string; resume: number }[] = [];
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const top = open.at(-1);
    if (top && index === top.labelEnd) {
      out += top.suffix;
      index = top.resume;
      open.pop();
      continue;
    }
    const char = text[index];
    if (char === "\\" && index + 1 < text.length && text[index + 1] !== "\n") {
      out += text.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(text, index);
      if (end !== -1) { out += text.slice(index, end + 1); index = end; continue; }
    }
    const image = char === "!" && text[index + 1] === "[";
    if (image || char === "[") {
      const bracket = image ? index + 1 : index;
      const labelEnd = closers[bracket];
      const parenEnd = labelEnd !== -1 && text[labelEnd + 1] === "(" ? closers[labelEnd + 1] : -1;
      // A nested link must end inside its parent's label, or the pending ends would cross.
      if (parenEnd !== -1 && (!top || parenEnd < top.labelEnd)) {
        const href = text.slice(labelEnd + 2, parenEnd).trim();
        const keep = !image && allowed.has(href);
        if (keep) out += "[";
        open.push({ labelEnd, suffix: keep ? `](${href})` : "", resume: parenEnd });
        index = bracket;
        continue;
      }
    }
    out += char;
  }
  return out;
}

/**
 * Model text with every Markdown link reduced to its label unless its href is one
 * of the server-chosen internal pages. Removing a link can join neighbours into new
 * link syntax, so passes repeat until stable; pathological input loses all brackets.
 */
export function sanitizeMarkdownLinks(text: string, allowedHrefs: ReadonlySet<string>): string {
  let current = text;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = sanitizePass(current, allowedHrefs);
    if (next === current) return current;
    current = next;
  }
  // Backslashes too: otherwise an already escaped "\[" would become "\\[", an escaped backslash before a live bracket.
  return sanitizePass(current, new Set()).replace(/[\\[\]]/gu, "\\$&");
}
