import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { fetchOfficialSource } = await import("../src/lib/data/source-fetch.ts");

test("MCP cancellation aborts both OpenBDAP discovery requests", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let started = 0;
  let aborted = 0;
  globalThis.fetch = async (_url, options = {}) => {
    started += 1;
    return await new Promise((_resolve, reject) => {
      const signal = options.signal;
      signal.addEventListener("abort", () => {
        aborted += 1;
        reject(signal.reason);
      }, { once: true });
    });
  };

  const startedAt = Date.now();
  try {
    const pending = queryPublicDataset(
      { dataset: "openbdap_opere_pubbliche", cup: "A12E34000010001" },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(new DOMException("test abort", "AbortError")), 25);
    await assert.rejects(pending, /test abort|AbortError/);
    assert.equal(started, 2);
    assert.equal(aborted, 2);
    assert.ok(Date.now() - startedAt < 250);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("official-source retry delay stops immediately when its caller aborts", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("upstream down", { status: 500 });
  };

  const startedAt = Date.now();
  try {
    const pending = fetchOfficialSource(
      "openbdap",
      "https://bdap-opendata.rgs.mef.gov.it/ODataProxy/test",
      { signal: controller.signal, maxRetries: 1 },
    );
    setTimeout(() => controller.abort(new DOMException("stop retry", "AbortError")), 25);
    await assert.rejects(pending, /stop retry|AbortError/);
    assert.equal(calls, 1);
    assert.ok(Date.now() - startedAt < 250);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
