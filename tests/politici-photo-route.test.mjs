import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/politici/foto/[id]/route.ts");

test("politici photo rejects unknown identities without fetching", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch should not run");
  };
  try {
    const response = await GET(
      new Request("http://localhost/politici/foto/unknown"),
      { params: Promise.resolve({ id: "unknown" }) },
    );
    assert.equal(response.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici photo returns 404 for declared portrait gaps without fetching", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch should not run");
  };
  try {
    const response = await GET(
      new Request("http://localhost/politici/foto/gov-309060"),
      { params: Promise.resolve({ id: "gov-309060" }) },
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.match(body.error, /non disponibile/i);
    assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici photo proxies only bounded official image responses", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let fetchInit = null;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    fetchInit = init ?? null;
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    const response = await GET(
      new Request("http://localhost/politici/foto/sen-s32"),
      { params: Promise.resolve({ id: "sen-s32" }) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
    assert.equal(new Uint8Array(await response.arrayBuffer()).length, 4);
    assert.equal(requestedUrl, "https://www.senato.it/leg/19/Immagini/Senatori/00000032.jpg");
    assert.equal(fetchInit?.next?.revalidate, 86_400);
    assert.notEqual(fetchInit?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici photo maps Senato 403 to cacheable 404 instead of 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 403 });
  try {
    const response = await GET(
      new Request("http://localhost/politici/foto/sen-s32"),
      { params: Promise.resolve({ id: "sen-s32" }) },
    );
    assert.equal(response.status, 404);
    assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
    const body = await response.json();
    assert.match(body.error, /temporaneamente non disponibile/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici photo maps empty Senato 202 to cacheable 404", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array(), { status: 202 });
  try {
    const response = await GET(
      new Request("http://localhost/politici/foto/sen-s32"),
      { params: Promise.resolve({ id: "sen-s32" }) },
    );
    assert.equal(response.status, 404);
    assert.match(response.headers.get("cache-control"), /s-maxage=3600/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici photo maps timeouts to cacheable 404 without 5xx", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  try {
    const response = await GET(
      new Request("http://localhost/politici/foto/sen-s32", { signal: AbortSignal.timeout(30_000) }),
      { params: Promise.resolve({ id: "sen-s32" }) },
    );
    assert.equal(response.status, 404);
    assert.match(response.headers.get("cache-control"), /s-maxage=60/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
