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

async function mcpRequest(
  body,
  headers = {},
  pathname = "/api/mcp",
  expectedContentType = /(?:application\/json|text\/event-stream)/,
) {
  const response = await fetch(new URL(pathname, baseUrl), {
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
  assert.match(response.headers.get("content-type") ?? "", expectedContentType);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.url, new URL(pathname, baseUrl).href, "MCP alias must not redirect");
  return text;
}

await waitForServer();

const pageResponse = await fetch(new URL("/territori/irpef", baseUrl), {
  signal: AbortSignal.timeout(10_000),
});
const page = await responseText(pageResponse, "pagina IRPEF");
assert.equal(pageResponse.status, 200);
assert.match(page, /Imposta netta dichiarata/i);

const mcpPageResponse = await fetch(new URL("/mcp", baseUrl), {
  signal: AbortSignal.timeout(10_000),
});
const mcpPage = await responseText(mcpPageResponse, "pagina MCP");
assert.equal(mcpPageResponse.status, 200);
assert.match(mcpPageResponse.headers.get("content-type") ?? "", /text\/html/);
assert.match(mcpPage, /Endpoint Streamable HTTP/i);
assert.match(mcpPage, /\/api\/mcp/);

const sseGetResponse = await fetch(new URL("/mcp", baseUrl), {
  headers: { Accept: "text/event-stream" },
  signal: AbortSignal.timeout(10_000),
});
assert.equal(sseGetResponse.status, 405);
assert.equal(sseGetResponse.headers.get("allow"), "POST, OPTIONS, HEAD");
assert.equal(sseGetResponse.headers.get("cache-control"), "private, no-store");
assert.match(sseGetResponse.headers.get("content-type") ?? "", /application\/json/);

const headResponse = await fetch(new URL("/mcp", baseUrl), {
  method: "HEAD",
  signal: AbortSignal.timeout(10_000),
});
assert.equal(headResponse.status, 204);
assert.equal(headResponse.headers.get("allow"), "POST, OPTIONS, HEAD");
assert.equal(headResponse.headers.get("cache-control"), "private, no-store");

const allowedPreflight = await fetch(new URL("/mcp", baseUrl), {
  method: "OPTIONS",
  headers: {
    Origin: baseUrl.origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
  },
  signal: AbortSignal.timeout(10_000),
});
assert.equal(allowedPreflight.status, 204);
assert.equal(allowedPreflight.headers.get("cache-control"), "private, no-store");
assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), baseUrl.origin);
assert.match(allowedPreflight.headers.get("access-control-allow-methods") ?? "", /POST/);
assert.match(
  allowedPreflight.headers.get("access-control-allow-headers") ?? "",
  /MCP-Protocol-Version/i,
);

const rejectedPreflight = await fetch(new URL("/mcp", baseUrl), {
  method: "OPTIONS",
  headers: { Origin: "https://attacker.invalid" },
  signal: AbortSignal.timeout(10_000),
});
assert.equal(rejectedPreflight.status, 403);
assert.equal(rejectedPreflight.headers.get("access-control-allow-origin"), null);

const oversizedAlias = await fetch(new URL("/mcp", baseUrl), {
  method: "POST",
  headers: {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  },
  body: "x".repeat(1_000_001),
  signal: AbortSignal.timeout(10_000),
});
assert.equal(oversizedAlias.status, 413);
assert.equal(oversizedAlias.headers.get("cache-control"), "private, no-store");

const apiResponse = await fetch(new URL("/api/territori/irpef?anno=2024&livello=regione", baseUrl), {
  signal: AbortSignal.timeout(10_000),
});
const api = await responseText(apiResponse, "API IRPEF");
assert.equal(apiResponse.status, 200);
assert.match(api, /"taxYear":2024/);
assert.match(api, /netTaxDeclared/);

const pnrrApiResponse = await fetch(new URL("/api/pnrr/asili?cup=B11B21001610005", baseUrl), {
  signal: AbortSignal.timeout(10_000),
});
const pnrrApi = await responseText(pnrrApiResponse, "API PNRR asili");
assert.equal(pnrrApiResponse.status, 200);
assert.match(pnrrApi, /"dataset":"pnrr_asili"/);
assert.match(pnrrApi, /"cup":"B11B21001610005"/);

const legacyTools = await mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
assert.match(legacyTools, /list_datasets/);
assert.match(legacyTools, /query_dataset/);

const compatibilityTools = await mcpRequest(
  { jsonrpc: "2.0", id: 11, method: "tools/list" },
  {},
  "/mcp",
  /text\/event-stream/,
);
assert.match(compatibilityTools, /list_datasets/);
assert.match(compatibilityTools, /query_dataset/);

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
assert.ok(legacyData.data.every((row) => row.breakdowns === undefined));

for (const [index, mission] of [
  "Istruzione universitaria e formazione post-universitaria",
  "Ricerca e innovazione",
].entries()) {
  const response = await mcpRequest({
    jsonrpc: "2.0", id: 40 + index, method: "tools/call",
    params: { name: "query_dataset", arguments: { dataset: "openbdap_legge_bilancio_storico", years: 10, mission } },
  });
  const { data } = successfulMcpToolResult(response, "openbdap_legge_bilancio_storico");
  assert.deepEqual(data.missions, [mission]);
  assert.equal(data.allocations.length, 10);
  assert.equal(data.yearOverYearDeltas.length, 9);
  assert.equal(data.dataMode, "snapshot");
}
const invalidMission = await mcpRequest({
  jsonrpc: "2.0", id: 42, method: "tools/call",
  params: { name: "query_dataset", arguments: { dataset: "openbdap_legge_bilancio_storico", mission: "Ricerca" } },
});
assert.match(invalidMission, /"isError":true/);
assert.match(invalidMission, /Missione non disponibile/);

const detailedIrpefDataset = await mcpRequest({
  jsonrpc: "2.0",
  id: 25,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: {
      dataset: "mef_irpef_comunale",
      year: 2024,
      level: "municipality",
      region: "Lombardia",
      detail: "all",
      limit: 100,
    },
  },
});
const detailedIrpefData = successfulMcpToolResult(
  detailedIrpefDataset,
  "mef_irpef_comunale",
).data;
assert.equal(detailedIrpefData.query.detail, "all");
assert.equal(detailedIrpefData.pagination.returned, 100);
assert.ok(detailedIrpefData.data.every((row) =>
  Object.keys(row.breakdowns.incomeSources).length === 7
  && Object.keys(row.breakdowns.incomeBands).length === 8
));
assert.ok(detailedIrpefData.data.every((row) => {
  const measure = row.breakdowns.incomeBands.nonPositiveComprehensiveIncome;
  return (measure.amountCents ?? measure.knownAmountCents) <= 0;
}));
assert.match(detailedIrpefData.caveats.join(" "), /non è il gettito fiscale totale/i);
assert.match(detailedIrpefData.caveats.join(" "), /fonti di reddito si sovrappongono/i);

const unsupportedDetailDataset = await mcpRequest({
  jsonrpc: "2.0",
  id: 26,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: { dataset: "siope_comuni", detail: "all" },
  },
});
assert.match(unsupportedDetailDataset, /"isError":true/);
assert.match(unsupportedDetailDataset, /Filtri non supportati[^\n]*detail/);

const pnrrDataset = await mcpRequest({
  jsonrpc: "2.0",
  id: 21,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: { dataset: "pnrr_asili", cup: "B11B21001610005" },
  },
});
const pnrrData = successfulMcpToolResult(pnrrDataset, "pnrr_asili").data;
assert.equal(pnrrData.pagination.total, 1);
assert.equal(pnrrData.data[0].cup, "B11B21001610005");
assert.match(pnrrData.methodology.fundingWarning, /non è un pagamento osservato/i);

const integratedDataset = await mcpRequest({
  jsonrpc: "2.0",
  id: 22,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: {
      dataset: "spesa_pa_dettaglio",
      code: "consulenze-legali",
      query: "2024",
      limit: 5,
    },
  },
});
const integratedData = successfulMcpToolResult(
  integratedDataset,
  "spesa_pa_dettaglio",
).data;
assert.equal(integratedData.dataset.id, "consulenze-legali");
assert.equal(integratedData.limit, 5);
assert.ok(integratedData.rows.length > 0 && integratedData.rows.length <= 5);
assert.equal(integratedData.matchedRows, null);
assert.equal(typeof integratedData.pagination.nextCursor, "string");

const educationDataset = await mcpRequest({
  jsonrpc: "2.0",
  id: 23,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: {
      dataset: "education_students_by_pathway",
      period: "202425",
      schoolType: "state",
      pathway: "SCIENTIFICO",
      limit: 2,
      offset: 0,
    },
  },
});
const educationData = successfulMcpToolResult(
  educationDataset,
  "education_students_by_pathway",
).data;
assert.equal(educationData.dataset, "education_students_by_pathway");
assert.equal(educationData.query.period, "202425");
assert.equal(educationData.query.schoolType, "state");
assert.equal(educationData.query.pathway, "SCIENTIFICO");
assert.equal(educationData.pagination.offset, 0);
assert.equal(educationData.pagination.limit, 2);
assert.equal(educationData.pagination.returned, 2);
assert.ok(educationData.pagination.total > educationData.pagination.returned);
assert.equal(educationData.pagination.nextOffset, 2);
assert.equal(educationData.data.length, 2);
assert.ok(educationData.data.every((row) =>
  row.period === "202425"
  && row.schoolType === "state"
  && row.pathwayCode === "SCIENTIFICO"
  && row.studentCount === row.maleCount + row.femaleCount
));
assert.equal(educationData.provenance.length, 12);
assert.ok(educationData.provenance.every((source) =>
  typeof source.url === "string"
  && typeof source.publishedAt === "string"
  && typeof source.dataAsOf === "string"
  && /^[a-f0-9]{64}$/.test(source.sha256)
  && Number.isInteger(source.bytes)
  && Number.isInteger(source.rows)
));
assert.ok(educationData.sources.every((source) =>
  source.license === "IODL 2.0"
  && source.licenseUrl === "http://www.dati.gov.it/iodl/2.0/"
));
assert.match(educationData.caveat, /non misurano qualità/i);

const educationNextPage = await mcpRequest({
  jsonrpc: "2.0",
  id: 24,
  method: "tools/call",
  params: {
    name: "query_dataset",
    arguments: {
      dataset: "education_students_by_pathway",
      period: "202425",
      schoolType: "state",
      pathway: "SCIENTIFICO",
      limit: 2,
      offset: educationData.pagination.nextOffset,
    },
  },
});
const educationNextData = successfulMcpToolResult(
  educationNextPage,
  "education_students_by_pathway",
).data;
assert.equal(educationNextData.pagination.offset, 2);
assert.equal(educationNextData.pagination.returned, 2);
assert.notDeepEqual(educationNextData.data, educationData.data);

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

const compatibilityDiscovery = await mcpRequest(
  {
    jsonrpc: "2.0",
    id: 31,
    method: "server/discover",
    params: { _meta: meta },
  },
  { "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "server/discover" },
  "/mcp",
);
assert.match(compatibilityDiscovery, /2026-07-28/);
assert.match(compatibilityDiscovery, /"resultType":"complete"/);

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
  checks: [
    "page",
    "mcp-page",
    "mcp-sse-get",
    "api",
    "mcp-alias-preflight",
    "mcp-alias-security",
    "legacy-tools",
    "compatibility-tools",
    "legacy-query",
    "irpef-detail-query-budget-caveats",
    "unsupported-detail-filter",
    "integrated-query",
    "education-query-pagination-provenance",
    "modern-discovery",
    "compatibility-modern-discovery",
    "modern-query",
  ],
}));
