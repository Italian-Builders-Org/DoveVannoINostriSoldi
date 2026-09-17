import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("entity listing and detail pages share short abortable IPA budgets", () => {
  const listing = read("src/app/enti/page.tsx");
  assert.match(listing, /const PAGE_DATA_BUDGET_MS = 6_000/);
  assert.match(listing, /const signal = AbortSignal\.timeout\(PAGE_DATA_BUDGET_MS\)/);
  assert.match(listing, /getIpaRegistryStats\(signal\)/);
  assert.match(listing, /getIpaTypeDistribution\(8, \{ signal \}\)/);
  assert.match(listing, /getIpaCentralAdministrations\(signal\)/);
  assert.match(listing, /searchIpaEntities\(\{ query, limit: 30, signal \}\)/);
  assert.match(listing, /robots:\s*\{\s*index: false,\s*follow: false/);

  const detail = read("src/app/enti/[codice]/page.tsx");
  assert.match(detail, /const PAGE_DATA_BUDGET_MS = 6_000/);
  assert.match(detail, /const signal = AbortSignal\.timeout\(PAGE_DATA_BUDGET_MS\)/);
  assert.match(detail, /getIpaEntityByCode\(normalizedCode, signal\)/);
  assert.match(detail, /getIpaOrganizationStructure\(normalizedCode, 250, 0, \{ signal \}\)/);
  assert.match(detail, /if \(!entity\) return \{ title: "Ente non trovato", robots: entityRobots \}/);
});

test("search page is crawlable for noindex and fails soft on its IPA deadline", () => {
  const page = read("src/app/cerca/page.tsx");
  assert.match(page, /const PAGE_DATA_BUDGET_MS = 5_000/);
  assert.match(page, /searchGlobal\(\{[\s\S]*signal: AbortSignal\.timeout\(PAGE_DATA_BUDGET_MS\)/);
  assert.match(page, /catch/);

  const discovery = read("src/lib/public-discovery.ts");
  assert.doesNotMatch(discovery, /disallow:\s*\[[^\]]*"\/cerca"/s);
});

test("state SSR pages stay within function limits without deindexing public detail", () => {
  const overview = read("src/app/stato/page.tsx");
  assert.match(overview, /export const maxDuration = 15/);
  assert.match(overview, /const PAGE_DATA_BUDGET_MS = 8_000/);
  const history = read("src/components/state-spending-history-section.tsx");
  assert.match(history, /const PAGE_HISTORY_BUDGET_MS = 5_000/);
  assert.match(history, /deadlineMs: PAGE_HISTORY_BUDGET_MS/);
  assert.match(history, /AbortSignal\.timeout\(PAGE_HISTORY_BUDGET_MS\)/);

  const administration = read("src/app/stato/amministrazioni/[codice]/page.tsx");
  assert.match(administration, /export const maxDuration = 15/);
  assert.doesNotMatch(administration, /robots:\s*\{\s*index: false,\s*follow: false/);
  assert.match(administration, /AbortSignal\.timeout\(10_000\)/);

  const discovery = read("src/lib/public-discovery.ts");
  assert.doesNotMatch(discovery, /disallow:\s*\[[^\]]*"\/stato\/amministrazioni\/"/s);
});
