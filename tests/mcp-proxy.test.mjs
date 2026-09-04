import assert from "node:assert/strict";
import test from "node:test";
import proxyTesting from "next/experimental/testing/server.js";
import { NextRequest } from "next/server.js";
import { config, proxy } from "../src/proxy.ts";

const { getRewrittenUrl, isRewrite } = proxyTesting;

test("MCP compatibility proxy is scoped to the exact public presentation path", () => {
  assert.deepEqual(config, { matcher: ["/mcp", "/enti/:path*", "/api/:path*"] });
});

test("entity proxy stops the observed ClaudeBot crawl before page rendering", async () => {
  const blocked = await proxy(new NextRequest("https://example.test/enti/c_a783/appalti", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    },
  }));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("cache-control"), "private, no-store");
  assert.equal(blocked.headers.get("x-robots-tag"), "noindex, nofollow");

  for (const userAgent of [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Claude/1.0",
  ]) {
    const allowed = await proxy(new NextRequest("https://example.test/enti/c_a783/appalti", {
      headers: { "User-Agent": userAgent },
    }));
    assert.equal(allowed.headers.get("x-middleware-next"), "1", userAgent);
  }
});

test("MCP compatibility proxy rewrites POST, OPTIONS and HEAD to the canonical endpoint", async () => {
  for (const method of ["POST", "OPTIONS", "HEAD"]) {
    const response = await proxy(new NextRequest("https://example.test/mcp?client=test", { method }));
    assert.equal(isRewrite(response), true, method);
    assert.equal(getRewrittenUrl(response), "https://example.test/api/mcp?client=test", method);
  }

  const eventStreamGet = await proxy(new NextRequest("https://example.test/mcp", {
    method: "GET",
    headers: { Accept: "application/json, text/event-stream" },
  }));
  assert.equal(isRewrite(eventStreamGet), true);
  assert.equal(getRewrittenUrl(eventStreamGet), "https://example.test/api/mcp");
});

test("API proxy continues ordinary requests", async () => {
  const response = await proxy(new NextRequest("https://example.test/api/health"));
  assert.equal(isRewrite(response), false);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("MCP compatibility proxy preserves the human-facing page for safe methods", async () => {
  for (const [method, headers] of [
    ["GET", { Accept: "text/html" }],
    ["PUT", {}],
  ]) {
    const response = await proxy(new NextRequest("https://example.test/mcp", { method, headers }));
    assert.equal(isRewrite(response), false, method);
    assert.equal(response.headers.get("x-middleware-next"), "1", method);
  }

  const subpath = await proxy(new NextRequest("https://example.test/mcp/extra", { method: "POST" }));
  assert.equal(isRewrite(subpath), false);
  assert.equal(subpath.headers.get("x-middleware-next"), "1");
});
