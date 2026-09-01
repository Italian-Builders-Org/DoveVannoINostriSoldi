import assert from "node:assert/strict";
import test from "node:test";
import proxyTesting from "next/experimental/testing/server.js";
import { NextRequest } from "next/server.js";
import { config, proxy } from "../src/proxy.ts";

const { getRewrittenUrl, isRewrite } = proxyTesting;

test("MCP compatibility proxy is scoped to the exact public presentation path", () => {
  assert.deepEqual(config, { matcher: "/mcp" });
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
