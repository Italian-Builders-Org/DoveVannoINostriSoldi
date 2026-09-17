process.env.DVNS_SOURCE_FETCH_USE_GLOBAL = "1";

import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  calls.push({ url: String(input), signal: init.signal });
  return new Response("upstream unavailable", { status: 500 });
};

const {
  searchIpaEntities,
  searchIpaEntitiesByPrefix,
} = await import("../src/lib/ipa.ts");
const { SourceFetchError } = await import("../src/lib/data/source-fetch.ts");
const { getIpaTypeDistribution } = await import("../src/lib/ipa-stats.ts");
const { getIpaOrganizationStructure } = await import("../src/lib/ipa-structure.ts");
const { SOURCE_HEALTH_ADAPTERS } = await import("../src/lib/data/source-health.ts");
const {
  IPA_RUNTIME_MAX_RETRIES,
  IPA_RUNTIME_TIMEOUT_MS,
} = await import("../src/lib/ipa-runtime-fetch.ts");

test.after(() => {
  globalThis.fetch = originalFetch;
});

function assertOneCallPerUrl(expectedTotal) {
  assert.equal(calls.length, expectedTotal);
  const counts = new Map();
  for (const call of calls) {
    counts.set(call.url, (counts.get(call.url) ?? 0) + 1);
    assert.ok(call.signal instanceof AbortSignal);
  }
  assert.ok([...counts.values()].every((count) => count === 1), "nessun URL IPA deve essere ritentato");
}

test("runtime IPA policy is one attempt with a four-second per-call timeout", () => {
  assert.equal(IPA_RUNTIME_MAX_RETRIES, 0);
  assert.equal(IPA_RUNTIME_TIMEOUT_MS, 4_000);
});

test("entity datastore and prefix search make one call on HTTP 500", async () => {
  calls.length = 0;
  await assert.rejects(
    searchIpaEntities({ query: "Roma" }),
    (error) => error instanceof SourceFetchError && error.httpStatus === 500,
  );
  assertOneCallPerUrl(1);

  calls.length = 0;
  await assert.rejects(
    searchIpaEntitiesByPrefix({ query: "Roma" }),
    (error) => error instanceof SourceFetchError && error.httpStatus === 500,
  );
  assertOneCallPerUrl(1);
});

test("stats and structure do not retry any IPA resource on HTTP 500", async () => {
  calls.length = 0;
  await assert.rejects(getIpaTypeDistribution(8));
  assertOneCallPerUrl(1);

  calls.length = 0;
  await assert.rejects(getIpaOrganizationStructure("c_h501"));
  assertOneCallPerUrl(2);
});

test("health probes make one call per required IPA endpoint on HTTP 500", async () => {
  calls.length = 0;
  const entities = await SOURCE_HEALTH_ADAPTERS.ipa();
  assert.equal(entities.reachability, "down");
  assertOneCallPerUrl(2);

  calls.length = 0;
  const structure = await SOURCE_HEALTH_ADAPTERS["ipa-struttura"]();
  assert.equal(structure.reachability, "down");
  assertOneCallPerUrl(4);
});
