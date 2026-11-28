/**
 * Intentionally small Markdown subset for model text: paragraphs, `###` headings,
 * bullet/numbered lists, pipe tables, **bold**, *emphasis*, `code`, backslash
 * escapes and links. No HTML and no images; a link survives only when
 * `allowLink` accepts its href, otherwise just its label is kept. Kept free of
 * React so the rules can be tested in Node.
 */
export type AssistantInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: AssistantInline[] }
  | { type: "strong"; children: AssistantInline[] }
  | { type: "em"; children: AssistantInline[] };

export type AssistantBlock =
  | { type: "paragraph"; content: AssistantInline[] }
  | { type: "heading"; content: AssistantInline[] }
  | { type: "list"; ordered: boolean; start: number; items: AssistantInline[][] }
  | { type: "table"; head: AssistantInline[][]; rows: AssistantInline[][][] };

export type AssistantMarkdownOptions = {
  /** The text is still arriving: an unfinished `[label](…` at the end shows only its label. */
  streaming?: boolean;
};

const BULLET = /^\s*[-*•] +/u;
const NUMBERED = /^\s*(\d{1,4})[.)] +/u;
const HEADING = /^#{1,4} +/u;
const CONTINUATION = /^(?: {2,}|\t)\S/u;
const ESCAPABLE = new Set("\\`*_[]()#|!-+.>{}~");
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;
/** A link whose closing `)` has not arrived yet: label, optional `]`, optional `(href`. */
const UNFINISHED_LINK = /^\[([^\]\n]*)(?:\](?:\([^\s]*)?)?$/u;

type InlineContext = { allowLink: (href: string) => boolean; streaming: boolean; inLink: boolean; inStrong: boolean; inEm: boolean };

/** `[label](href)` at `start`, with balanced parentheses in href. Returns null when it does not close. */
function matchLink(text: string, start: number): { label: string; href: string; end: number } | null {
  let index = start + 1;
  while (index < text.length && text[index] !== "]") {
    if (text[index] === "\n" || text[index] === "[") return null;
    index += text[index] === "\\" ? 2 : 1;
  }
  if (index >= text.length || index === start + 1 || text[index + 1] !== "(") return null;
  const label = text.slice(start + 1, index);
  let depth = 0;
  for (let cursor = index + 2; cursor < text.length; cursor++) {
    const char = text[cursor];
    if (SPACE.test(char)) return null;
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) return cursor === index + 2 ? null : { label, href: text.slice(index + 2, cursor), end: cursor + 1 };
      depth--;
    }
  }
  return null;
}

/** Index of the delimiter closing a span opened at `from`, or -1. Escapes and code spans are skipped. */
function findClose(text: string, from: number, delimiter: "**" | "*" | "_"): number {
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (char === "\n") return -1;
    if (char === "\\") { index++; continue; }
    if (char === "`") {
      const close = text.indexOf("`", index + 1);
      if (close > index) { index = close; continue; }
    }
    if (!text.startsWith(delimiter, index) || SPACE.test(text[index - 1] ?? " ")) continue;
    if (delimiter === "**") {
      // In `***`, the closing pair is the last two stars so a nested `*em*` keeps its own.
      if (text[index + 2] === "*") continue;
      return index;
    }
    if (delimiter === "*") {
      if (text[index + 1] === "*") { index++; continue; }
      return index;
    }
    if (!WORD.test(text[index + 1] ?? "")) return index;
  }
  return -1;
}

function parseInline(text: string, context: InlineContext): AssistantInline[] {
  const nodes: AssistantInline[] = [];
  let buffer = "";
  const flush = () => { if (buffer) nodes.push({ type: "text", text: buffer }); buffer = ""; };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1] ?? "";
    if (char === "\\" && ESCAPABLE.has(next)) { buffer += next; index += 2; continue; }
    if (char === "`") {
      const close = text.indexOf("`", index + 1);
      if (close > index + 1 && !text.slice(index + 1, close).includes("\n")) {
        flush(); nodes.push({ type: "code", text: text.slice(index + 1, close) }); index = close + 1; continue;
      }
    }
    if (char === "!" && next === "[") {
      // Images are never rendered: the whole construct stays visible as literal text.
      const image = matchLink(text, index + 1);
      if (image) { flush(); nodes.push({ type: "text", text: text.slice(index, image.end) }); index = image.end; continue; }
    }
    if (char === "[" && !context.inLink) {
      const link = matchLink(text, index);
      if (link) {
        flush();
        const children = parseInline(link.label, { ...context, inLink: true });
        if (context.allowLink(link.href)) nodes.push({ type: "link", href: link.href, children });
        else nodes.push(...children);
        index = link.end;
        continue;
      }
      const tail = context.streaming ? UNFINISHED_LINK.exec(text.slice(index)) : null;
      if (tail) { flush(); nodes.push(...parseInline(tail[1], { ...context, inLink: true })); index = text.length; continue; }
    }
    if (char === "*" && next === "*" && !context.inStrong) {
      const opens = text[index + 2] !== undefined && !SPACE.test(text[index + 2]);
      const close = opens ? findClose(text, index + 3, "**") : -1;
      // Streaming: bold whose closing `**` has not arrived yet is shown bold rather than with raw stars.
      const end = close > 0 ? close : context.streaming && !text.includes("\n", index) && (opens || index + 2 === text.length) ? text.length : -1;
      if (end > 0) {
        flush();
        const children = parseInline(text.slice(index + 2, end), { ...context, inStrong: true });
        if (children.length) nodes.push({ type: "strong", children });
        index = close > 0 ? close + 2 : text.length;
        continue;
      }
    }
    const opensEm = (char === "*" && next !== "*") || (char === "_" && !WORD.test(text[index - 1] ?? ""));
    if (opensEm && !context.inEm && next && !SPACE.test(next)) {
      const close = findClose(text, index + 2, char);
      if (close > 0) {
        flush(); nodes.push({ type: "em", children: parseInline(text.slice(index + 1, close), { ...context, inEm: true }) }); index = close + 1; continue;
      }
    }
    buffer += char;
    index++;
  }
  flush();
  return nodes;
}

/** Splits a table row on unescaped pipes; the escapes stay for the inline parser. */
function cells(line: string): string[] {
  const row = line.trim().replace(/^\|/u, "").replace(/(?<!\\)\|$/u, "");
  const result: string[] = [];
  let cell = "";
  for (let index = 0; index < row.length; index++) {
    if (row[index] === "\\" && row[index + 1] === "|") { cell += "\\|"; index++; }
    else if (row[index] === "|") { result.push(cell.trim()); cell = ""; }
    else cell += row[index];
  }
  return [...result, cell.trim()];
}

function isTableStart(lines: string[], index: number): boolean {
  if (!lines[index].includes("|") || index + 1 >= lines.length) return false;
  const head = cells(lines[index]);
  const separator = cells(lines[index + 1]);
  return head.length <= 8 && separator.length === head.length && separator.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

type ListDraft = { type: "listDraft"; ordered: boolean; start: number; raw: string[] };

/** Parses line by line so a label followed by a list or a table renders as two blocks. */
export function parseAssistantMarkdown(text: string, allowLink: (href: string) => boolean, options: AssistantMarkdownOptions = {}): AssistantBlock[] {
  const context: InlineContext = { allowLink, streaming: Boolean(options.streaming), inLink: false, inStrong: false, inEm: false };
  const inline = (value: string) => parseInline(value, context);
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: (AssistantBlock | ListDraft)[] = [];
  let paragraph: string[] = [];
  let list = null as ListDraft | null;
  let blankSinceList = false;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", content: inline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { flushParagraph(); blankSinceList = Boolean(list); continue; }
    if (isTableStart(lines, index)) {
      flushParagraph(); list = null;
      const head = cells(line);
      const rows: string[][] = [];
      for (index += 2; index < lines.length && lines[index].trim() && lines[index].includes("|"); index++) rows.push(cells(lines[index]));
      index--;
      const aligned = (row: string[]) => head.map((_, column) => inline(row[column] ?? ""));
      blocks.push({ type: "table", head: aligned(head), rows: rows.map(aligned) });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered || BULLET.test(line)) {
      const ordered = Boolean(numbered);
      flushParagraph();
      if (list?.ordered !== ordered) {
        list = { type: "listDraft", ordered, start: numbered ? Number(numbered[1]) : 1, raw: [] };
        blocks.push(list);
      }
      list.raw.push(line.replace(ordered ? NUMBERED : BULLET, ""));
      blankSinceList = false;
      continue;
    }
    if (list && !blankSinceList && CONTINUATION.test(line)) { list.raw[list.raw.length - 1] += ` ${line.trim()}`; continue; }
    list = null;
    if (HEADING.test(line)) { flushParagraph(); blocks.push({ type: "heading", content: inline(line.replace(HEADING, "")) }); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks.map((block) => block.type === "listDraft" ? { type: "list", ordered: block.ordered, start: block.start, items: block.raw.map(inline) } : block);
}

/** Hrefs that became links, in reading order, without duplicates. */
export function linkHrefs(blocks: AssistantBlock[]): Set<string> {
  const hrefs = new Set<string>();
  const visit = (nodes: AssistantInline[]) => {
    for (const node of nodes) {
      if (node.type === "link") hrefs.add(node.href);
      if ("children" in node) visit(node.children);
    }
  };
  for (const block of blocks) {
    if (block.type === "list") block.items.forEach(visit);
    else if (block.type === "table") [block.head, ...block.rows].forEach((row) => row.forEach(visit));
    else visit(block.content);
  }
  return hrefs;
}

/** Markdown text with every link reduced to its label (images and escapes untouched), for the clipboard. */
const FIGURE_UNIT = /(\d)[ \t]+(?=(?:mld|mln|miliard[io]|milion[ei]|mila|€|euro|%)(?![\p{L}\d]))/gu;
/** "3,21 miliardi" never splits across lines: a key figure read without its unit changes meaning. */
export function keepFiguresWithUnits(text: string): string {
  return text.replace(FIGURE_UNIT, "$1\u00a0");
}

export function plainLinks(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\") { result += text.slice(index, index + 2); index++; continue; }
    if (text[index] === "`") {
      const close = text.indexOf("`", index + 1);
      const newline = text.indexOf("\n", index + 1);
      if (close !== -1 && (newline === -1 || close < newline)) { result += text.slice(index, close + 1); index = close; continue; }
    }
    if (text[index] === "[" && text[index - 1] !== "!") {
      const link = matchLink(text, index);
      if (link) { result += link.label; index = link.end - 1; continue; }
    }
    result += text[index];
  }
  return result;
}
