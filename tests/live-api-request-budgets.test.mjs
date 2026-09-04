import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("live IPA APIs propagate client aborts under a server-owned deadline", () => {
  const routes = [
    ["src/app/api/enti/route.ts", "IPA_SEARCH_REQUEST_TIMEOUT_MS", /searchIpaEntities\(\{ query, limit, offset, signal \}\)/],
    ["src/app/api/enti/[codice]/route.ts", "IPA_ENTITY_REQUEST_TIMEOUT_MS", /getIpaEntityByCode\(normalized, signal\)/],
    ["src/app/api/enti/[codice]/struttura/route.ts", "IPA_STRUCTURE_REQUEST_TIMEOUT_MS", /getIpaOrganizationStructure\(normalized, limit, offset, \{ signal \}\)/],
  ];

  for (const [path, budget, operation] of routes) {
    const source = read(path);
    assert.match(source, new RegExp(`runWithRequestBudget\\(\\s*request\\.signal,\\s*${budget}`), path);
    assert.match(source, operation, path);
    assert.match(source, /\b504\b/, path);
  }
});

test("live source and OpenBDAP APIs cap fan-out duration and concurrency", () => {
  const routes = [
    ["src/app/api/fonti/stato/route.ts", "SOURCE_HEALTH_REQUEST_TIMEOUT_MS", 2],
    ["src/app/api/spese/stato/route.ts", "STATE_SPENDING_REQUEST_TIMEOUT_MS", 3],
    ["src/app/api/spese/stato/amministrazioni/[codice]/route.ts", "ADMIN_SPENDING_REQUEST_TIMEOUT_MS", 3],
  ];

  for (const [path, budget, concurrency] of routes) {
    const source = read(path);
    assert.match(source, new RegExp(`runWithRequestBudget\\(\\s*request\\.signal,\\s*${budget}`), path);
    assert.match(source, new RegExp(`ConcurrencyLimiter\\(${concurrency}\\)`), path);
    assert.match(source, /\b504\b/, path);
    assert.match(source, /Retry-After/, path);
    assert.match(source, /finally\s*\{\s*release\(\)/, path);
  }
});

test("multi-file OpenBDAP views use persistent cache, single-flight and narrow cold-miss guards", () => {
  const cache = read("src/lib/data/cached-live-views.ts");
  assert.match(cache, /unstable_cache/);
  assert.match(cache, /getSourcePolicy\("openbdap"\)\.dataRevalidateSeconds/);
  assert.match(cache, /getCachedSsnNationalHistory/);
  assert.match(cache, /getCachedLegislatureSpendingCycles/);
  assert.match(cache, /function singleFlight/);

  const routes = [
    ["src/app/api/spese/stato/legislature/route.ts", "getCachedLegislatureSpendingCycles"],
    ["src/app/api/spese/sanita/storico/route.ts", "getCachedSsnNationalHistory"],
  ];
  for (const [path, operation] of routes) {
    const source = read(path);
    assert.match(source, /export const maxDuration = 60/);
    assert.match(source, /SlidingWindowLimiter\(\{ windowMs: 60_000, max: 6 \}\)/);
    assert.match(source, /ConcurrencyLimiter\(1\)/);
    assert.match(source, new RegExp(`${operation}\\(\\)`));
    assert.match(source, /Retry-After/);
    assert.match(source, /finally\s*\{\s*release\(\)/);
  }
});

test("MCP historical OpenBDAP datasets reuse the persistent cache", () => {
  const datasets = read("src/lib/mcp/datasets.ts");
  assert.match(datasets, /getMcpCachedSsnNationalHistory\(\{ signal: options\.signal \}\)/);
  assert.match(datasets, /getMcpCachedLegislatureSpendingCycles\(\{ signal: options\.signal \}\)/);
  assert.doesNotMatch(datasets, /cancelPopulationOnAbort/);
  assert.doesNotMatch(datasets, /shared:\s*false/);
});

test("single-fetch OpenBDAP health composes its deadline with client cancellation", () => {
  const source = read("src/app/api/fonti/bdap/route.ts");
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /AbortSignal\.any\(\[request\.signal, AbortSignal\.timeout\(8_000\)\]\)/);
  assert.match(source, /signal,/);
});
