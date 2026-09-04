import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

process.env.MCP_ALLOWED_HOSTS = [process.env.MCP_ALLOWED_HOSTS, "example.test"]
  .filter(Boolean)
  .join(",");

const { GET, HEAD, OPTIONS, POST, maxDuration } = await import("../src/app/api/mcp/route.ts");
const { dvnsStarterPrompts } = await import("../src/lib/mcp/server.ts");
const loader = await import("../src/lib/integrated-sources.ts");
let requestAddressSequence = 1;

const requestBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const expectedServerInfo = {
  name: "dove-vanno-i-nostri-soldi",
  title: "DoveVannoINostriSoldi",
  version: "0.2.0",
  websiteUrl: "https://www.dovevannoinostrisoldi.com",
  description:
    "Accesso read-only a dati pubblici italiani verificati, con fonti, periodi, copertura e caveat espliciti.",
  icons: [
    {
      src: "https://www.dovevannoinostrisoldi.com/brand/icon-192.png",
      mimeType: "image/png",
      sizes: ["192x192"],
    },
    {
      src: "https://www.dovevannoinostrisoldi.com/brand/icon-512.png",
      mimeType: "image/png",
      sizes: ["512x512"],
    },
    {
      src: "https://www.dovevannoinostrisoldi.com/brand/icon-1024.png",
      mimeType: "image/png",
      sizes: ["1024x1024"],
    },
  ],
};

function request(headers = {}, body = requestBody) {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Forwarded-For": `203.0.113.${(requestAddressSequence++ % 200) + 1}`,
      ...headers,
    },
    body,
  });
}

function parseRpcEvent(body) {
  const dataLine = body.split(/\r?\n/).find((line) => line.startsWith("data: "));
  assert.ok(dataLine, "expected an SSE data frame");
  return JSON.parse(dataLine.slice("data: ".length));
}

test("MCP endpoint rejects an untrusted browser origin", async () => {
  const response = await POST(request({ Origin: "https://attacker.test" }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("MCP endpoint fails closed when the client address is unavailable", async () => {
  const { POST: anonymousPost } = await import(
    `../src/app/api/mcp/route.ts?anonymous-rate-limit=${Date.now()}`
  );
  const anonymousRequest = () => request({ "X-Forwarded-For": "not-an-address" }, JSON.stringify({
    jsonrpc: "2.0",
    id: "anonymous-rate-limit",
    method: "tools/list",
  }));

  for (let index = 0; index < 30; index += 1) {
    const response = await anonymousPost(anonymousRequest());
    assert.equal(response.status, 200);
  }

  const limited = await anonymousPost(anonymousRequest());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(await limited.json(), {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Troppe richieste. Riprova tra un minuto." },
    id: null,
  });
});

test("MCP endpoint answers browser preflight only for an allowed origin", async () => {
  const response = OPTIONS(new Request("https://example.test/api/mcp", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://example.test");
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.match(response.headers.get("access-control-allow-headers"), /MCP-Protocol-Version/i);
  assert.match(response.headers.get("vary"), /Origin/);

  const rejected = OPTIONS(new Request("https://example.test/api/mcp", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.test" },
  }));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});

test("MCP endpoint preserves CORS across an internal same-origin rewrite", () => {
  const response = OPTIONS(new Request("http://localhost:3210/api/mcp", {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:3210",
      "Access-Control-Request-Method": "POST",
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:3210");

  const differentPort = OPTIONS(new Request("http://localhost:3210/api/mcp", {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:3211",
      "Access-Control-Request-Method": "POST",
    },
  }));
  assert.equal(differentPort.status, 403);
  assert.equal(differentPort.headers.get("access-control-allow-origin"), null);

  for (const origin of ["https://127.0.0.1:3210", "http://attacker.invalid"]) {
    const rejected = OPTIONS(new Request("http://localhost:3210/api/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    }));
    assert.equal(rejected.status, 403, origin);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null, origin);
  }
});

test("MCP endpoint rejects optional SSE GET without returning cacheable HTML", async () => {
  const response = GET(new Request("https://example.test/api/mcp", {
    headers: { Accept: "text/event-stream" },
  }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS, HEAD");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.match(await response.text(), /Streamable HTTP tramite POST/);
});

test("MCP endpoint answers HEAD probes without starting a tool exchange", async () => {
  const response = HEAD(new Request("https://example.test/api/mcp", { method: "HEAD" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS, HEAD");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "");
});

test("MCP endpoint enforces an explicit host allowlist", async () => {
  const previous = process.env.MCP_ALLOWED_HOSTS;
  process.env.MCP_ALLOWED_HOSTS = "mcp.example.test";
  try {
    const rejected = await POST(request());
    assert.equal(rejected.status, 403);
    assert.match(await rejected.text(), /Host non consentito/);

    const accepted = await POST(new Request("https://mcp.example.test/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: requestBody,
    }));
    assert.equal(accepted.status, 200);
  } finally {
    if (previous === undefined) delete process.env.MCP_ALLOWED_HOSTS;
    else process.env.MCP_ALLOWED_HOSTS = previous;
  }
});

test("MCP endpoint fails closed for a public host when no host allowlist is configured", async () => {
  const previous = {
    allowedHosts: process.env.MCP_ALLOWED_HOSTS,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    deploymentUrl: process.env.VERCEL_URL,
  };
  delete process.env.MCP_ALLOWED_HOSTS;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  try {
    const response = await POST(new Request("https://attacker-rebind.test/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "attacker-rebind.test",
        Origin: "https://attacker-rebind.test",
      },
      body: requestBody,
    }));
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Host non consentito/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    if (previous.allowedHosts === undefined) delete process.env.MCP_ALLOWED_HOSTS;
    else process.env.MCP_ALLOWED_HOSTS = previous.allowedHosts;
    if (previous.productionUrl === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = previous.productionUrl;
    if (previous.deploymentUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previous.deploymentUrl;
  }
});

test("MCP endpoint does not trust a client supplied forwarded host", async () => {
  const previous = process.env.MCP_ALLOWED_HOSTS;
  process.env.MCP_ALLOWED_HOSTS = "mcp.example.test";
  try {
    const response = await POST(new Request("https://evil.test/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "evil.test",
        "X-Forwarded-Host": "mcp.example.test",
      },
      body: requestBody,
    }));
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Host non consentito/);
  } finally {
    if (previous === undefined) delete process.env.MCP_ALLOWED_HOSTS;
    else process.env.MCP_ALLOWED_HOSTS = previous;
  }
});

test("MCP endpoint accepts the exact loopback host shown by the local UI", async () => {
  const previous = process.env.VERCEL_URL;
  process.env.VERCEL_URL = "production.example.test";
  try {
    const loopbacks = [
      ["http://localhost:3210/api/mcp", "127.0.0.1:3210"],
      ["http://127.0.0.1:3210/api/mcp", "127.0.0.1:3210"],
      ["http://[::1]:3210/api/mcp", "[::1]:3210"],
    ];
    for (const [url, host] of loopbacks) {
      const response = await POST(new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Host: host,
        },
        body: requestBody,
      }));
      assert.equal(response.status, 200, host);
      assert.match(await response.text(), /query_dataset/);
    }
  } finally {
    if (previous === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previous;
  }
});

test("MCP endpoint does not accept a loopback Host header on a public URL", async () => {
  const previous = process.env.MCP_ALLOWED_HOSTS;
  process.env.MCP_ALLOWED_HOSTS = "production.example.test";
  try {
    const response = await POST(new Request("https://production.example.test/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "127.0.0.1:3210",
      },
      body: requestBody,
    }));
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Host non consentito/);
  } finally {
    if (previous === undefined) delete process.env.MCP_ALLOWED_HOSTS;
    else process.env.MCP_ALLOWED_HOSTS = previous;
  }
});

test("MCP route aborts before the Vercel 60-second runtime bill", () => {
  assert.equal(maxDuration, 15);
});

test("MCP endpoint rejects an oversized declared body", async () => {
  const response = await POST(request({ "Content-Length": "1000001" }));
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("MCP endpoint enforces the body limit when Content-Length is absent", async () => {
  const response = await POST(request({}, "x".repeat(1_000_001)));
  assert.equal(response.status, 413);
});

test("MCP endpoint converts a broken request stream into a controlled response", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new Error("synthetic disconnect"));
    },
  });
  const response = await POST(new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  }));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /interrotta o non leggibile/);
});

test("MCP endpoint exposes the read-only tools over Streamable HTTP", async () => {
  const response = await POST(request({ Origin: "https://example.test" }));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /list_datasets/);
  assert.match(body, /query_dataset/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("MCP query tool describes every input parameter for clients and directories", async () => {
  const response = await POST(request({ Origin: "https://example.test" }));
  const rpcEvent = parseRpcEvent(await response.text());
  const queryTool = rpcEvent.result.tools.find((tool) => tool.name === "query_dataset");
  assert.ok(queryTool, "query_dataset tool missing");
  assert.deepEqual(queryTool.securitySchemes, [{ type: "noauth" }]);
  assert.deepEqual(queryTool._meta?.securitySchemes, [{ type: "noauth" }]);
  assert.equal(queryTool.outputSchema?.type, "object");
  assert.deepEqual(queryTool.outputSchema?.required, ["ok", "dataset"]);
  const properties = queryTool.inputSchema?.properties;
  assert.ok(properties && Object.keys(properties).length > 0, "query_dataset properties missing");
  assert.deepEqual(Object.keys(properties), [
    "dataset",
    "year",
    "month",
    "query",
    "region",
    "province",
    "level",
    "detail",
    "code",
    "cup",
    "area",
    "chamber",
    "channel",
    "country",
    "territory",
    "table",
    "measure",
    "cofog",
    "period",
    "sector",
    "band",
    "years",
    "mission",
    "schoolType",
    "pathway",
    "limit",
    "offset",
    "cursor",
  ]);
  for (const [name, schema] of Object.entries(properties)) {
    assert.equal(
      typeof schema.description === "string" && schema.description.trim().length > 0,
      true,
      `${name} is missing a non-empty description`,
    );
  }
});

test("MCP list tool declares no-auth access and a structured output contract", async () => {
  const response = await POST(request({ Origin: "https://example.test" }));
  const rpcEvent = parseRpcEvent(await response.text());
  const listTool = rpcEvent.result.tools.find((tool) => tool.name === "list_datasets");
  assert.ok(listTool, "list_datasets tool missing");
  assert.deepEqual(listTool.securitySchemes, [{ type: "noauth" }]);
  assert.deepEqual(listTool._meta?.securitySchemes, [{ type: "noauth" }]);
  assert.equal(listTool.outputSchema?.type, "object");
  assert.deepEqual(
    listTool.outputSchema?.required,
    ["datasets", "relatedMcpServices"],
  );
});

test("MCP tools declare consistent read-only annotations (Manufact tool-hints-present)", async () => {
  const response = await POST(request({ Origin: "https://example.test" }));
  const rpcEvent = parseRpcEvent(await response.text());
  for (const name of ["list_datasets", "query_dataset"]) {
    const tool = rpcEvent.result.tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} tool missing`);
    assert.equal(tool.annotations?.readOnlyHint, true, `${name} must remain read-only`);
    assert.equal(
      tool.annotations?.openWorldHint,
      false,
      `${name} reads internal sources only: openWorldHint true contradicts readOnlyHint`,
    );
    assert.equal(tool.annotations?.destructiveHint, false, `${name} must not be destructive`);
  }
});

test("MCP endpoint exposes the machine-readable dataset catalog resource", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/list",
  })));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /dvns:\/\/datasets/);
  assert.match(body, /dataset-catalog/);
  assert.match(body, /dvns:\/\/related-mcp-services/);
  assert.match(body, /related-mcp-services/);
});

test("MCP endpoint exposes related public services without proxying them", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    method: "resources/read",
    params: { uri: "dvns://related-mcp-services" },
  })));
  const body = await response.text();
  const rpcEvent = parseRpcEvent(body);
  const services = JSON.parse(rpcEvent.result.contents[0].text);
  assert.equal(response.status, 200);
  assert.equal(services[0].endpoint, "https://cruscotto-italia-mcp.agid.workers.dev/mcp");
  assert.equal(services[0].proxiedByDvns, false);
});

test("MCP endpoint supports the modern 2026 protocol envelope", async () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const response = await POST(request(
    { "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "tools/list" },
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: { _meta: meta },
    }),
  ));
  const body = await response.text();
  const rpcResponse = JSON.parse(body);
  assert.equal(response.status, 200);
  assert.match(body, /"resultType":"complete"/);
  assert.match(body, /list_datasets/);
  for (const tool of rpcResponse.result.tools) {
    assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }]);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "noauth" }]);
  }
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("MCP initialize advertises complete publishing metadata", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 11,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "publishing-check", version: "1.0.0" },
    },
  })));
  const rpcEvent = parseRpcEvent(await response.text());
  assert.equal(response.status, 200);
  assert.deepEqual(rpcEvent.result.serverInfo, expectedServerInfo);
});

test("MCP prompts/list mirrors the documented starter prompts", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 12,
    method: "prompts/list",
  })));
  const rpcEvent = parseRpcEvent(await response.text());
  assert.equal(response.status, 200);
  assert.equal(rpcEvent.result.prompts.length, dvnsStarterPrompts.length);
  const names = new Set(rpcEvent.result.prompts.map((prompt) => prompt.name));
  for (const spec of dvnsStarterPrompts) {
    assert.ok(names.has(spec.name), `prompt mancante: ${spec.name}`);
  }
  for (const prompt of rpcEvent.result.prompts) {
    assert.equal(typeof prompt.description, "string");
    assert.ok(prompt.description.length > 0);
  }
});

test("MCP prompts/get returns the exact documented starter message", async () => {
  const spec = dvnsStarterPrompts[0];
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 13,
    method: "prompts/get",
    params: { name: spec.name },
  })));
  const rpcEvent = parseRpcEvent(await response.text());
  assert.equal(response.status, 200);
  const message = rpcEvent.result.messages[0];
  assert.equal(message.role, "user");
  assert.equal(message.content.type, "text");
  assert.equal(message.content.text, spec.message);
});

test("MCP prompts/get rejects an unknown prompt name", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 14,
    method: "prompts/get",
    params: { name: "prompt_inesistente" },
  })));
  const rpcEvent = parseRpcEvent(await response.text());
  assert.equal(response.status, 200);
  assert.ok(rpcEvent.result === undefined);
  assert.ok(typeof rpcEvent.error?.message === "string");
});

test("MCP endpoint supports 2026 server discovery", async () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const response = await POST(request(
    { "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "server/discover" },
    JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "server/discover",
      params: { _meta: meta },
    }),
  ));
  const body = await response.text();
  const rpcEvent = JSON.parse(body);
  assert.equal(response.status, 200);
  assert.match(body, /2026-07-28/);
  assert.deepEqual(
    rpcEvent.result._meta["io.modelcontextprotocol/serverInfo"],
    expectedServerInfo,
  );
  assert.match(body, /"resultType":"complete"/);
});

test("MCP endpoint executes a modern tool call with mirrored request headers", async () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const response = await POST(request(
    {
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "tools/call",
      "MCP-Name": "query_dataset",
    },
    JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        _meta: meta,
        name: "query_dataset",
        arguments: { dataset: "registro_fonti", query: "SIOPE" },
      },
    }),
  ));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"resultType":"complete"/);
  assert.match(body, /SIOPE \/ SIOPE\+/);
});

test("MCP query cancellation reaches the bounded dataset loader", async () => {
  loader.resetIntegratedDatasetLoaderDiagnosticsForTests();
  const controller = new AbortController();
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const pending = POST(new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "tools/call",
      "MCP-Name": "query_dataset",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        _meta: meta,
        name: "query_dataset",
        arguments: {
          dataset: "spesa_pa_dettaglio",
          code: "parti-atti",
          query: "query-sintetica-che-non-puo-comparire-9f52f21e",
          limit: 100,
        },
      },
    }),
    signal: controller.signal,
  }));

  const observationDeadline = Date.now() + 2_000;
  while (true) {
    const diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
    if (diagnostics.activeLoads > 0 || diagnostics.completedChunkLoads > 0) break;
    assert.ok(Date.now() < observationDeadline, "dataset query did not start in time");
    await new Promise((resolve) => setImmediate(resolve));
  }

  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  await response.text();

  const cleanupDeadline = Date.now() + 2_000;
  let diagnostics;
  while (true) {
    diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
    if (
      diagnostics.activeLoads === 0 &&
      diagnostics.queuedLoads === 0 &&
      diagnostics.inFlightChunkKeys.length === 0
    ) break;
    assert.ok(Date.now() < cleanupDeadline, "cancelled dataset query did not clean up in time");
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.ok(diagnostics.completedChunkLoads < 8, diagnostics);
  assert.equal(diagnostics.activeLoads, 0);
  assert.equal(diagnostics.queuedLoads, 0);
  assert.deepEqual(diagnostics.inFlightChunkKeys, []);
});

test("MCP endpoint rejects filters unsupported by the selected dataset", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "query_dataset",
      arguments: { dataset: "opencoesione_progetti", year: 2025 },
    },
  })));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Filtri non supportati/);
  assert.match(body, /year/);
});

test("MCP legacy tool call exposes bounded MEF IRPEF records and suppression", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: {
      name: "query_dataset",
      arguments: {
        dataset: "mef_irpef_comunale",
        year: 2024,
        level: "municipality",
        code: "001019",
      },
    },
  })));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /mef_irpef_comunale/);
  assert.match(body, /BALME/);
  assert.match(body, /partial/);
  assert.match(body, /suppressedRows/);
});

test("MCP modern 2026 tool call exposes the same MEF domain result", async () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const response = await POST(request(
    {
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "tools/call",
      "MCP-Name": "query_dataset",
    },
    JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        _meta: meta,
        name: "query_dataset",
        arguments: {
          dataset: "mef_irpef_comunale",
          year: 2024,
          level: "municipality",
          code: "028001",
          detail: "all",
        },
      },
    }),
  ));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"resultType":"complete"/);
  assert.match(body, /mef_irpef_comunale/);
  assert.match(body, /ABANO TERME/);
  assert.match(body, /netTaxDeclared/);
  assert.match(body, /incomeSources/);
  assert.match(body, /incomeBands/);
  assert.match(body, /nonPositiveComprehensiveIncome/);
  assert.match(body, /-1185700/);
});

test("MCP tool call exposes the Legge di Bilancio mission series with the years filter", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    throw new Error(`L'MCP snapshot non deve effettuare fetch live: ${input.toString()}`);
  };

  try {
    const response = await POST(request({}, JSON.stringify({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "query_dataset",
        arguments: { dataset: "openbdap_legge_bilancio_storico", years: 2 },
      },
    })));
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /openbdap_legge_bilancio_storico/);
    assert.match(body, /"dataMode":"snapshot"/);
    assert.match(body, /"years":\[2025,2026\]/);
    assert.match(body, /"missions":\[/);
    assert.match(body, /yearOverYearDeltas/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MCP endpoint reads the catalog resource with the modern protocol", async () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const response = await POST(request(
    {
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "resources/read",
      "MCP-Name": "dvns://datasets",
    },
    JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { _meta: meta, uri: "dvns://datasets" },
    }),
  ));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"resultType":"complete"/);
  assert.match(body, /siope_comuni/);
});

test("MCP endpoint rejects a malformed modern envelope", async () => {
  const response = await POST(request(
    { "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "tools/list" },
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    }),
  ));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /clientCapabilities/);
});

test("MCP endpoint keeps stateless requests isolated under concurrency", async () => {
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => POST(request())),
  );
  assert.ok(responses.every((response) => response.status === 200));
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert.ok(bodies.every((body) => body.includes("query_dataset")));
});

test("MCP endpoint returns 503 and emits safe saturation telemetry at bulkhead capacity", async () => {
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const pending = controllers.map((controller) => POST(new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: new ReadableStream({ start() {} }),
    duplex: "half",
    signal: controller.signal,
  })));

  await new Promise((resolve) => setImmediate(resolve));
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (line) => warnings.push(line);
  let overloaded;
  try {
    overloaded = await POST(request({
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "tools/call",
      "MCP-Name": "query_dataset",
    }));
  } finally {
    console.warn = previousWarn;
    for (const controller of controllers) controller.abort("test cleanup");
    await Promise.allSettled(pending);
  }

  assert.equal(overloaded.status, 503);
  assert.equal(overloaded.headers.get("retry-after"), "5");
  assert.equal((await overloaded.json()).id, null);
  assert.equal(warnings.length, 1);
  const event = JSON.parse(warnings[0]);
  assert.ok(Number.isSafeInteger(event.durationMs) && event.durationMs >= 0);
  delete event.durationMs;
  assert.deepEqual(event, {
    event: "mcp_operational_limit",
    outcome: "concurrency_limited",
    status: 503,
    protocol: "2026-07-28",
    method: "tools/call",
    tool: "query_dataset",
    activeRequests: 8,
    concurrencyLimit: 8,
    saturated: true,
  });
});

test("MCP endpoint enforces the WAF-aligned 30 requests per minute instance limit", async () => {
  const headers = { "X-Forwarded-For": "198.51.100.60" };
  for (let index = 0; index < 30; index += 1) {
    const response = await POST(request(headers));
    assert.equal(response.status, 200, `request ${index + 1}`);
    await response.body?.cancel();
  }

  const limited = await POST(request(headers));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("MCP tool input schema rejects out-of-range pagination", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "query_dataset",
      arguments: { dataset: "opencivitas_fabbisogni", limit: 101 },
    },
  })));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Invalid arguments/);
  assert.match(body, /Too big/);
});

test("MCP tool responses stay below the wire-size budget", async () => {
  const response = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 13,
    method: "tools/call",
    params: {
      name: "query_dataset",
      arguments: { dataset: "pnrr_asili", region: "Lazio", limit: 100 },
    },
  })));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.ok(new TextEncoder().encode(body).byteLength <= 750_000);
  const rpcEvent = parseRpcEvent(body);
  assert.equal(rpcEvent.result.isError, true);
  assert.equal(rpcEvent.result.structuredContent, undefined);
  assert.match(rpcEvent.result.content[0].text, /supera il limite di dimensione/i);

  const irpefResponse = await POST(request({}, JSON.stringify({
    jsonrpc: "2.0",
    id: 14,
    method: "tools/call",
    params: {
      name: "query_dataset",
      arguments: {
        dataset: "mef_irpef_comunale",
        level: "municipality",
        region: "Lazio",
        detail: "all",
        limit: 100,
      },
    },
  })));
  const irpefBody = await irpefResponse.text();
  assert.equal(irpefResponse.status, 200);
  assert.ok(new TextEncoder().encode(irpefBody).byteLength <= 750_000);
  const irpefEvent = parseRpcEvent(irpefBody);
  assert.notEqual(irpefEvent.result.isError, true);
  assert.equal(irpefEvent.result.structuredContent.data.pagination.returned, 100);
});
