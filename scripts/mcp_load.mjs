import assert from "node:assert/strict";
import { successfulMcpToolResult } from "./mcp_test_helpers.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = option(name, String(fallback));
  assert.match(raw, /^\d+$/, `--${name} deve essere un intero`);
  const value = Number(raw);
  assert.ok(value >= minimum && value <= maximum, `--${name} deve essere ${minimum}..${maximum}`);
  return value;
}

const urlValue = option("url", "http://127.0.0.1:3000/api/mcp");
const endpoint = new URL(urlValue);
assert.ok(["http:", "https:"].includes(endpoint.protocol), "--url deve usare HTTP(S)");
assert.equal(endpoint.pathname, "/api/mcp", "--url deve puntare esattamente a /api/mcp");

const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
if (!loopback) {
  assert.ok(
    process.argv.includes("--allow-remote") && process.env.MCP_LOAD_ALLOW_REMOTE === "1",
    "I test remoti richiedono --allow-remote e MCP_LOAD_ALLOW_REMOTE=1",
  );
}

// The normal smoke/load default stays below the public 30 POST/min/IP cap.
// Higher explicit values are still useful when testing an expected 429.
const requests = boundedInteger("requests", 20, 1, 500);
const concurrency = boundedInteger("concurrency", 6, 1, 25);
const p95BudgetMs = boundedInteger("p95-ms", 3_000, 100, 30_000);
const maxBytes = boundedInteger("max-bytes", 750_000, 10_000, 1_000_000);
const durations = [];
const failures = [];
let cursor = 0;

const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

const scenarios = [
  { name: "regional-overview", arguments: { level: "region", limit: 20 } },
  { name: "province-filter", arguments: { level: "province", region: "Lazio", limit: 100 } },
  { name: "municipality-search", arguments: { level: "municipality", query: "a", limit: 100 } },
  { name: "municipality-page", arguments: { level: "municipality", region: "Lombardia", limit: 100, offset: 100 } },
  { name: "suppressed-value", arguments: { level: "municipality", code: "001019", limit: 1 } },
];

function assertScenario(data, scenario) {
  assert.equal(data.dataset, "mef_irpef_comunale");
  assert.equal(data.level, scenario.arguments.level);
  assert.ok(Array.isArray(data.data));
  assert.ok(data.data.length > 0, `${scenario.name}: nessun record restituito`);

  if (scenario.name === "municipality-page") {
    assert.equal(data.pagination.offset, 100);
    assert.equal(data.pagination.returned, 100);
  } else if (scenario.name === "suppressed-value") {
    assert.equal(data.data[0].territory.code, "001019");
    assert.equal(data.data[0].measures.municipalSurtaxDue.coverage, "partial");
  }
}

async function waitForEndpoint() {
  const healthUrl = new URL("/territori/irpef", endpoint);
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Endpoint non pronto: ${lastError instanceof Error ? lastError.message : "errore sconosciuto"}`,
  );
}

async function runOne(index) {
  const startedAt = performance.now();
  const scenario = scenarios[index % scenarios.length];
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "MCP-Method": "tools/call",
        "MCP-Name": "query_dataset",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: index + 1,
        method: "tools/call",
        params: {
          _meta: meta,
          name: "query_dataset",
          arguments: { dataset: "mef_irpef_comunale", ...scenario.arguments },
        },
      }),
      signal: AbortSignal.timeout(Math.max(10_000, p95BudgetMs * 3)),
    });
    const body = await response.text();
    const bytes = new TextEncoder().encode(body).byteLength;
    assert.equal(response.status, 200, `HTTP ${response.status}`);
    assert.ok(bytes <= maxBytes, `Risposta di ${bytes} byte oltre il limite ${maxBytes}`);
    const toolResult = successfulMcpToolResult(body, "mef_irpef_comunale", {
      requireComplete: true,
    });
    assertScenario(toolResult.data, scenario);
    durations.push({ durationMs: performance.now() - startedAt, scenario: scenario.name });
  } catch (error) {
    failures.push({
      index,
      scenario: scenario.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= requests) return;
    await runOne(index);
  }
}

await waitForEndpoint();
const wallStartedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
const wallMs = performance.now() - wallStartedAt;

const sortedDurations = durations.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
const percentile = (fraction) => sortedDurations[Math.max(0, Math.ceil(sortedDurations.length * fraction) - 1)] ?? Infinity;
const scenarioCounts = Object.fromEntries(
  scenarios.map(({ name }) => [name, durations.filter((sample) => sample.scenario === name).length]),
);
const summary = {
  endpoint: endpoint.origin,
  requests,
  concurrency,
  succeeded: durations.length,
  failed: failures.length,
  wallMs: Math.round(wallMs),
  requestsPerSecond: Number((durations.length / (wallMs / 1_000)).toFixed(2)),
  latencyMs: {
    p50: Math.round(percentile(0.5)),
    p95: Math.round(percentile(0.95)),
    max: Math.round(percentile(1)),
    budgetP95: p95BudgetMs,
  },
  scenarios: scenarioCounts,
  failures: failures.slice(0, 5),
};

console.log(JSON.stringify(summary, null, 2));
assert.equal(failures.length, 0, "Il load test contiene richieste fallite");
assert.ok(percentile(0.95) <= p95BudgetMs, `p95 oltre budget: ${Math.round(percentile(0.95))}ms`);
