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

const { parseAssistantMarkdown } = await import("../src/components/assistant-markdown-parse.ts");
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
    { type: "link", text: "i Comuni", href: "/comuni" },
    { type: "text", text: ", " },
    { type: "text", text: "esterno" },
    { type: "text", text: ", " },
    { type: "text", text: "non citato" },
    { type: "text", text: " e " },
    { type: "strong", children: [{ type: "link", text: "in grassetto", href: "/comuni" }] },
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
  assert.deepEqual(table.rows[0][0], [{ type: "link", text: "2025", href: "/x" }]);
});

test("internal hrefs that fail the site contract are rejected before reaching the allow-list", async () => {
  const { isInternalSiteHref } = await import("../src/lib/assistant/byok-contracts.ts");
  for (const href of ["//evil.example", "/\\evil", "https://x.it/a", "javascript:alert(1)"]) assert.equal(isInternalSiteHref(href), false, href);
  assert.equal(isInternalSiteHref("/spese/panoramica?anno=2025#totale"), true);
});
