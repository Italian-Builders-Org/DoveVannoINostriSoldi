import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ success: false }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const { GET } = await import("../src/app/api/search/route.ts");

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("search limiter fails closed when forwarding headers are absent or malformed", async () => {
  for (let index = 0; index < 30; index += 1) {
    const headers = index % 2 === 0 ? {} : { "X-Forwarded-For": "not-an-address" };
    const response = await GET(new Request("https://example.test/api/search?q=Roma", { headers }));
    assert.equal(response.status, 200, `richiesta ${index + 1}`);
  }

  for (let index = 30; index < 60; index += 1) {
    const response = await GET(new Request("https://example.test/api/search?q=Roma"));
    assert.equal(response.status, 200, `richiesta ${index + 1}`);
  }

  const limited = await GET(new Request("https://example.test/api/search?q=Roma", {
    headers: { "X-Real-IP": "invalid" },
  }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});
