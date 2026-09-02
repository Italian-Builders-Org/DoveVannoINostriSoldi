process.env.DVNS_SOURCE_FETCH_USE_GLOBAL = "1";

import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  SourceFetchError,
  fetchOfficialSource,
  isUpstreamOverloadedError,
} = await import("../src/lib/data/source-fetch.ts");

test("rejectHttpError throws SourceFetchError without returning a 429 Response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("slow down", { status: 429 });

  try {
    await assert.rejects(
      () =>
        fetchOfficialSource(
          "ipa",
          "https://www.indicepa.gov.it/ipa-dati/api/3/action/datastore_search?resource_id=d09adf99-dc10-4349-8c53-27b1e5aa97b6&limit=0",
          { cacheMode: "no-store", rejectHttpError: true, maxRetries: 0, timeoutMs: 1000 },
        ),
      (error) => {
        assert.ok(error instanceof SourceFetchError);
        assert.equal(error.httpStatus, 429);
        assert.equal(isUpstreamOverloadedError(error), true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("no-store interactive fetches do not attach a Next revalidate cache policy", async () => {
  const originalFetch = globalThis.fetch;
  /** @type {RequestInit | undefined} */
  let seenInit;
  globalThis.fetch = async (_input, init = {}) => {
    seenInit = init;
    return new Response(JSON.stringify({ success: true, result: { records: [], total: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await fetchOfficialSource(
      "ipa",
      "https://www.indicepa.gov.it/ipa-dati/api/3/action/datastore_search?resource_id=d09adf99-dc10-4349-8c53-27b1e5aa97b6&limit=0",
      { cacheMode: "no-store", maxRetries: 0, timeoutMs: 1000 },
    );
    assert.equal(response.status, 200);
    assert.equal(seenInit?.cache, "no-store");
    assert.equal(seenInit?.next, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isUpstreamOverloadedError includes gateway 5xx that amplify IPA retries", () => {
  assert.equal(
    isUpstreamOverloadedError(new SourceFetchError("Fonte ipa HTTP 500", "ipa", undefined, 500)),
    true,
  );
  assert.equal(
    isUpstreamOverloadedError(new SourceFetchError("Fonte ipa HTTP 502", "ipa", undefined, 502)),
    true,
  );
  assert.equal(
    isUpstreamOverloadedError(new Error("IPA SQL upstream HTTP 500")),
    true,
  );
  assert.equal(
    isUpstreamOverloadedError(new SourceFetchError("Fonte ipa HTTP 404", "ipa", undefined, 404)),
    false,
  );
});

test("no-store production path bypasses global fetch (Next patch)", async () => {
  const previous = process.env.DVNS_SOURCE_FETCH_USE_GLOBAL;
  delete process.env.DVNS_SOURCE_FETCH_USE_GLOBAL;

  let globalFetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    globalFetchCalls += 1;
    return new Response("should-not-run", { status: 599 });
  };

  try {
    // Host not allowed for IPA — assertOfficialUrl fails before network.
    await assert.rejects(
      () =>
        fetchOfficialSource("ipa", "https://example.com/x", {
          cacheMode: "no-store",
          rejectHttpError: true,
          maxRetries: 0,
          timeoutMs: 1000,
        }),
      /Host non consentito/,
    );
    assert.equal(globalFetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.DVNS_SOURCE_FETCH_USE_GLOBAL;
    else process.env.DVNS_SOURCE_FETCH_USE_GLOBAL = previous;
  }
});
