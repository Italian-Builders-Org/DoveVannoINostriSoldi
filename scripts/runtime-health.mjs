import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "https://www.dovevannoinostrisoldi.com";
export const MAX_BODY_BYTES = 750_000;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const SOURCE_HEALTH_TIMEOUT_MS = 90_000;
export const DEFAULT_MAX_ATTEMPTS = 2;
export const DEFAULT_REPORT_PATH = path.join(
  process.cwd(),
  "artifacts",
  "runtime-health",
  "report.json",
);

const MCP_CONTENT_TYPE = /(?:application\/json|text\/event-stream)/i;
const JSON_CONTENT_TYPE = /application\/json/i;
const HTML_CONTENT_TYPE = /text\/html/i;
const SHA = /^[0-9a-f]{40}$/iu;
const EXPECTED_MCP_SERVER_NAME = "dove-vanno-i-nostri-soldi";

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

const REQUIRED_TOOLS = ["list_datasets", "query_dataset"];
const EXPECTED_SOURCE_IDS = [
  "ipa",
  "ipa-struttura",
  "openbdap",
  "anac",
  "inps",
  "cpt",
  "mef-irpef",
  "siope",
  "istat",
  "istat-casellario-pensioni",
  "consip",
  "opencoesione",
  "italiadomani",
  "opencivitas",
  "consulenti",
  "camera",
  "senato",
  "pcm",
  "partecipazioni-pubbliche",
  "bancaditalia",
  "eurostat",
  "eurostat-hicp",
  "eurostat-cofog",
  "istat-cofog",
  "ameco",
  "governi-presidenza",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isRetryableStatus(status) {
  return status === 408
    || status === 425
    || status === 429
    || (status >= 500 && status <= 599);
}

export class RuntimeHealthError extends Error {
  constructor(message, { code = "check_failed", retryable = false, attempts = 1, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RuntimeHealthError";
    this.code = code;
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resolveBaseUrl(
  value = DEFAULT_BASE_URL,
  { additionalAllowedOrigins = [] } = {},
) {
  let baseUrl;
  try {
    baseUrl = new URL(value);
  } catch (error) {
    throw new RuntimeHealthError("CANONICAL_BASE_URL non valida", {
      code: "invalid_base_url",
      cause: error,
    });
  }
  const loopback = isLoopbackHostname(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !(loopback && baseUrl.protocol === "http:")) {
    throw new RuntimeHealthError("CANONICAL_BASE_URL richiede HTTPS, salvo loopback locale", {
      code: "invalid_base_url",
    });
  }
  if (baseUrl.username || baseUrl.password) {
    throw new RuntimeHealthError("CANONICAL_BASE_URL non può contenere credenziali", {
      code: "invalid_base_url",
    });
  }
  baseUrl.hash = "";
  baseUrl.search = "";
  const allowedOrigins = new Set([DEFAULT_BASE_URL, ...additionalAllowedOrigins]);
  if (!loopback && !allowedOrigins.has(baseUrl.origin)) {
    throw new RuntimeHealthError("CANONICAL_BASE_URL non è un'origine autorizzata", {
      code: "invalid_base_url",
    });
  }
  return baseUrl;
}

function bodyContentLength(response) {
  const raw = response.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

async function cancelBody(body, reason) {
  try {
    await body?.cancel(reason);
  } catch {
    // The response is already being discarded; cancellation is best effort.
  }
}

/** Read a response without ever accumulating more than maxBytes. */
export async function readBodyBounded(response, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = bodyContentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelBody(response.body, "runtime health response body limit exceeded");
    throw new RuntimeHealthError(
      `Risposta oltre il limite di ${maxBytes} byte`,
      { code: "body_too_large" },
    );
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new RuntimeHealthError("Risposta con chunk non binario", {
          code: "body_read_failed",
          retryable: false,
        });
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("runtime health response body limit exceeded").catch(() => undefined);
        throw new RuntimeHealthError(
          `Risposta oltre il limite di ${maxBytes} byte`,
          { code: "body_too_large" },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RuntimeHealthError) throw error;
    throw new RuntimeHealthError("Lettura della risposta interrotta", {
      code: "body_read_failed",
      retryable: true,
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function retryableError(error) {
  return !(error instanceof RuntimeHealthError)
    || error.retryable === true
    || error.code === "body_read_failed";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch with one bounded retry for GET/HEAD only. Non-idempotent methods are
 * never replayed; response/schema policy failures are never retried.
 */
export async function requestWithRetry(
  url,
  {
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxBodyBytes = MAX_BODY_BYTES,
    signal: callerSignal,
    ...init
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new RuntimeHealthError("fetch non disponibile", { code: "fetch_unavailable" });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > DEFAULT_MAX_ATTEMPTS) {
    throw new RuntimeHealthError("maxAttempts deve essere 1 oppure 2", { code: "invalid_retry_policy" });
  }
  const method = String(init.method ?? "GET").toUpperCase();
  const effectiveMaxAttempts = method === "GET" || method === "HEAD" ? maxAttempts : 1;

  let lastError;
  for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt += 1) {
    try {
      callerSignal?.throwIfAborted();
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(url, {
        ...init,
        redirect: "manual",
        signal: callerSignal
          ? AbortSignal.any([callerSignal, timeoutSignal])
          : timeoutSignal,
      });

      if (isRetryableStatus(response.status) && attempt < effectiveMaxAttempts) {
        await cancelBody(response.body, "retryable runtime health response");
        callerSignal?.throwIfAborted();
        await sleepImpl(attempt * 250);
        callerSignal?.throwIfAborted();
        continue;
      }

      if (isRetryableStatus(response.status)) {
        await cancelBody(response.body, "final retryable runtime health response");
        return { response, body: "", attempts: attempt };
      }

      let body;
      try {
        body = await readBodyBounded(response, maxBodyBytes);
      } catch (error) {
        if (!retryableError(error) || attempt >= effectiveMaxAttempts) throw error;
        lastError = error;
        callerSignal?.throwIfAborted();
        await sleepImpl(attempt * 250);
        callerSignal?.throwIfAborted();
        continue;
      }
      return { response, body, attempts: attempt };
    } catch (error) {
      if (error instanceof RuntimeHealthError && error.code === "body_too_large") {
        error.attempts = attempt;
        throw error;
      }
      if (attempt >= effectiveMaxAttempts || !retryableError(error)) {
        throw new RuntimeHealthError(
          `Richiesta fallita dopo ${attempt} tentativo/i: ${errorMessage(error)}`,
          { code: "network_error", retryable: false, attempts: attempt, cause: error },
        );
      }
      lastError = error;
      callerSignal?.throwIfAborted();
      await sleepImpl(attempt * 250);
      callerSignal?.throwIfAborted();
    }
  }

  throw new RuntimeHealthError(
    `Richiesta fallita: ${errorMessage(lastError)}`,
    { code: "network_error", retryable: false, attempts: effectiveMaxAttempts, cause: lastError },
  );
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new RuntimeHealthError(`${label}: JSON non valido`, {
      code: "invalid_json",
      cause: error,
    });
  }
}

/** Parse either a direct JSON-RPC envelope or one of the JSON data frames in SSE. */
export function parseRpcEnvelope(body, label = "MCP") {
  const trimmed = body.trim().replace(/^\uFEFF/u, "");
  if (trimmed.startsWith("{")) return parseJson(trimmed, label);

  const frames = [];
  let frame = [];
  for (const line of body.split(/\r?\n/u)) {
    if (line === "") {
      if (frame.length > 0) frames.push(frame.join("\n"));
      frame = [];
      continue;
    }
    if (/^data:\s?/u.test(line)) frame.push(line.replace(/^data:\s?/u, "").trim());
  }
  if (frame.length > 0) frames.push(frame.join("\n"));

  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const candidate = frames[index].trim();
    if (!candidate || candidate === "[DONE]") continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue looking for the latest complete JSON frame.
    }
  }
  throw new RuntimeHealthError(`${label}: envelope JSON-RPC assente`, {
    code: "invalid_rpc",
  });
}

export function requireRpcResult(envelope, label = "MCP") {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new RuntimeHealthError(`${label}: envelope non è un oggetto`, { code: "invalid_rpc" });
  }
  if (envelope.jsonrpc !== "2.0" || !(typeof envelope.id === "string" || typeof envelope.id === "number")) {
    throw new RuntimeHealthError(`${label}: versione JSON-RPC o id non validi`, { code: "invalid_rpc" });
  }
  if (envelope.error !== undefined) {
    throw new RuntimeHealthError(`${label}: errore JSON-RPC`, { code: "rpc_error" });
  }
  if (!envelope.result || typeof envelope.result !== "object") {
    throw new RuntimeHealthError(`${label}: result mancante`, { code: "invalid_rpc" });
  }
  return envelope.result;
}

export function assertContentType(response, expected, label) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!expected.test(contentType)) {
    throw new RuntimeHealthError(`${label}: Content-Type inatteso`, { code: "invalid_content_type" });
  }
  return contentType;
}

export function assertMcpHeaders(response, label = "MCP") {
  if (response.headers.get("cache-control") !== "private, no-store") {
    throw new RuntimeHealthError(`${label}: Cache-Control non è private, no-store`, {
      code: "invalid_cache_policy",
    });
  }
  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new RuntimeHealthError(`${label}: X-Content-Type-Options non è nosniff`, {
      code: "invalid_security_headers",
    });
  }
}

export function validateHomepage(response, body) {
  if (response.status !== 200) {
    throw new RuntimeHealthError(`Homepage HTTP ${response.status}`, { code: "unexpected_status" });
  }
  assertContentType(response, HTML_CONTENT_TYPE, "Homepage");
  if (!body.includes("DoveVannoINostriSoldi") && !body.includes("Dove vanno i nostri soldi pubblici")) {
    throw new RuntimeHealthError("Homepage senza marker applicativo", { code: "invalid_homepage" });
  }
  return { status: response.status };
}

export function validateHealthPayload(response, body) {
  if (response.status !== 200) {
    throw new RuntimeHealthError(`Health HTTP ${response.status}`, { code: "unexpected_status" });
  }
  assertContentType(response, JSON_CONTENT_TYPE, "Health");
  const payload = parseJson(body, "Health");
  if (payload?.ok !== true || payload.service !== "dvns-web" || !SHA.test(payload.revision ?? "")) {
    throw new RuntimeHealthError("Health con contratto non valido", { code: "invalid_health_contract" });
  }
  return { status: response.status, revision: payload.revision };
}

export function validateSourceHealthPayload(response, body) {
  if (response.status !== 200) {
    throw new RuntimeHealthError(`Source health HTTP ${response.status}`, { code: "unexpected_status" });
  }
  assertContentType(response, JSON_CONTENT_TYPE, "Source health");
  const payload = parseJson(body, "Source health");
  if (
    payload?.ok !== true
    || !Array.isArray(payload.sources)
    || !payload.summary
    || typeof payload.summary !== "object"
  ) {
    throw new RuntimeHealthError("Source health con contratto non valido", {
      code: "invalid_source_health_contract",
    });
  }
  const allowedReachability = new Set(["up", "down", "not-probed"]);
  const sourceIds = new Set();
  for (const source of payload.sources) {
    if (
      !source
      || typeof source !== "object"
      || source.integration !== "active"
      || typeof source.sourceId !== "string"
      || source.sourceId.trim() === ""
      || sourceIds.has(source.sourceId)
      || !allowedReachability.has(source.reachability)
    ) {
      throw new RuntimeHealthError("Source health con fonte operativa non valida", {
        code: "invalid_source_health_contract",
      });
    }
    sourceIds.add(source.sourceId);
  }
  if (
    sourceIds.size !== EXPECTED_SOURCE_IDS.length
    || EXPECTED_SOURCE_IDS.some((sourceId) => !sourceIds.has(sourceId))
  ) {
    throw new RuntimeHealthError("Source health non coincide con il registro operativo", {
      code: "invalid_source_health_contract",
    });
  }
  const active = payload.sources;
  const reachable = active.filter((source) => source.reachability === "up");
  const down = active.filter((source) => source.reachability === "down");
  const notProbed = active.filter((source) => source.reachability === "not-probed");
  if (
    active.length === 0
    || payload.summary.total !== payload.sources.length
    || payload.summary.active !== active.length
    || payload.summary.reachable !== reachable.length
    || payload.summary.unreachable !== down.length
    || payload.summary.notProbed !== notProbed.length
  ) {
    throw new RuntimeHealthError("Source health senza registro operativo completo", {
      code: "invalid_source_health_contract",
    });
  }
  if (down.length > 0) {
    throw new RuntimeHealthError(`${down.length} fonte/i ufficiale/i non raggiungibile/i`, {
      code: "source_unreachable",
    });
  }
  return {
    status: response.status,
    active: active.length,
    reachable: reachable.length,
    notProbed: notProbed.length,
  };
}

export function validateInitializePayload(response, body) {
  if (response.status !== 200) {
    throw new RuntimeHealthError(`MCP initialize HTTP ${response.status}`, { code: "unexpected_status" });
  }
  assertContentType(response, MCP_CONTENT_TYPE, "MCP initialize");
  assertMcpHeaders(response, "MCP initialize");
  const result = requireRpcResult(parseRpcEnvelope(body, "MCP initialize"), "MCP initialize");
  if (
    result.protocolVersion !== "2025-11-25"
    || result.serverInfo?.name !== EXPECTED_MCP_SERVER_NAME
    || result.serverInfo.title !== "DoveVannoINostriSoldi"
    || typeof result.serverInfo.version !== "string"
    || result.serverInfo.version.trim() === ""
    || result.serverInfo.websiteUrl !== DEFAULT_BASE_URL
    || !result.capabilities
    || typeof result.capabilities !== "object"
    || Array.isArray(result.capabilities)
    || !["resources", "prompts", "tools"].every(
      (capability) => result.capabilities[capability]
        && typeof result.capabilities[capability] === "object",
    )
  ) {
    throw new RuntimeHealthError("MCP initialize con contratto server non valido", {
      code: "invalid_initialize_contract",
    });
  }
  return { status: response.status, serverName: result.serverInfo.name };
}

export function validateToolsListPayload(response, body, label = "MCP tools/list") {
  if (response.status !== 200) {
    throw new RuntimeHealthError(`${label} HTTP ${response.status}`, { code: "unexpected_status" });
  }
  assertContentType(response, MCP_CONTENT_TYPE, label);
  assertMcpHeaders(response, label);
  const result = requireRpcResult(parseRpcEnvelope(body, label), label);
  if (!Array.isArray(result.tools)) {
    throw new RuntimeHealthError(`${label} senza elenco tools`, { code: "invalid_tools_contract" });
  }
  const names = new Set(result.tools.map((tool) => tool?.name));
  if (result.tools.length !== REQUIRED_TOOLS.length || names.size !== REQUIRED_TOOLS.length) {
    throw new RuntimeHealthError(`${label}: elenco tools inatteso o duplicato`, {
      code: "invalid_tools_contract",
    });
  }
  for (const required of REQUIRED_TOOLS) {
    if (!names.has(required)) {
      throw new RuntimeHealthError(`${label}: tool ${required} assente`, { code: "missing_tool" });
    }
  }
  for (const required of REQUIRED_TOOLS) {
    const tool = result.tools.find((candidate) => candidate?.name === required);
    const annotations = tool?.annotations;
    const inputRequired = tool?.inputSchema?.required ?? [];
    const outputRequired = tool?.outputSchema?.required ?? [];
    const inputProperties = tool?.inputSchema?.properties;
    const outputProperties = tool?.outputSchema?.properties;
    const schemasValid = required === "list_datasets"
      ? Object.keys(inputProperties ?? {}).length === 0
        && inputRequired.length === 0
        && ["datasets", "relatedMcpServices"].every(
          (field) => outputRequired.includes(field) && Object.hasOwn(outputProperties ?? {}, field),
        )
      : inputRequired.includes("dataset")
        && ["dataset", "year", "query", "level", "limit"].every(
          (field) => Object.hasOwn(inputProperties ?? {}, field),
        )
        && ["ok", "dataset"].every(
          (field) => outputRequired.includes(field) && Object.hasOwn(outputProperties ?? {}, field),
        );
    if (
      typeof tool?.title !== "string"
      || tool.title.trim() === ""
      || typeof tool.description !== "string"
      || tool.description.trim() === ""
      || tool.inputSchema?.type !== "object"
      || tool.inputSchema?.additionalProperties !== false
      || tool.outputSchema?.type !== "object"
      || tool.outputSchema?.additionalProperties !== false
      || !schemasValid
      || JSON.stringify(tool.securitySchemes) !== '[{"type":"noauth"}]'
      || JSON.stringify(tool._meta?.securitySchemes) !== '[{"type":"noauth"}]'
      || annotations?.readOnlyHint !== true
      || annotations.destructiveHint !== false
      || annotations.idempotentHint !== true
      || annotations.openWorldHint !== false
    ) {
      throw new RuntimeHealthError(`${label}: annotazioni read-only non valide per ${required}`, {
        code: "invalid_tool_annotations",
      });
    }
  }
  return { status: response.status, toolCount: result.tools.length, contract: result.tools };
}

export function validateSnapshotQueryPayload(response, body) {
  if (response.status !== 200) {
    throw new RuntimeHealthError(`MCP snapshot query HTTP ${response.status}`, {
      code: "unexpected_status",
    });
  }
  assertContentType(response, MCP_CONTENT_TYPE, "MCP snapshot query");
  assertMcpHeaders(response, "MCP snapshot query");
  const result = requireRpcResult(parseRpcEnvelope(body, "MCP snapshot query"), "MCP snapshot query");
  if (result.isError === true) {
    throw new RuntimeHealthError("MCP snapshot query con isError=true", { code: "rpc_tool_error" });
  }
  const structured = result.structuredContent;
  if (
    !structured
    || structured.ok !== true
    || structured.dataset !== "mef_irpef_comunale"
    || structured.query?.dataset !== "mef_irpef_comunale"
    || structured.query?.year !== 2024
    || structured.query?.level !== "municipality"
    || structured.query?.query !== "Abano"
    || structured.query?.limit !== 1
    || !structured.data
    || typeof structured.data !== "object"
    || structured.data.dataset !== "mef_irpef_comunale"
    || structured.data.period?.taxYear !== 2024
    || structured.data.level !== "municipality"
    || structured.data.query?.query !== "Abano"
    || structured.data.pagination?.returned !== 1
    || structured.data.pagination?.limit !== 1
    || structured.data.pagination?.total !== 1
    || structured.data.pagination?.offset !== 0
    || !Array.isArray(structured.data.data)
    || structured.data.data.length !== 1
    || structured.data.data[0]?.territory?.code !== "028001"
    || structured.data.data[0]?.territory?.name !== "ABANO TERME"
    || structured.data.provenance?.source?.owner !== "MEF – Dipartimento delle Finanze"
    || !Array.isArray(result.content)
    || !result.content.some(
      (item) => item?.type === "text" && item.text.includes("mef_irpef_comunale"),
    )
  ) {
    throw new RuntimeHealthError("MCP snapshot query con contratto non valido", {
      code: "invalid_snapshot_query_contract",
    });
  }
  let assetUrl;
  try {
    assetUrl = new URL(structured.data.provenance.source.assetUrl);
  } catch {
    assetUrl = null;
  }
  if (assetUrl?.protocol !== "https:" || assetUrl.hostname !== "www1.finanze.gov.it") {
    throw new RuntimeHealthError("MCP snapshot query senza provenienza HTTPS valida", {
      code: "invalid_snapshot_query_contract",
    });
  }
  return { status: response.status, dataset: "mef_irpef_comunale", returned: 1 };
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl).href;
}

function safeError(error) {
  const message = errorMessage(error).replace(/\s+/gu, " ").trim();
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function checkRecord(name, result, startedAt) {
  return {
    name,
    status: "pass",
    durationMs: Math.max(0, Date.now() - startedAt),
    attempts: result.attempts ?? 1,
    ...Object.fromEntries(
      Object.entries(result).filter(
        ([key]) => !["body", "response", "attempts", "status", "contract"].includes(key),
      ),
    ),
  };
}

function checkFailure(name, error, startedAt) {
  return {
    name,
    status: "fail",
    durationMs: Math.max(0, Date.now() - startedAt),
    attempts: error instanceof RuntimeHealthError ? error.attempts : 1,
    error: safeError(error),
    code: error instanceof RuntimeHealthError ? error.code : "check_failed",
  };
}

function validateRequestResult(result, validator) {
  try {
    return validator(result.response, result.body);
  } catch (error) {
    if (error instanceof RuntimeHealthError) {
      error.attempts = result.attempts;
    }
    throw error;
  }
}

async function requestCheck(baseUrl, pathname, options = {}) {
  const result = await requestWithRetry(endpoint(baseUrl, pathname), options);
  return {
    ...result,
    contentType: result.response.headers.get("content-type") ?? "",
  };
}

/**
 * Run all checks sequentially so the expensive source probe is never
 * multiplied by parallel monitor work. Source and MCP POST probes use one
 * attempt only to avoid overlapping upstream fans or replaying requests.
 */
export async function runHealthMonitor({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  observedAt = new Date().toISOString(),
  additionalAllowedOrigins = [],
} = {}) {
  const resolvedBaseUrl = resolveBaseUrl(baseUrl, { additionalAllowedOrigins });
  let canonicalToolsContract;
  const report = {
    ok: true,
    observedAt,
    baseUrl: resolvedBaseUrl.origin,
    checks: [],
    warnings: [],
  };

  const checks = [
    {
      name: "homepage",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/", {
          fetchImpl,
          sleepImpl,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        return validateRequestResult(result, validateHomepage);
      },
    },
    {
      name: "health",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/api/health", {
          fetchImpl,
          sleepImpl,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        return validateRequestResult(result, validateHealthPayload);
      },
    },
    {
      name: "source-health",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/api/fonti/stato", {
          fetchImpl,
          sleepImpl,
          timeoutMs: SOURCE_HEALTH_TIMEOUT_MS,
          maxAttempts: 1,
        });
        return validateRequestResult(result, validateSourceHealthPayload);
      },
    },
    {
      name: "mcp-api-initialize",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/api/mcp", {
          fetchImpl,
          sleepImpl,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxAttempts: 1,
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "dvns-runtime-health", version: "1.0.0" },
            },
          }),
        });
        return validateRequestResult(result, validateInitializePayload);
      },
    },
    {
      name: "mcp-api-tools-list",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/api/mcp", {
          fetchImpl,
          sleepImpl,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxAttempts: 1,
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        });
        const validated = validateRequestResult(
          result,
          (response, body) => validateToolsListPayload(response, body, "MCP API tools/list"),
        );
        canonicalToolsContract = JSON.stringify(validated.contract);
        return validated;
      },
    },
    {
      name: "mcp-alias-tools-list",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/mcp", {
          fetchImpl,
          sleepImpl,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxAttempts: 1,
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
        });
        const validated = validateRequestResult(
          result,
          (response, body) => validateToolsListPayload(response, body, "MCP alias tools/list"),
        );
        if (canonicalToolsContract === undefined || JSON.stringify(validated.contract) !== canonicalToolsContract) {
          throw new RuntimeHealthError("MCP alias con contratto tools diverso dall'endpoint canonico", {
            code: "alias_contract_drift",
          });
        }
        return validated;
      },
    },
    {
      name: "mcp-snapshot-query",
      run: async () => {
        const result = await requestCheck(resolvedBaseUrl, "/api/mcp", {
          fetchImpl,
          sleepImpl,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxAttempts: 1,
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
              name: "query_dataset",
              arguments: {
                dataset: "mef_irpef_comunale",
                year: 2024,
                level: "municipality",
                query: "Abano",
                limit: 1,
              },
            },
          }),
        });
        return validateRequestResult(result, validateSnapshotQueryPayload);
      },
    },
  ];

  for (const check of checks) {
    const startedAt = Date.now();
    try {
      const result = await check.run();
      const record = checkRecord(check.name, result, startedAt);
      report.checks.push(record);
      if (result.warning) {
        report.warnings.push({ check: check.name, warning: result.warning, down: result.down });
      }
    } catch (error) {
      report.ok = false;
      report.checks.push(checkFailure(check.name, error, startedAt));
    }
  }

  return report;
}

export async function writeReport(report, reportPath = DEFAULT_REPORT_PATH) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report) {
  const lines = [
    "## Runtime health",
    "",
    "| Check | Status | Attempts | Duration | Detail |",
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const check of report.checks) {
    const detail = check.error ?? (check.warning ?? "ok");
    lines.push(`| ${check.name} | ${check.status} | ${check.attempts} | ${check.durationMs} ms | ${detail} |`);
  }
  for (const warning of report.warnings) {
    lines.push(`| ${warning.check} | warning | — | — | ${warning.warning} |`);
  }
  const summary = lines.join("\n");
  console.log(summary);
}

export function parseCliArgs(argv = []) {
  let reportPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--output") {
      const error = new RuntimeHealthError(`Argomento CLI non riconosciuto: ${argument}`, {
        code: "invalid_cli",
      });
      error.reportPath = reportPath;
      throw error;
    }
    const candidate = argv[index + 1];
    if (!candidate || candidate.startsWith("--")) {
      const error = new RuntimeHealthError("--output richiede un percorso", {
        code: "invalid_cli",
      });
      error.reportPath = reportPath;
      throw error;
    }
    if (reportPath !== undefined) {
      const error = new RuntimeHealthError("--output specificato più di una volta", {
        code: "invalid_cli",
      });
      error.reportPath = reportPath;
      throw error;
    }
    reportPath = candidate;
    index += 1;
  }
  return { reportPath };
}

export async function main({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  argv = process.argv.slice(2),
  reportPath,
} = {}) {
  let resolvedReportPath = reportPath ?? env.RUNTIME_HEALTH_REPORT_PATH ?? DEFAULT_REPORT_PATH;
  let report;
  try {
    const cli = parseCliArgs(argv);
    resolvedReportPath = cli.reportPath ?? resolvedReportPath;
    report = await runHealthMonitor({
      baseUrl: env.CANONICAL_BASE_URL ?? DEFAULT_BASE_URL,
      fetchImpl,
      sleepImpl,
    });
  } catch (error) {
    if (error?.reportPath) resolvedReportPath = error.reportPath;
    report = {
      ok: false,
      observedAt: new Date().toISOString(),
      baseUrl: null,
      checks: [],
      warnings: [],
      error: safeError(error),
    };
  }

  await writeReport(report, resolvedReportPath);
  printSummary(report);
  return report.ok ? 0 : 1;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`Runtime health report failure: ${safeError(error)}`);
    process.exitCode = 1;
  });
}
