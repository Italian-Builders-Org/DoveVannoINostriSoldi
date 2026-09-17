import assert from "node:assert/strict";
import test from "node:test";

const {
  BoundedOperationalLogThrottle,
  extractMcpOperationalContext,
  reportMcpHandlerError,
  reportMcpOperationalEvent,
} =
  await import("../src/lib/mcp/operational-telemetry.ts");

test("MCP operational telemetry keeps protocol, method and tool but excludes sensitive payload data", () => {
  const secret = "do-not-log-this-search-or-prompt";
  const request = new Request("https://example.test/api/mcp?query=also-secret", {
    method: "POST",
    headers: {
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "tools/call",
      "MCP-Name": "query_dataset",
      "X-Forwarded-For": "203.0.113.99",
    },
  });
  const context = extractMcpOperationalContext(request, {
    jsonrpc: "2.0",
    id: "rpc-42",
    method: "tools/call",
    params: {
      name: "query_dataset",
      arguments: { query: secret, prompt: secret },
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    },
  });

  assert.deepEqual(context, {
    protocol: "2026-07-28",
    method: "tools/call",
    tool: "query_dataset",
    requestId: "rpc-42",
  });

  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    reportMcpOperationalEvent({
      outcome: "concurrency_limited",
      status: 503,
      durationMs: 12.6,
      context,
      activeRequests: 8,
      concurrencyLimit: 8,
    });
  } finally {
    console.warn = previousWarn;
  }

  assert.equal(warnings.length, 1);
  const event = JSON.parse(warnings[0]);
  assert.deepEqual(event, {
    event: "mcp_operational_limit",
    outcome: "concurrency_limited",
    status: 503,
    durationMs: 13,
    protocol: "2026-07-28",
    method: "tools/call",
    tool: "query_dataset",
    activeRequests: 8,
    concurrencyLimit: 8,
    saturated: true,
  });

  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /rpc-42|203\.0\.113\.99|do-not-log|also-secret/i);
  assert.equal(Object.hasOwn(event, "body"), false);
  assert.equal(Object.hasOwn(event, "query"), false);
  assert.equal(Object.hasOwn(event, "prompt"), false);
  assert.equal(Object.hasOwn(event, "requestId"), false);
});

test("MCP context uses safe unknown values instead of logging arbitrary metadata", () => {
  const context = extractMcpOperationalContext(new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "MCP-Method": "tools/call with a secret prompt",
      "MCP-Name": "../../private file",
    },
  }));

  assert.deepEqual(context, {
    protocol: "unknown",
    method: "unknown",
    tool: "unknown",
    requestId: null,
  });
});

test("MCP operational telemetry emits the distinct 429 and 504 outcomes", () => {
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (line) => warnings.push(JSON.parse(line));
  try {
    for (const [outcome, status] of [["rate_limited", 429], ["deadline_exceeded", 504]]) {
      reportMcpOperationalEvent({
        outcome,
        status,
        durationMs: 7,
        context: { protocol: "unknown", method: "unknown", tool: "unknown", requestId: null },
        activeRequests: 1,
        concurrencyLimit: 8,
      });
    }
  } finally {
    console.warn = previousWarn;
  }

  assert.deepEqual(warnings.map(({ outcome, status }) => ({ outcome, status })), [
    { outcome: "rate_limited", status: 429 },
    { outcome: "deadline_exceeded", status: 504 },
  ]);
});

test("MCP handler errors never log an error message that may contain client input", () => {
  const errors = [];
  const previousError = console.error;
  console.error = (line) => errors.push(line);
  try {
    reportMcpHandlerError(new Error("query=do-not-log-this prompt=also-secret"));
    reportMcpHandlerError(new Error("Rejected inbound request: invalid envelope"));
  } finally {
    console.error = previousError;
  }

  assert.deepEqual(errors, [JSON.stringify({ event: "mcp_handler_error" })]);
  assert.doesNotMatch(errors[0], /query|prompt|do-not-log|also-secret/i);
});

test("MCP operational telemetry emits only the first event per outcome and window", () => {
  const warnings = [];
  const previousWarn = console.warn;
  const previousNow = Date.now;
  let now = 10_000;
  console.warn = (line) => warnings.push(JSON.parse(line));
  Date.now = () => now;
  try {
    for (let index = 0; index < 100; index += 1) {
      reportMcpOperationalEvent({
        outcome: "rate_limited",
        status: 429,
        durationMs: index,
        context: { protocol: "unknown", method: "unknown", tool: "unknown", requestId: null },
        activeRequests: 0,
        concurrencyLimit: 8,
      });
    }
    now = 70_000;
    reportMcpOperationalEvent({
      outcome: "rate_limited",
      status: 429,
      durationMs: 1,
      context: { protocol: "unknown", method: "unknown", tool: "unknown", requestId: null },
      activeRequests: 0,
      concurrencyLimit: 8,
    });
  } finally {
    console.warn = previousWarn;
    Date.now = previousNow;
  }

  assert.equal(warnings.length, 2);
  assert.deepEqual(warnings.map(({ outcome, status }) => ({ outcome, status })), [
    { outcome: "rate_limited", status: 429 },
    { outcome: "rate_limited", status: 429 },
  ]);
});

test("MCP operational throttle has a deterministic bounded key set", () => {
  const throttle = new BoundedOperationalLogThrottle(1_000, { maxKeys: 2 });
  assert.equal(throttle.shouldEmit("first", 100), true);
  assert.equal(throttle.shouldEmit("second", 100), true);
  assert.equal(throttle.shouldEmit("third", 100), true);
  assert.equal(throttle.shouldEmit("second", 100), false);
  assert.equal(throttle.shouldEmit("first", 100), true, "oldest key should have been evicted");
  assert.equal(throttle.shouldEmit("first", 1_100), true, "new window should emit again");
});

test("MCP handler error logging is throttled without retaining error contents", () => {
  const errors = [];
  const previousError = console.error;
  const previousNow = Date.now;
  let now = 20_000;
  console.error = (line) => errors.push(line);
  Date.now = () => now;
  try {
    for (let index = 0; index < 100; index += 1) {
      reportMcpHandlerError(new Error(`secret-${index}`));
    }
    now = 80_000;
    reportMcpHandlerError(new Error("secret-next-window"));
  } finally {
    console.error = previousError;
    Date.now = previousNow;
  }

  assert.deepEqual(errors, [
    JSON.stringify({ event: "mcp_handler_error" }),
    JSON.stringify({ event: "mcp_handler_error" }),
  ]);
  assert.doesNotMatch(errors.join(" "), /secret/i);
});
