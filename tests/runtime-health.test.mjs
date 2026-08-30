import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_BODY_BYTES,
  RuntimeHealthError,
  isRetryableStatus,
  main,
  parseCliArgs,
  parseRpcEnvelope,
  readBodyBounded,
  requestWithRetry,
  resolveBaseUrl,
  runHealthMonitor,
  validateHealthPayload,
  validateInitializePayload,
  validateSourceHealthPayload,
  validateSnapshotQueryPayload,
  validateToolsListPayload,
  writeReport,
} from "../scripts/runtime-health.mjs";

const REVISION = "a".repeat(40);
const SOURCE_IDS = [
  "ipa", "ipa-struttura", "openbdap", "anac", "inps", "cpt", "mef-irpef", "siope",
  "istat", "istat-casellario-pensioni", "opencoesione", "italiadomani", "opencivitas", "consulenti", "camera", "senato",
  "pcm", "partecipazioni-pubbliche", "bancaditalia", "eurostat", "eurostat-hicp", "ameco",
  "governi-presidenza",
];
const MCP_HEADERS = {
  "content-type": "application/json",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
const TOOLS = [
  {
    name: "list_datasets",
    title: "Elenca dataset",
    description: "Elenca i dataset pubblici disponibili.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { datasets: { type: "array" }, relatedMcpServices: { type: "array" } },
      required: ["datasets", "relatedMcpServices"],
      additionalProperties: false,
    },
    securitySchemes: [{ type: "noauth" }],
    _meta: { securitySchemes: [{ type: "noauth" }] },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "query_dataset",
    title: "Interroga dataset",
    description: "Interroga un dataset pubblico.",
    inputSchema: {
      type: "object",
      properties: {
        dataset: { type: "string" },
        year: { type: "integer" },
        query: { type: "string" },
        level: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["dataset"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" }, dataset: { type: "string" } },
      required: ["ok", "dataset"],
      additionalProperties: false,
    },
    securitySchemes: [{ type: "noauth" }],
    _meta: { securitySchemes: [{ type: "noauth" }] },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function makeResponse(body, { status = 200, headers = {} } = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, { status, headers });
}

function jsonResponse(body, options = {}) {
  return makeResponse(body, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
}

function rpcResponse(result, { sse = false } = {}) {
  const envelope = JSON.stringify({ jsonrpc: "2.0", id: 1, result });
  const body = sse ? `event: message\ndata: ${envelope}\n\n` : envelope;
  return makeResponse(body, {
    headers: {
      ...MCP_HEADERS,
      "content-type": sse ? "text/event-stream" : "application/json",
    },
  });
}

function sourcePayload({ down = false } = {}) {
  return {
    ok: true,
    summary: {
      total: SOURCE_IDS.length,
      active: SOURCE_IDS.length,
      reachable: down ? SOURCE_IDS.length - 1 : SOURCE_IDS.length,
      unreachable: down ? 1 : 0,
      notProbed: 0,
    },
    sources: SOURCE_IDS.map((sourceId, index) => ({
      sourceId,
      integration: "active",
      reachability: down && index === 0 ? "down" : "up",
    })),
  };
}

function snapshotResult() {
  return {
    structuredContent: {
      ok: true,
      dataset: "mef_irpef_comunale",
      query: {
        dataset: "mef_irpef_comunale",
        year: 2024,
        level: "municipality",
        query: "Abano",
        limit: 1,
      },
      data: {
        dataset: "mef_irpef_comunale",
        period: { taxYear: 2024 },
        level: "municipality",
        query: { query: "Abano" },
        pagination: { returned: 1, limit: 1, total: 1, offset: 0 },
        data: [{ territory: { code: "028001", name: "ABANO TERME" } }],
        provenance: {
          source: {
            owner: "MEF – Dipartimento delle Finanze",
            assetUrl: "https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php",
          },
        },
      },
    },
    content: [{ type: "text", text: "Risultato mef_irpef_comunale" }],
  };
}

function appFetch({ sourceDown = false, aliasDrift = false, calls = [] } = {}) {
  return async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: requestUrl.pathname, body: init.body });

    if (method === "GET" && requestUrl.pathname === "/") {
      return makeResponse("<!doctype html><title>DoveVannoINostriSoldi</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (method === "GET" && requestUrl.pathname === "/api/health") {
      return jsonResponse({ ok: true, service: "dvns-web", revision: REVISION });
    }
    if (method === "GET" && requestUrl.pathname === "/api/fonti/stato") {
      return jsonResponse(sourcePayload({ down: sourceDown }));
    }
    if (method === "POST" && (requestUrl.pathname === "/api/mcp" || requestUrl.pathname === "/mcp")) {
      const request = JSON.parse(init.body);
      if (request.method === "initialize") {
        return rpcResponse({
          protocolVersion: "2025-11-25",
          serverInfo: {
            name: "dove-vanno-i-nostri-soldi",
            title: "DoveVannoINostriSoldi",
            version: "0.2.0",
            websiteUrl: "https://www.dovevannoinostrisoldi.com",
          },
          capabilities: { resources: {}, prompts: {}, tools: {} },
        });
      }
      if (request.method === "tools/list") {
        const tools = aliasDrift && requestUrl.pathname === "/mcp"
          ? TOOLS.map((tool, index) => index === 0 ? { ...tool, description: "Contratto diverso" } : tool)
          : TOOLS;
        return rpcResponse({ tools }, { sse: requestUrl.pathname === "/mcp" });
      }
      if (request.method === "tools/call") return rpcResponse(snapshotResult());
    }
    throw new Error(`unexpected fake request ${method} ${requestUrl.pathname}`);
  };
}

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dvns-runtime-health-test-"));
}

test("resolveBaseUrl accepts the canonical origin and rejects unsafe values", () => {
  assert.equal(
    resolveBaseUrl("https://example.test/path?q=secret#fragment", {
      additionalAllowedOrigins: ["https://example.test"],
    }).href,
    "https://example.test/path",
  );
  assert.equal(resolveBaseUrl("http://127.0.0.1:3000/path").href, "http://127.0.0.1:3000/path");
  assert.throws(() => resolveBaseUrl("ftp://example.test"), (error) => error.code === "invalid_base_url");
  assert.throws(() => resolveBaseUrl("http://169.254.169.254/latest"), (error) => error.code === "invalid_base_url");
  assert.throws(() => resolveBaseUrl("https://attacker.invalid"), (error) => error.code === "invalid_base_url");
  assert.throws(() => resolveBaseUrl("https://user:pass@example.test"), (error) => error.code === "invalid_base_url");
});

test("parseCliArgs is strict and only accepts one --output path", () => {
  assert.deepEqual(parseCliArgs([]), { reportPath: undefined });
  assert.deepEqual(parseCliArgs(["--output", "/tmp/report.json"]), { reportPath: "/tmp/report.json" });
  for (const argv of [["--unknown"], ["--output"], ["--output", "--unknown"], ["--output", "/tmp/a", "--output", "/tmp/b"]]) {
    assert.throws(() => parseCliArgs(argv), (error) => error.code === "invalid_cli");
  }
});

test("parseRpcEnvelope handles direct JSON and split SSE data frames", () => {
  const direct = { jsonrpc: "2.0", id: 1, result: { ok: true } };
  assert.deepEqual(parseRpcEnvelope(JSON.stringify(direct)), direct);
  const split = [
    "event: message",
    'data: {"jsonrpc":"2.0",',
    'data: "id":1,',
    'data: "result":{"ok":true}}',
    "",
  ].join("\n");
  assert.deepEqual(parseRpcEnvelope(split), direct);
  const multiple = [
    `data: ${JSON.stringify({ jsonrpc: "2.0", id: 0, result: { ok: false } })}`,
    "",
    `data: ${JSON.stringify(direct)}`,
    "",
  ].join("\n");
  assert.deepEqual(parseRpcEnvelope(multiple), direct);
  assert.throws(() => parseRpcEnvelope("event: message\ndata: [DONE]\n"), (error) => error.code === "invalid_rpc");
});

test("readBodyBounded rejects declared and streamed bodies and cancels them", async () => {
  const declared = new Response("abcd", { headers: { "content-length": "4" } });
  await assert.rejects(
    readBodyBounded(declared, 3),
    (error) => error instanceof RuntimeHealthError && error.code === "body_too_large",
  );

  const streamed = new Response("abcd");
  await assert.rejects(
    readBodyBounded(streamed, 3),
    (error) => error instanceof RuntimeHealthError && error.code === "body_too_large",
  );
  assert.equal(await readBodyBounded(new Response("ok"), MAX_BODY_BYTES), "ok");
});

test("requestWithRetry retries network failures and every transient status exactly once", async () => {
  for (const status of [501, 599]) {
    let calls = 0;
    const result = await requestWithRetry("https://example.test/status", {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? makeResponse("transient", { status })
          : makeResponse("ok", { headers: { "content-type": "text/plain" } });
      },
      sleepImpl: async () => undefined,
    });
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.equal(result.body, "ok");
  }

  let networkCalls = 0;
  const networkResult = await requestWithRetry("https://example.test/network", {
    fetchImpl: async () => {
      networkCalls += 1;
      if (networkCalls === 1) throw new TypeError("socket closed");
      return makeResponse("ok");
    },
    sleepImpl: async () => undefined,
  });
  assert.equal(networkCalls, 2);
  assert.equal(networkResult.attempts, 2);
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(425), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(599), true);
  assert.equal(isRetryableStatus(400), false);
});

test("requestWithRetry does not retry permanent HTTP or body-limit failures", async () => {
  let permanentCalls = 0;
  const permanent = await requestWithRetry("https://example.test/permanent", {
    fetchImpl: async () => {
      permanentCalls += 1;
      return makeResponse("bad request", { status: 400 });
    },
    sleepImpl: async () => undefined,
  });
  assert.equal(permanentCalls, 1);
  assert.equal(permanent.attempts, 1);
  assert.equal(permanent.response.status, 400);

  let oversizedCalls = 0;
  await assert.rejects(
    requestWithRetry("https://example.test/large", {
      fetchImpl: async () => {
        oversizedCalls += 1;
        return makeResponse("1234");
      },
      maxBodyBytes: 3,
      sleepImpl: async () => undefined,
    }),
    (error) => error instanceof RuntimeHealthError && error.code === "body_too_large",
  );
  assert.equal(oversizedCalls, 1);
});

test("requestWithRetry never replays POST and composes caller cancellation", async () => {
  let postCalls = 0;
  const postResult = await requestWithRetry("https://example.test/post", {
    method: "POST",
    maxAttempts: 2,
    fetchImpl: async () => {
      postCalls += 1;
      return makeResponse("transient", { status: 501 });
    },
  });
  assert.equal(postCalls, 1);
  assert.equal(postResult.attempts, 1);

  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));
  let cancelledCalls = 0;
  await assert.rejects(
    requestWithRetry("https://example.test/cancelled", {
      signal: controller.signal,
      fetchImpl: async () => {
        cancelledCalls += 1;
        return makeResponse("unexpected");
      },
    }),
    (error) => error.name === "AbortError",
  );
  assert.equal(cancelledCalls, 0);
});

test("requestWithRetry aborts on timeout and never follows redirects", async () => {
  await assert.rejects(
    requestWithRetry("https://example.test/slow", {
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        // AbortSignal.timeout() does not keep Node's event loop alive. Keep one
        // bounded timer referenced so this fake transport can observe abort on
        // the same Node 22 runtime used by GitHub Actions.
        const guard = setTimeout(() => reject(new Error("timeout signal was not observed")), 100);
        init.signal.addEventListener("abort", () => {
          clearTimeout(guard);
          reject(init.signal.reason);
        }, { once: true });
      }),
      timeoutMs: 5,
      maxAttempts: 1,
    }),
    (error) => error instanceof RuntimeHealthError
      && error.code === "network_error"
      && error.attempts === 1,
  );

  let redirectPolicy;
  const redirect = await requestWithRetry("https://example.test/redirect", {
    fetchImpl: async (_url, init) => {
      redirectPolicy = init.redirect;
      return makeResponse("", { status: 302, headers: { location: "https://attacker.invalid" } });
    },
    redirect: "follow",
  });
  assert.equal(redirectPolicy, "manual");
  assert.equal(redirect.response.status, 302);
});

test("runHealthMonitor fails on unreachable sources and performs checks sequentially", async () => {
  const calls = [];
  const report = await runHealthMonitor({
    baseUrl: "https://example.test/ignored?q=redact#fragment",
    fetchImpl: appFetch({ sourceDown: true, calls }),
    sleepImpl: async () => undefined,
    observedAt: "2026-08-28T00:00:00.000Z",
    additionalAllowedOrigins: ["https://example.test"],
  });

  assert.equal(report.ok, false);
  assert.equal(report.baseUrl, "https://example.test");
  assert.equal(report.checks.length, 7);
  assert.equal(report.checks.filter((check) => check.status === "pass").length, 6);
  const sourceHealth = report.checks.find((check) => check.name === "source-health");
  assert.equal(sourceHealth.status, "fail");
  assert.equal(sourceHealth.code, "source_unreachable");
  assert.equal(sourceHealth.attempts, 1);
  assert.equal(report.checks.find((check) => check.name === "health").revision, REVISION);
  assert.deepEqual(calls.map((call) => call.path), [
    "/",
    "/api/health",
    "/api/fonti/stato",
    "/api/mcp",
    "/api/mcp",
    "/mcp",
    "/api/mcp",
  ]);
  assert.equal(report.warnings.length, 0);
  const queryCall = calls.at(-1);
  const queryRequest = JSON.parse(queryCall.body);
  assert.deepEqual(queryRequest.params.arguments, {
    dataset: "mef_irpef_comunale",
    year: 2024,
    level: "municipality",
    query: "Abano",
    limit: 1,
  });
  assert.doesNotMatch(JSON.stringify(report), /redact|authorization|cookie|snapshot raw/i);
  assert.ok(report.checks.every((check) => !Object.hasOwn(check, "body") && !Object.hasOwn(check, "response")));
  assert.ok(report.checks.every((check) => !Object.hasOwn(check, "contract")));
});

test("runHealthMonitor rejects MCP alias contract drift", async () => {
  const report = await runHealthMonitor({
    baseUrl: "https://example.test",
    additionalAllowedOrigins: ["https://example.test"],
    fetchImpl: appFetch({ aliasDrift: true }),
    sleepImpl: async () => undefined,
  });
  const alias = report.checks.find((check) => check.name === "mcp-alias-tools-list");
  assert.equal(report.ok, false);
  assert.equal(alias.status, "fail");
  assert.equal(alias.code, "alias_contract_drift");
  assert.equal(alias.attempts, 1);
});

test("runHealthMonitor preserves two attempts when the final response is retryable", async () => {
  const calls = [];
  const report = await runHealthMonitor({
    baseUrl: "https://example.test",
    fetchImpl: async (url, init) => {
      const requestUrl = new URL(url);
      calls.push(requestUrl.pathname);
      if (requestUrl.pathname === "/api/health") {
        return jsonResponse({ secret: "should-not-leak" }, { status: 501 });
      }
      return appFetch({ calls })(url, init);
    },
    sleepImpl: async () => undefined,
    additionalAllowedOrigins: ["https://example.test"],
  });
  const health = report.checks.find((check) => check.name === "health");
  assert.equal(report.ok, false);
  assert.equal(health.status, "fail");
  assert.equal(health.attempts, 2);
  assert.equal(health.code, "unexpected_status");
  assert.equal(report.checks.find((check) => check.name === "mcp-api-initialize").attempts, 1);
  assert.doesNotMatch(JSON.stringify(report), /should-not-leak|content-length|cache-control/i);
});

test("contract validators reject malformed health, tools, snapshot, and security headers", () => {
  assert.throws(
    () => validateHealthPayload(jsonResponse({ ok: true, service: "dvns-web", revision: "local" }), JSON.stringify({ ok: true })),
    (error) => error.code === "invalid_health_contract",
  );
  assert.throws(
    () => validateSourceHealthPayload(
      jsonResponse({ ok: true, summary: { total: 0, active: 0 }, sources: [] }),
      JSON.stringify({ ok: true, summary: { total: 0, active: 0 }, sources: [] }),
    ),
    (error) => error.code === "invalid_source_health_contract",
  );
  const malformedSource = sourcePayload();
  malformedSource.sources[0].reachability = "unknown";
  assert.throws(
    () => validateSourceHealthPayload(jsonResponse(malformedSource), JSON.stringify(malformedSource)),
    (error) => error.code === "invalid_source_health_contract",
  );
  const unreconciledSource = sourcePayload();
  unreconciledSource.summary.reachable = 0;
  assert.throws(
    () => validateSourceHealthPayload(jsonResponse(unreconciledSource), JSON.stringify(unreconciledSource)),
    (error) => error.code === "invalid_source_health_contract",
  );
  const unknownSource = sourcePayload();
  unknownSource.sources[0].sourceId = "bogus";
  assert.throws(
    () => validateSourceHealthPayload(jsonResponse(unknownSource), JSON.stringify(unknownSource)),
    (error) => error.code === "invalid_source_health_contract",
  );
  const incompleteInitialize = {
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2025-11-25", serverInfo: { name: "other" }, capabilities: {} },
  };
  assert.throws(
    () => validateInitializePayload(
      rpcResponse(incompleteInitialize.result),
      JSON.stringify(incompleteInitialize),
    ),
    (error) => error.code === "invalid_initialize_contract",
  );
  assert.throws(
    () => validateToolsListPayload(rpcResponse({ tools: TOOLS }), JSON.stringify({ result: { tools: TOOLS } })),
    (error) => error.code === "invalid_rpc",
  );
  const unsafeTools = TOOLS.map((tool) => ({
    ...tool,
    annotations: { ...tool.annotations, openWorldHint: true },
  }));
  assert.throws(
    () => validateToolsListPayload(
      rpcResponse({ tools: unsafeTools }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: unsafeTools } }),
    ),
    (error) => error.code === "invalid_tool_annotations",
  );
  assert.throws(
    () => validateToolsListPayload(
      rpcResponse({ tools: [{ name: "query_dataset", annotations: { readOnlyHint: false } }] }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
    ),
    (error) => error.code === "missing_tool" || error.code === "invalid_tools_contract",
  );
  const duplicateTools = [TOOLS[0], { ...TOOLS[0] }];
  assert.throws(
    () => validateToolsListPayload(
      rpcResponse({ tools: duplicateTools }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: duplicateTools } }),
    ),
    (error) => error.code === "invalid_tools_contract",
  );
  const wrongSnapshot = rpcResponse({
    structuredContent: {
      ok: true,
      dataset: "other",
      data: { pagination: { returned: 2 } },
    },
  });
  assert.throws(
    () => validateSnapshotQueryPayload(wrongSnapshot, JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })),
    (error) => error.code === "invalid_snapshot_query_contract",
  );
  const badHeaders = new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
  assert.throws(
    () => validateSnapshotQueryPayload(badHeaders, JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })),
    (error) => error.code === "invalid_cache_policy",
  );
});

test("writeReport and main write a redacted report on CLI failure", async () => {
  const directory = await temporaryDirectory();
  const reportPath = path.join(directory, "nested", "report.json");
  const report = { ok: false, checks: [{ name: "x", status: "fail", error: "safe" }] };
  await writeReport(report, reportPath);
  assert.deepEqual(JSON.parse(await fs.readFile(reportPath, "utf8")), report);

  const cliReportPath = path.join(directory, "cli-report.json");
  const code = await main({ argv: ["--output", cliReportPath, "--unknown"], fetchImpl: appFetch() });
  assert.equal(code, 1);
  const cliReport = JSON.parse(await fs.readFile(cliReportPath, "utf8"));
  assert.equal(cliReport.ok, false);
  assert.match(cliReport.error, /Argomento CLI non riconosciuto/);
  assert.doesNotMatch(JSON.stringify(cliReport), /body|headers|authorization/i);
});
