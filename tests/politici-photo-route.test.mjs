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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("politici photo proxies only bounded official image responses", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
