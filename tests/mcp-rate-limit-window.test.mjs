import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MCP_RATE_LIMIT_SAFETY_MS,
  MCP_RATE_LIMIT_WINDOW_MS,
  remainingMcpRateLimitWaitMs,
} from "../scripts/ci/mcp-rate-limit-window.mjs";

const openedAt = 1_000_000;
const protectedWindowMs = MCP_RATE_LIMIT_WINDOW_MS + MCP_RATE_LIMIT_SAFETY_MS;

test("MCP rate-limit scheduling waits only for the residual protected window", () => {
  assert.equal(
    remainingMcpRateLimitWaitMs({
      windowOpenedAtMs: openedAt,
      nowMs: openedAt + 15_000,
    }),
    protectedWindowMs - 15_000,
  );
});

test("MCP rate-limit scheduling preserves the safety margin at the nominal boundary", () => {
  assert.equal(
    remainingMcpRateLimitWaitMs({
      windowOpenedAtMs: openedAt,
      nowMs: openedAt + MCP_RATE_LIMIT_WINDOW_MS,
    }),
    MCP_RATE_LIMIT_SAFETY_MS,
  );
});

test("MCP rate-limit scheduling continues immediately at or beyond the protected boundary", () => {
  assert.equal(
    remainingMcpRateLimitWaitMs({
      windowOpenedAtMs: openedAt,
      nowMs: openedAt + protectedWindowMs,
    }),
    0,
  );
  assert.equal(
    remainingMcpRateLimitWaitMs({
      windowOpenedAtMs: openedAt,
      nowMs: openedAt + protectedWindowMs + 30_000,
    }),
    0,
  );
});

test("MCP rate-limit scheduling rejects invalid timing inputs", () => {
  assert.throws(
    () => remainingMcpRateLimitWaitMs({ windowOpenedAtMs: Number.NaN, nowMs: openedAt }),
    /windowOpenedAtMs/,
  );
  assert.throws(
    () => remainingMcpRateLimitWaitMs({ windowOpenedAtMs: openedAt, nowMs: -1 }),
    /nowMs/,
  );
  assert.throws(
    () => remainingMcpRateLimitWaitMs({ windowOpenedAtMs: openedAt, nowMs: openedAt, windowMs: 0 }),
    /windowMs must be greater than zero/,
  );
});

test("production scheduling starts its conservative interval after the contract smoke", () => {
  const runner = readFileSync(new URL("../scripts/ci/run-production-gates.sh", import.meta.url), "utf8");
  const contractIndex = runner.indexOf("npm run test:mcp:http -- --mode contract");
  const completedIndex = runner.indexOf("MCP_CONTRACT_WINDOW_COMPLETED_MS=");
  const residualWaitIndex = runner.indexOf(
    'node scripts/ci/mcp-rate-limit-window.mjs "$MCP_CONTRACT_WINDOW_COMPLETED_MS"',
  );

  assert.ok(contractIndex >= 0, "production runner must execute the MCP contract smoke");
  assert.ok(completedIndex > contractIndex, "the conservative timestamp must follow the contract smoke");
  assert.ok(residualWaitIndex > completedIndex, "the residual wait must consume the completed timestamp");
  assert.doesNotMatch(runner, /setTimeout\([^\n]*60_?100|setTimeout\([^\n]*60100/);
});

test("the contract smoke starts after the browser suites' API window has elapsed", () => {
  // The atlas, runtime-cache and Europa suites call /api/politici/* from the same
  // loopback IP; without this wait the contract POSTs can hit the local 429 limit.
  const runner = readFileSync(new URL("../scripts/ci/run-production-gates.sh", import.meta.url), "utf8");
  const lastBrowserSuite = runner.indexOf("node scripts/browser/politici-europa.mjs");
  const completedIndex = runner.indexOf("BROWSER_API_WINDOW_COMPLETED_MS=");
  const waitIndex = runner.indexOf('node scripts/ci/mcp-rate-limit-window.mjs "$BROWSER_API_WINDOW_COMPLETED_MS"');
  const contractIndex = runner.indexOf("npm run test:mcp:http -- --mode contract");

  assert.ok(lastBrowserSuite >= 0, "production runner must execute the Europa browser suite");
  assert.ok(completedIndex > lastBrowserSuite, "the timestamp must follow the last browser suite before the contract");
  assert.ok(waitIndex > completedIndex, "the wait must consume that timestamp");
  assert.ok(contractIndex > waitIndex, "the contract smoke must start after the wait");
  for (const suite of ["scripts/browser/politici-atlas.mjs", "scripts/browser/runtime-cache.mjs"]) {
    const index = runner.indexOf(suite);
    assert.ok(index >= 0 && index < completedIndex, `${suite} must run inside the waited window`);
  }
});
