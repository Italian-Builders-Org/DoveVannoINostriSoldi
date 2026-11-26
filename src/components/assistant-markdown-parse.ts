/**
 * Intentionally small Markdown subset for model text: paragraphs, `###` headings,
 * bullet/numbered lists, pipe tables, **bold**, `code` and links. No HTML and no
 * images; a link survives only when `allowLink` accepts its href, otherwise just
 * its label is kept. Kept free of React so the rules can be tested in Node.
 */
export type AssistantInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "strong"; children: AssistantInline[] };

export type AssistantBlock =
  | { type: "paragraph"; content: AssistantInline[] }
  | { type: "heading"; content: AssistantInline[] }
  | { type: "list"; ordered: boolean; start: number; items: AssistantInline[][] }
  | { type: "table"; head: AssistantInline[][]; rows: AssistantInline[][][] };

const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\s]+\))/u;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/u;
const BULLET = /^\s*[-*•] +/u;
const NUMBERED = /^\s*(\d{1,4})[.)] +/u;
const HEADING = /^#{1,4} +/u;

function parseInline(text: string, allowLink: (href: string) => boolean, nested = false): AssistantInline[] {
  return text.split(TOKEN).filter(Boolean).map((part): AssistantInline => {
    if (!nested && part.startsWith("**") && part.endsWith("**") && part.length > 4) return { type: "strong", children: parseInline(part.slice(2, -2), allowLink, true) };
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return { type: "code", text: part.slice(1, -1) };
    const link = LINK.exec(part);
    if (link) return allowLink(link[2]) ? { type: "link", text: link[1], href: link[2] } : { type: "text", text: link[1] };
    return { type: "text", text: part };
  });
}

const cells = (line: string) => line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());

function parseTable(lines: string[], allowLink: (href: string) => boolean): AssistantBlock | null {
  if (lines.length < 2 || !lines[0].includes("|") || !cells(lines[1]).every((cell) => /^:?-{3,}:?$/u.test(cell))) return null;
  const head = cells(lines[0]);
  const body = lines.slice(2).map(cells);
  if (head.length > 8 || body.some((row) => row.length !== head.length)) return null;
  return { type: "table", head: head.map((cell) => parseInline(cell, allowLink)), rows: body.map((row) => row.map((cell) => parseInline(cell, allowLink))) };
}

/** Parses line by line so a label followed by list items renders as a paragraph and a list. */
export function parseAssistantMarkdown(text: string, allowLink: (href: string) => boolean): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  for (const chunk of text.replace(/\r\n?/gu, "\n").split(/\n\s*\n/u)) {
    const lines = chunk.split("\n").filter((line) => line.trim());
    if (!lines.length) continue;
    const table = parseTable(lines, allowLink);
    if (table) { blocks.push(table); continue; }
    let paragraph: string[] = [];
    // Widened on purpose: `flush` resets it inside a closure, which narrowing cannot see.
    let list = null as Extract<AssistantBlock, { type: "list" }> | null;
    const flush = () => {
      if (paragraph.length) blocks.push({ type: "paragraph", content: parseInline(paragraph.join("\n"), allowLink) });
      paragraph = [];
      list = null;
    };
    for (const line of lines) {
      const numbered = NUMBERED.exec(line);
      const ordered = Boolean(numbered);
      if (numbered || BULLET.test(line)) {
        if (paragraph.length || list?.ordered !== ordered) {
          flush();
          list = { type: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
          blocks.push(list);
        }
        list!.items.push(parseInline(line.replace(ordered ? NUMBERED : BULLET, ""), allowLink));
      } else if (HEADING.test(line)) {
        flush();
        blocks.push({ type: "heading", content: parseInline(line.replace(HEADING, ""), allowLink) });
      } else {
        if (list) list = null;
        paragraph.push(line.trim());
      }
    }
    flush();
  }
  return blocks;
}
