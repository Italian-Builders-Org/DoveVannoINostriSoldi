import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("assistant credentials and model output stay out of storage and HTML rendering", async () => {
  const paths = ["assistant-chat.tsx", "assistant-provider-settings.tsx", "assistant-ai-reply.tsx", "assistant-markdown.tsx"];
  const components = await Promise.all(paths.map(path => readFile(new URL(`../src/components/${path}`, import.meta.url), "utf8")));
  assert.doesNotMatch(components.join("\n"), /localStorage|sessionStorage|dangerouslySetInnerHTML|console\.(?:log|error)/);
  assert.match(components[0], /aria-live="polite"/);
  assert.match(components[1], /type="password"/);
  assert.match(components[1], /pagehide/);
  assert.match(components[0], /connectionRef\.current = null/);
});

const { parseAssistantMarkdown, linkHrefs, plainLinks } = await import("../src/components/assistant-markdown-parse.ts");
const allowOnly = (...hrefs) => (href) => hrefs.includes(href);

test("a label followed by list lines becomes a paragraph and a real list, not literal dashes", () => {
  const blocks = parseAssistantMarkdown("**Limiti da considerare:**\n- primo limite\n- secondo limite", allowOnly());
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "list"]);
  assert.deepEqual(blocks[0].content, [{ type: "strong", children: [{ type: "text", text: "Limiti da considerare:" }] }]);
  assert.equal(blocks[1].ordered, false);
  assert.deepEqual(blocks[1].items, [[{ type: "text", text: "primo limite" }], [{ type: "text", text: "secondo limite" }]]);
});

test("mixed blocks keep source order: heading, list, trailing paragraph and numbered list with its start", () => {
  const blocks = parseAssistantMarkdown("## Totale\n- a\n- b\nNota finale\n3. tre\n4. quattro", allowOnly());
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "list", "paragraph", "list"]);
  assert.deepEqual(blocks[2].content, [{ type: "text", text: "Nota finale" }]);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[3].start, 3);
});

test("consecutive plain lines stay one paragraph with their line breaks", () => {
  const blocks = parseAssistantMarkdown("riga uno\nriga due\n\nsecondo paragrafo", allowOnly());
  assert.deepEqual(blocks.map((block) => block.content), [[{ type: "text", text: "riga uno\nriga due" }], [{ type: "text", text: "secondo paragrafo" }]]);
});

test("only allow-listed internal hrefs become links; everything else keeps just the label", () => {
  const [paragraph] = parseAssistantMarkdown("Vedi [i Comuni](/comuni), [esterno](https://evil.example), [non citato](/altro) e **[in grassetto](/comuni)**.", allowOnly("/comuni"));
  assert.deepEqual(paragraph.content, [
    { type: "text", text: "Vedi " },
    { type: "link", href: "/comuni", children: [{ type: "text", text: "i Comuni" }] },
    { type: "text", text: ", " },
    { type: "text", text: "esterno" },
    { type: "text", text: ", " },
    { type: "text", text: "non citato" },
    { type: "text", text: " e " },
    { type: "strong", children: [{ type: "link", href: "/comuni", children: [{ type: "text", text: "in grassetto" }] }] },
    { type: "text", text: "." },
  ]);
});

test("html and images stay literal text even with a permissive allow-list", () => {
  const [paragraph] = parseAssistantMarkdown("<b>x</b> ![img](/a.png)", () => true);
  assert.deepEqual(paragraph.content, [{ type: "text", text: "<b>x</b> " }, { type: "text", text: "![img](/a.png)" }]);
});

test("tables still parse and their cells use the same inline rules", () => {
  const [table] = parseAssistantMarkdown("| Anno | Totale |\n| --- | ---: |\n| [2025](/x) | **5** |", allowOnly("/x"));
  assert.equal(table.type, "table");
  assert.deepEqual(table.rows[0][0], [{ type: "link", href: "/x", children: [{ type: "text", text: "2025" }] }]);
});

test("internal hrefs that fail the site contract are rejected before reaching the allow-list", async () => {
  const { isInternalSiteHref } = await import("../src/lib/assistant/byok-contracts.ts");
  for (const href of ["//evil.example", "/\\evil", "https://x.it/a", "javascript:alert(1)"]) assert.equal(isInternalSiteHref(href), false, href);
  assert.equal(isInternalSiteHref("/spese/panoramica?anno=2025#totale"), true);
});

const text = (value) => ({ type: "text", text: value });

test("a label line directly followed by a table renders a paragraph and a table, not raw pipes", () => {
  const blocks = parseAssistantMarkdown("Ecco i dati:\n| A | B |\n|---|---|\n| 1 | 2 |\nNota dopo la tabella", allowOnly());
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "table", "paragraph"]);
  assert.deepEqual(blocks[1].head, [[text("A")], [text("B")]]);
  assert.deepEqual(blocks[1].rows, [[[text("1")], [text("2")]]]);
});

test("table rows with missing or extra cells are aligned to the header, and escaped pipes stay inside a cell", () => {
  const [table] = parseAssistantMarkdown("| Voce | Valore |\n| --- | --- |\n| a \\| b |\n| c | 1 | extra |", allowOnly());
  assert.equal(table.type, "table");
  assert.deepEqual(table.rows, [[[text("a | b")], []], [[text("c")], [text("1")]]]);
});

test("single asterisks and underscores make emphasis without touching list markers, arithmetic or snake_case", () => {
  const blocks = parseAssistantMarkdown("Dato *provvisorio* e _stimato_.\n\n* voce elenco\n\n2 * 3 * 4 in siope_comuni_2025", allowOnly());
  assert.deepEqual(blocks[0].content, [text("Dato "), { type: "em", children: [text("provvisorio")] }, text(" e "), { type: "em", children: [text("stimato")] }, text(".")]);
  assert.equal(blocks[1].type, "list");
  assert.deepEqual(blocks[1].items, [[text("voce elenco")]]);
  assert.deepEqual(blocks[2].content, [text("2 * 3 * 4 in siope_comuni_2025")]);
});

test("emphasis can sit inside bold", () => {
  const [paragraph] = parseAssistantMarkdown("**totale *stimato***", allowOnly());
  assert.deepEqual(paragraph.content, [{ type: "strong", children: [text("totale "), { type: "em", children: [text("stimato")] }] }]);
});

test("backslash escapes print the literal character instead of formatting", () => {
  const [paragraph] = parseAssistantMarkdown("\\*non corsivo\\* \\[nota\\] \\_x\\_ e \\\\", allowOnly());
  assert.deepEqual(paragraph.content, [text("*non corsivo* [nota] _x_ e \\")]);
});

test("bold inside a link label is formatted, not printed as asterisks", () => {
  const [paragraph] = parseAssistantMarkdown("Apri [**Spese**](/spese) o [**Altro**](/no)", allowOnly("/spese"));
  assert.deepEqual(paragraph.content, [
    text("Apri "),
    { type: "link", href: "/spese", children: [{ type: "strong", children: [text("Spese")] }] },
    text(" o "),
    { type: "strong", children: [text("Altro")] },
  ]);
});

test("hrefs with balanced parentheses stay whole", () => {
  const [paragraph] = parseAssistantMarkdown("Vedi [l](/a(b)) e basta", allowOnly("/a(b)"));
  assert.deepEqual(paragraph.content, [text("Vedi "), { type: "link", href: "/a(b)", children: [text("l")] }, text(" e basta")]);
});

test("indented continuation lines join their list item instead of breaking the list", () => {
  const [list, ...rest] = parseAssistantMarkdown("- primo punto\n  che continua\n- secondo", allowOnly());
  assert.equal(rest.length, 0);
  assert.deepEqual(list.items, [[text("primo punto che continua")], [text("secondo")]]);
});

test("a blank line between items of the same kind keeps one list and its numbering", () => {
  const blocks = parseAssistantMarkdown("1. uno\n\n2. due\n\nFine", allowOnly());
  assert.deepEqual(blocks.map((block) => block.type), ["list", "paragraph"]);
  assert.deepEqual(blocks[0].items, [[text("uno")], [text("due")]]);
});

test("while streaming, an unfinished link shows only its label; a finished text keeps the literal", () => {
  const streaming = { streaming: true };
  assert.deepEqual(parseAssistantMarkdown("Vedi [Comu", allowOnly(), streaming)[0].content, [text("Vedi "), text("Comu")]);
  assert.deepEqual(parseAssistantMarkdown("Vedi [Comuni](/com", allowOnly(), streaming)[0].content, [text("Vedi "), text("Comuni")]);
  assert.deepEqual(parseAssistantMarkdown("Vedi [**Comuni**](/a(b", allowOnly(), streaming)[0].content, [text("Vedi "), { type: "strong", children: [text("Comuni")] }]);
  assert.deepEqual(parseAssistantMarkdown("Vedi [Comu", allowOnly())[0].content, [text("Vedi [Comu")]);
  assert.deepEqual(parseAssistantMarkdown("[nota] e poi", allowOnly(), streaming)[0].content, [text("[nota] e poi")]);
});

test("linkHrefs lists the hrefs that actually became links, in order and without duplicates", () => {
  const blocks = parseAssistantMarkdown("[a](/b) [c](/d)\n- [e](/b)\n\n| x |\n| --- |\n| [f](/g) |", allowOnly("/b", "/g"));
  assert.deepEqual([...linkHrefs(blocks)], ["/b", "/g"]);
});

test("plainLinks flattens every link to its label for the clipboard, including nested parentheses and images", () => {
  assert.equal(plainLinks("Vedi [i **Comuni**](/a(b)) e ![x](/i.png), \\[non link\\]"), "Vedi i **Comuni** e ![x](/i.png), \\[non link\\]");
  assert.equal(plainLinks("Sintassi: `[testo](/percorso)`"), "Sintassi: `[testo](/percorso)`", "code spans are copied verbatim");
});

test("while streaming, bold that has not closed yet is already bold and a bare marker is hidden", () => {
  const streaming = { streaming: true };
  assert.deepEqual(parseAssistantMarkdown("Totale **4,65 mil", allowOnly(), streaming)[0].content, [text("Totale "), { type: "strong", children: [text("4,65 mil")] }]);
  assert.deepEqual(parseAssistantMarkdown("Totale **", allowOnly(), streaming)[0].content, [text("Totale ")]);
  assert.deepEqual(parseAssistantMarkdown("Totale **4,65 mil", allowOnly())[0].content, [text("Totale **4,65 mil")]);
});

test('a figure never ends a line apart from its unit', async () => {
  const { keepFiguresWithUnits } = await import('../src/components/assistant-markdown-parse.ts');
  const nbsp = ' ';
  assert.equal(keepFiguresWithUnits('per 3,21 miliardi di euro'), `per 3,21${nbsp}miliardi di euro`);
  assert.equal(keepFiguresWithUnits('0,94 mld e 1.740 € e 12 % e 5 milioni'), `0,94${nbsp}mld e 1.740${nbsp}€ e 12${nbsp}% e 5${nbsp}milioni`);
  // Only the space between a figure and a unit changes: words, years and other spaces stay breakable.
  assert.equal(keepFiguresWithUnits('Nel 2025 i Comuni'), 'Nel 2025 i Comuni');
  assert.equal(keepFiguresWithUnits('mld 3 Comuni'), 'mld 3 Comuni');
});
