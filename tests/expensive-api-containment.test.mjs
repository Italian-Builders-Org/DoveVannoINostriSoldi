import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const originalFetch = globalThis.fetch;
const { NextRequest } = await import("next/server.js");
const { GET: getWorks } = await import("../src/app/api/opere/route.ts");
const { GET: getHistory } = await import("../src/app/api/spese/stato/storico/route.ts");
const { GET: getBudgetLaw } = await import("../src/app/api/spese/stato/legge-bilancio/route.ts");
const { POST: postAssistant } = await import("../src/app/api/assistant/route.ts");

test.after(() => {
  globalThis.fetch = originalFetch;
});

function getRequest(path, address, signal) {
  return new Request(`https://example.test${path}`, {
    headers: { "X-Forwarded-For": address },
    signal,
  });
}

function assistantRequest(address) {
  return new Request("https://example.test/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "example.test",
      Origin: "https://example.test",
      "X-Forwarded-For": address,
    },
    body: JSON.stringify({ prompt: "aiuto" }),
  });
}

test("all expensive public routes wire a server budget, a bulkhead, and a local rate limit", () => {
  const expectations = [
    ["src/app/api/opere/route.ts", "OPERE_REQUEST_TIMEOUT_MS", 20, 3],
    ["src/app/api/spese/stato/storico/route.ts", "HISTORY_REQUEST_TIMEOUT_MS", 6, 2],
    ["src/app/api/spese/stato/legge-bilancio/route.ts", "BUDGET_LAW_REQUEST_TIMEOUT_MS", 6, 2],
    ["src/app/api/assistant/route.ts", "ASSISTANT_REQUEST_TIMEOUT_MS", 30, 4],
  ];

  for (const [path, budget, perMinute, concurrency] of expectations) {
    const source = readFileSync(path, "utf8");
    assert.match(source, new RegExp(`runWithRequestBudget\\(\\s*request\\.signal,\\s*${budget}`), path);
    assert.match(source, new RegExp(`SlidingWindowLimiter\\(\\{ windowMs: 60_000, max: ${perMinute} \\}\\)`), path);
    assert.match(source, new RegExp(`ConcurrencyLimiter\\(${concurrency}\\)`), path);
    assert.match(source, /Retry-After/, path);
  }
});

test("the works bulkhead caps live fan-out and releases every slot on client abort", async () => {
  let activeFetches = 0;
  const upstreamSignals = [];
  globalThis.fetch = async (_input, init = {}) => {
    assert.ok(init.signal instanceof AbortSignal);
    upstreamSignals.push(init.signal);
    activeFetches += 1;
    return await new Promise((_resolve, reject) => {
      const abort = () => {
        activeFetches -= 1;
        reject(init.signal.reason);
      };
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    });
  };

  const controllers = Array.from({ length: 3 }, () => new AbortController());
  const pending = controllers.map((controller, index) => getWorks(getRequest(
    "/api/opere?cup=B11E19000030001",
    `203.0.113.${index + 1}`,
    controller.signal,
  )));
  const deadline = Date.now() + 1_000;
  while (activeFetches < 6) {
    assert.ok(Date.now() < deadline, "the three admitted lookups did not start both discovery fetches");
    await new Promise((resolve) => setImmediate(resolve));
  }

  const rejected = await getWorks(getRequest(
    "/api/opere?cup=B11E19000030001",
    "203.0.113.10",
  ));
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get("retry-after"), "5");
  assert.equal(activeFetches, 6, "the rejected lookup must not start upstream work");

  controllers.forEach((controller) => controller.abort(new DOMException("cleanup", "AbortError")));
  const settled = await Promise.allSettled(pending);
  assert.ok(settled.every((result) => result.status === "rejected"));
  assert.equal(activeFetches, 0);
  assert.equal(upstreamSignals.every((signal) => signal.aborted), true);
});

test("each route rejects the first request beyond its per-address allowance before upstream work", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ success: true, result: { results: [] } }), {
      headers: { "content-type": "application/json" },
    });
  };

  for (let index = 0; index < 20; index += 1) {
    assert.notEqual((await getWorks(getRequest(
      "/api/opere?cup=B11E19000030001",
      "198.51.100.20",
    ))).status, 429);
  }
  const worksCalls = fetchCalls;
  const worksLimited = await getWorks(getRequest(
    "/api/opere?cup=B11E19000030001",
    "198.51.100.20",
  ));
  assert.equal(worksLimited.status, 429);
  assert.equal(fetchCalls, worksCalls);

  for (let index = 0; index < 6; index += 1) {
    assert.notEqual((await getHistory(getRequest(
      "/api/spese/stato/storico",
      "198.51.100.21",
    ))).status, 429);
  }
  const historyCalls = fetchCalls;
  const historyLimited = await getHistory(getRequest(
    "/api/spese/stato/storico",
    "198.51.100.21",
  ));
  assert.equal(historyLimited.status, 429);
  assert.equal(fetchCalls, historyCalls);

  for (let index = 0; index < 6; index += 1) {
    const request = new NextRequest("https://example.test/api/spese/stato/legge-bilancio?anni=2", {
      headers: { "X-Forwarded-For": "198.51.100.22" },
    });
    assert.notEqual((await getBudgetLaw(request)).status, 429);
  }
  const budgetLawCalls = fetchCalls;
  const budgetLawLimited = await getBudgetLaw(new NextRequest(
    "https://example.test/api/spese/stato/legge-bilancio?anni=2",
    { headers: { "X-Forwarded-For": "198.51.100.22" } },
  ));
  assert.equal(budgetLawLimited.status, 429);
  assert.equal(fetchCalls, budgetLawCalls);

  for (let index = 0; index < 30; index += 1) {
    assert.equal((await postAssistant(assistantRequest("198.51.100.23"))).status, 200);
  }
  const assistantLimited = await postAssistant(assistantRequest("198.51.100.23"));
  assert.equal(assistantLimited.status, 429);
  assert.equal(assistantLimited.headers.get("retry-after"), "60");
});
