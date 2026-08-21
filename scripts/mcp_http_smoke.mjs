import assert from "node:assert/strict";
import { successfulMcpToolResult } from "./mcp_test_helpers.mjs";

const baseUrl = new URL(process.env.DVNS_BASE_URL ?? "http://127.0.0.1:3000");
const MAX_RESPONSE_BYTES = 750_000;

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

async function responseText(response, label) {
  const body = await response.text();
  assert.ok(
    byteLength(body) <= MAX_RESPONSE_BYTES,
    `${label}: risposta oltre ${MAX_RESPONSE_BYTES} byte`,
  );
  return body;
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/territori/irpef", baseUrl), {
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
  throw new Error(`Server non pronto: ${lastError instanceof Error ? lastError.message : "errore"}`);
}

async function mcpRequest(body, headers = {}) {
  const response = await fetch(new URL("/api/mcp", baseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await responseText(response, `MCP ${body.method}`);
  assert.equal(response.status, 200, text.slice(0, 500));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return text;
}

await waitForServer();

const pageResponse = await fetch(new URL("/territori/irpef", baseUrl), {
  signal: AbortSignal.timeout(10_000),
});
const page = await responseText(pageResponse, "pagina IRPEF");
assert.equal(pageResponse.status, 200);
assert.match(page, /Imposta netta dichiarata/i);

const apiResponse = await fetch(new URL("/api/territori/irpef?anno=2024&livello=regione", baseUrl), {
  signal: AbortSignal.timeout(10_000),
});
const api = await responseText(apiResponse, "API IRPEF");
assert.equal(apiResponse.status, 200);
assert.match(api, /"taxYear":2024/);
assert.match(api, /netTaxDeclared/);

const legacyTools = await mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
assert.match(legacyTools, /list_datasets/);
assert.match(legacyTools, /query_dataset/);

const legacyDataset = await mcpRequest({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: { dataset: "mef_irpef_comunale", level: "region", limit: 20 },
  },
});
assert.match(legacyDataset, /mef_irpef_comunale/);
assert.match(legacyDataset, /Imposta netta dichiarata/i);
const legacyData = successfulMcpToolResult(legacyDataset, "mef_irpef_comunale").data;
assert.equal(legacyData.level, "region");
assert.equal(legacyData.pagination.returned, 20);

const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};
const modernDiscovery = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 3,
    method: "server/discover",
    params: { _meta: meta },
  },
  { "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "server/discover" },
);
assert.match(modernDiscovery, /2026-07-28/);
assert.match(modernDiscovery, /"resultType":"complete"/);

const modernDataset = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      _meta: meta,
      name: "query_dataset",
      arguments: { dataset: "mef_irpef_comunale", level: "region", limit: 20 },
    },
  },
  {
    "MCP-Protocol-Version": "2026-07-28",
    "MCP-Method": "tools/call",
    "MCP-Name": "query_dataset",
  },
);
assert.match(modernDataset, /"resultType":"complete"/);
assert.match(modernDataset, /mef_irpef_comunale/);
const modernData = successfulMcpToolResult(modernDataset, "mef_irpef_comunale", {
  requireComplete: true,
}).data;
assert.equal(modernData.level, "region");
assert.equal(modernData.pagination.returned, 20);

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.origin,
  checks: ["page", "api", "legacy-tools", "legacy-query", "modern-discovery", "modern-query"],
}));
