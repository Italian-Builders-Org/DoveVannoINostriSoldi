import assert from "node:assert/strict";
import test from "node:test";
import proxyTesting from "next/experimental/testing/server.js";
import { NextRequest } from "next/server.js";
import { config, proxy } from "../src/proxy.ts";

const { getRewrittenUrl, isRewrite } = proxyTesting;

test("MCP compatibility proxy is scoped to the exact public presentation path", () => {
  assert.deepEqual(config, { matcher: ["/", "/mcp", "/enti/:path*", "/api/:path*"] });
});

test("politici subdomain rewrites the root path to the immersive map", async () => {
  const response = await proxy(new NextRequest("https://politici.dovevannoinostrisoldi.com/"));
  assert.equal(isRewrite(response), true);
  assert.equal(getRewrittenUrl(response), "https://politici.dovevannoinostrisoldi.com/politici");

  const main = await proxy(new NextRequest("https://www.dovevannoinostrisoldi.com/"));
  assert.equal(isRewrite(main), false);
  assert.equal(main.headers.get("x-middleware-next"), "1");
});

test("training crawlers share an entity allowance without blocking user-initiated fetches", (t) => {
  let now = Date.now() + 60_000;
  t.mock.method(Date, "now", () => now);
  const request = (userAgent, path = "/enti/c_a783/appalti", ip = "192.0.2.20") =>
    new NextRequest(`https://example.test${path}`, {
      headers: { "user-agent": userAgent, "x-forwarded-for": ip },
    });
  const agents = ["ClaudeBot/1.0", "GPTBot/1.0", "CCBot/1.0", "Meta-ExternalAgent/1.0"];
  for (let i = 0; i < 30; i++) {
    assert.equal(proxy(request(agents[i % agents.length])).headers.get("x-middleware-next"), "1");
  }
  for (const agent of agents) {
    const response = proxy(request(agent, "/enti"));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  for (const agent of ["Claude-User/1.0", "Claude-SearchBot/1.0", "Mozilla/5.0"]) {
    assert.equal(proxy(request(agent)).headers.get("x-middleware-next"), "1", agent);
  }
  // One exhausted client cannot spend another client's or the API's allowance.
  assert.equal(proxy(request("ClaudeBot/1.0", "/enti/c_h501", "192.0.2.21")).headers.get("x-middleware-next"), "1");
  assert.equal(proxy(request("ClaudeBot/1.0", "/api/health")).headers.get("x-middleware-next"), "1");
  now += 60_000;
  assert.equal(proxy(request("ClaudeBot/1.0")).headers.get("x-middleware-next"), "1");
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

test("API proxy preserves shared capacity after per-client rejection and resets its window", (t) => {
  let now = Date.now() + 240_000;
  t.mock.method(Date, "now", () => now);
  const requestFor = (ip) => new NextRequest("https://example.test/api/health", {
    headers: { "x-forwarded-for": ip },
  });
  const assertAllowed = (ip) => {
    assert.equal(proxy(requestFor(ip)).headers.get("x-middleware-next"), "1");
  };
  const assertLimited = (ip) => {
    const response = proxy(requestFor(ip));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  };

  for (let i = 0; i < 120; i += 1) assertAllowed("192.0.2.1");
  // These local proxy invocations must not use another client's allowance.
  for (let i = 0; i < 600; i += 1) assertLimited("192.0.2.1");
  for (let client = 2; client <= 5; client += 1) {
    for (let i = 0; i < 120; i += 1) assertAllowed(`192.0.2.${client}`);
  }
  assertLimited("192.0.2.6");

  now += 60_000;
  assertAllowed("192.0.2.1");
  assertAllowed("192.0.2.6");
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
