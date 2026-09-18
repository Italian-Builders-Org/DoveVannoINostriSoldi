import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { PARTY_SYMBOLS, partySymbol } = await import("../src/lib/politici-symbols.ts");
const { symbolResponse, SYMBOL_MAX_BYTES } = await import("../src/lib/politici-symbol-response.ts");
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const signal = () => new AbortController().signal;
test("symbols have unique identifiers and explicit provenance without inventing mixed-group membership", () => {
  assert.equal(new Set(PARTY_SYMBOLS.map(s => s.family)).size, PARTY_SYMBOLS.length);
  for (const s of PARTY_SYMBOLS) {
    assert.equal(new URL(s.assetUrl).protocol, "https:");
    assert.equal(new URL(s.sourceUrl).protocol, "https:");
    assert.ok(s.credit && s.version && s.label);
  }
  for (const id of ["misto", "autonomie", "noi-moderati", "constructor", "__proto__", "https://localhost/"]) assert.equal(partySymbol(id), null);
});
test("unknown symbol makes no network request", async () => {
  let calls = 0;
  const result = await symbolResponse("misto", signal(), async () => { calls++; });
  assert.equal(result.status, 404); assert.equal(calls, 0);
});
test("symbol proxy sends only fixed URL and anonymous headers; rejects redirects; sets cache and content type", async () => {
  const result = await symbolResponse("lega", signal(), async (url, options) => {
    assert.equal(url, partySymbol("lega").assetUrl);
    assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.headers.Cookie, undefined);
    return new Response(png);
  });
  assert.equal(result.status, 200); assert.equal(result.headers.get("content-type"), "image/png");
  assert.match(result.headers.get("cache-control"), /s-maxage/);
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
});
test("HTML, SVG, empty and failed source responses never become successful images", async () => {
  for (const body of ["<svg></svg>", "<html>error</html>", ""]) {
    const result = await symbolResponse("lega", signal(), async () => new Response(body));
    assert.equal(result.status, 502); assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal((await symbolResponse("lega", signal(), async () => new Response(null, { status: 404 }))).status, 502);
  assert.equal((await symbolResponse("lega", signal(), async () => { throw new TypeError("redirect"); })).status, 502);
});
test("oversized body is cancelled during streaming, not after an unbounded arrayBuffer", async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(SYMBOL_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
  assert.equal((await symbolResponse("lega", signal(), async () => new Response(body))).status, 502);
  assert.equal(cancelled, true);
});
test("cancelled caller is not converted to a cached upstream failure", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(symbolResponse("lega", controller.signal, async () => { throw controller.signal.reason; }));
});
