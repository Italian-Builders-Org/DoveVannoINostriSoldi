process.env.DVNS_SOURCE_FETCH_USE_GLOBAL = "1";

import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const fetchCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  fetchCalls.push({ input: String(input), init });
  return new Response(JSON.stringify({ success: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { GET } = await import("../src/app/api/search/route.ts");

function request(search = "") {
  return new Request(`https://example.test/api/search${search}`);
}

function assertErrorHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("la route valida query e limite prima di interrogare IPA", async () => {
  fetchCalls.length = 0;

  const tooLong = await GET(request(`?q=${"a".repeat(181)}`));
  assert.equal(tooLong.status, 400);
  assertErrorHeaders(tooLong);
  const tooLongBody = await tooLong.json();
  assert.equal(tooLongBody.ok, false);
  assert.match(tooLongBody.error, /180 caratteri/);

  for (const value of ["0", "21", "1.5", "1e1", "8abc", ""]) {
    const response = await GET(request(`?q=Roma&limit=${value}`));
    assert.equal(response.status, 400, value);
    assertErrorHeaders(response);
  }

  assert.equal(fetchCalls.length, 0);
});

test("la route accetta entrambi i limiti validi e usa i due adapter IPA distinti", async () => {
  fetchCalls.length = 0;

  for (const limit of [1, 20]) {
    const response = await GET(request(`?q=Roma&limit=${limit}`));
    assert.equal(response.status, 200, String(limit));
  }

  assert.equal(fetchCalls.length, 4);
  assert.ok(fetchCalls.some(({ input }) => input.includes("datastore_search_sql")));
  assert.ok(fetchCalls.some(({ input }) => input.includes("datastore_search?")));
});

test("query vuota o di un carattere non chiama IPA", async () => {
  fetchCalls.length = 0;

  for (const search of ["", "?q=R"]) {
    const response = await GET(request(search));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).entitiesAvailable, true);
  }

  assert.equal(fetchCalls.length, 0);
});

test("su 429 IPA non ripete il fallback full-text e resta HTTP 200", async () => {
  fetchCalls.length = 0;
  globalThis.fetch = async (input, init = {}) => {
    fetchCalls.push({ input: String(input), init });
    return new Response("Too Many Requests", { status: 429 });
  };

  const response = await GET(request("?q=asl&limit=8"));
  assert.equal(response.status, 200);
  assertErrorHeaders(response);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.entitiesAvailable, false);
  assert.equal(fetchCalls.length, 1, "un 429 non deve aprire il secondo adapter IPA");
  assert.ok(fetchCalls[0].input.includes("datastore_search_sql"));

  globalThis.fetch = async (input, init = {}) => {
    fetchCalls.push({ input: String(input), init });
    return new Response(JSON.stringify({ success: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

test("il fallback IPA resta una risposta controllata e riceve il signal", async () => {
  fetchCalls.length = 0;
  const response = await GET(request("?q=Roma&limit=8"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.entitiesAvailable, false);
  assert.equal(fetchCalls.length, 2, "SQL seguito dal fallback full-text");
  assert.ok(fetchCalls.every(({ init }) => init.signal instanceof AbortSignal));
});

test("un abort del client interrompe la ricerca e non diventa un falso successo", async () => {
  let abortFetchCalls = 0;
  globalThis.fetch = async (_input, init = {}) => {
    abortFetchCalls += 1;
    await new Promise((resolve, reject) => {
      if (init.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };

  const controller = new AbortController();
  const pending = GET(new Request("https://example.test/api/search?q=Roma", {
    signal: controller.signal,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending);
  assert.equal(abortFetchCalls, 1, "un abort non deve avviare il fallback IPA");
});
