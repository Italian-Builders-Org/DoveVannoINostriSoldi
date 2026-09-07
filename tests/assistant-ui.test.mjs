import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("assistant UI keeps its accessible deterministic text surface", async () => {
  const [page, component, css, navigation] = await Promise.all([
    source("../src/app/assistente/page.tsx"),
    source("../src/components/assistant-chat.tsx"),
    source("../src/app/assistente/assistant.module.css"),
    source("../src/lib/site-navigation.ts"),
  ]);
  assert.match(page, /deterministic|deterministica/i);
  assert.match(page, /non usa voce|provider AI/i);
  assert.match(component, /<label htmlFor="assistant-prompt">/);
  assert.match(component, /aria-describedby="assistant-help assistant-count"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /aria-busy=\{loading\}/);
  assert.match(component, /answer\.source\.url\.startsWith\("https:\/\/"\)/);
  assert.match(component, /target="_blank" rel="noreferrer"/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(navigation, /href: "\/assistente", label: "Assistente"/);
});

test("assistant UI keeps narrow controls inside the viewport", async () => {
  const css = await source("../src/app/assistente/assistant.module.css");
  assert.match(css, /\.form textarea,[\s\S]*?width: 100%;/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.form button \{ justify-self: start/);
  assert.match(css, /\.example \{[\s\S]*?min-height: 44px;/);
});
