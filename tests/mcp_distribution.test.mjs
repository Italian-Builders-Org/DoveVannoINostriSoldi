import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/.well-known/openai-apps-challenge/route.ts");

test("OpenAI domain challenge fails closed and returns only a configured token", async () => {
  const previous = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
  try {
    delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    const missing = GET();
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");

    process.env.OPENAI_APPS_CHALLENGE_TOKEN = "  dvns-verification-token  ";
    const configured = GET();
    assert.equal(configured.status, 200);
    assert.equal(configured.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await configured.text(), "dvns-verification-token");

    process.env.OPENAI_APPS_CHALLENGE_TOKEN = "bad\ntoken";
    assert.equal(GET().status, 404);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
    else process.env.OPENAI_APPS_CHALLENGE_TOKEN = previous;
  }
});

test("distribution pages and docs keep one canonical MCP endpoint", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/app/mcp/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/supporto/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/termini/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/mcp-endpoint.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/MCP_DISTRIBUTION.md", import.meta.url), "utf8"),
  ]);
  const combined = files.join("\n");
  assert.match(combined, /https:\/\/www\.dovevannoinostrisoldi\.com\/api\/mcp/);
  assert.match(combined, /Manufact/);
  assert.match(combined, /ChatGPT/);
  assert.match(combined, /Claude/);
  assert.match(combined, /soltanto dati pubblici|dati pubblici/i);
  assert.match(combined, /Copia prompt per agenti/);
  assert.match(combined, /list_datasets/);
  assert.match(combined, /imposta netta dichiarata MEF resta separata dal gettito totale/i);
  assert.match(combined, /saldo CPT resta un saldo contabile territorializzato/i);
  assert.match(combined, /spreco, frode o qualità del servizio/i);
  assert.doesNotMatch(combined, /già (?:pubblicat[oa]|disponibile) (?:su|in) (?:ChatGPT|Claude|Manufact)/i);
  assert.doesNotMatch(files[4], /window\.location\.origin|useSyncExternalStore/);
  assert.match(files[4], /<code>\{PUBLIC_MCP_ENDPOINT\}<\/code>/);
});
