import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { OPTIONS, POST } = await import("../src/app/api/mcp/route.ts");

const requestBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

function request(headers = {}, body = requestBody) {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
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

test("MCP endpoint enforces an explicit host allowlist", async () => {
  const previous = process.env.MCP_ALLOWED_HOSTS;
  process.env.MCP_ALLOWED_HOSTS = "mcp.example.test";
  try {
    const rejected = await POST(request());
    assert.equal(rejected.status, 403);
    assert.match(await rejected.text(), /Host non consentito/);
  } finally {
    if (previous === undefined) delete process.env.MCP_ALLOWED_HOSTS;
    else process.env.MCP_ALLOWED_HOSTS = previous;
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
    const response = await POST(new Request("http://localhost:3210/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: "127.0.0.1:3210",
      },
      body: requestBody,
    }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /query_dataset/);
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
  assert.equal(response.status, 200);
  assert.match(body, /"resultType":"complete"/);
  assert.match(body, /list_datasets/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
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
  assert.equal(response.status, 200);
  assert.match(body, /2026-07-28/);
  assert.match(body, /dove-vanno-i-nostri-soldi/);
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
    Array.from({ length: 20 }, () => POST(request())),
  );
  assert.ok(responses.every((response) => response.status === 200));
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert.ok(bodies.every((body) => body.includes("query_dataset")));
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
