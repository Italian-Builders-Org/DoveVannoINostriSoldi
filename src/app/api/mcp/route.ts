import { createMcpHandler } from "@modelcontextprotocol/server";
import { createDvnsMcpServer } from "@/lib/mcp/server";
import { runMcpExchangeWithDeadline } from "@/lib/mcp/request-deadline";
import {
  extractMcpOperationalContext,
  reportMcpHandlerError,
  reportMcpOperationalEvent,
} from "@/lib/mcp/operational-telemetry";
import { ConcurrencyLimiter, SlidingWindowLimiter, clientAddress } from "@/lib/report/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_REQUEST_BYTES = 1_000_000;
const MCP_HANDLER_TIMEOUT_MS = 12_000;
const MCP_INSTANCE_POST_LIMIT = 30;
const MCP_INSTANCE_POST_WINDOW_MS = 60_000;
const mcpLimiter = new SlidingWindowLimiter({
  windowMs: MCP_INSTANCE_POST_WINDOW_MS,
  max: MCP_INSTANCE_POST_LIMIT,
});
const mcpConcurrency = new ConcurrencyLimiter(8);

const handler = createMcpHandler(createDvnsMcpServer, {
  legacy: "stateless",
  responseMode: "json",
  onerror: reportMcpHandlerError,
});

function secureResponse(response: Response, request?: Request): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (request && requestHostAllowed(request)) {
    const origin = request.headers.get("origin");
    const normalized = origin ? normalizedOrigin(origin) : null;
    if (normalized && allowedOrigins(request).has(normalized)) {
      response.headers.set("Access-Control-Allow-Origin", normalized);
      response.headers.append("Vary", "Origin");
    }
  }
  return response;
}

function requestHostAllowed(request: Request): boolean {
  const host = normalizedHost(request.headers.get("host") ?? new URL(request.url).host);
  return host !== null && allowedHosts(request).has(host);
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function allowedOrigins(request: Request): Set<string> {
  const requestUrl = new URL(request.url);
  const requestHost = normalizedHost(request.headers.get("host") ?? "");
  const validatedHostOrigin = requestHost && requestHostAllowed(request)
    ? `${requestUrl.protocol}//${requestHost}`
    : null;
  const requestOrigin = normalizedOrigin(request.headers.get("origin") ?? "");
  const requestOriginUrl = requestOrigin ? new URL(requestOrigin) : null;
  const requestUrlHost = normalizedHost(requestUrl.host);
  const requestOriginHost = requestOriginUrl ? normalizedHost(requestOriginUrl.host) : null;
  const equivalentLoopbackOrigin =
    requestOriginUrl
    && requestUrlHost
    && requestOriginHost
    && requestOriginUrl.protocol === requestUrl.protocol
    && requestOriginUrl.port === requestUrl.port
    && isLoopbackHost(requestUrlHost)
    && isLoopbackHost(requestOriginHost)
      ? requestOrigin
      : null;
  const configured = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizedOrigin)
    .filter((value): value is string => value !== null);
  return new Set([requestUrl.origin, validatedHostOrigin, equivalentLoopbackOrigin, ...configured].filter(
    (value): value is string => value !== null,
  ));
}

function normalizedHost(value: string): string | null {
  const candidate = value.trim().toLocaleLowerCase("en-US").replace(/\.$/, "");
  if (!candidate || /[\s/@]/.test(candidate)) return null;
  return candidate;
}

function isLoopbackHost(value: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(value);
}

function allowedHosts(request: Request): Set<string> {
  const requestUrl = new URL(request.url);
  const configured = [
    ...(process.env.MCP_ALLOWED_HOSTS ?? "").split(","),
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.replace(/^https?:\/\//i, ""))
    .map(normalizedHost)
    .filter((value): value is string => value !== null);

  const allowed = new Set(configured);
  const requestUrlHost = normalizedHost(requestUrl.host);
  if (requestUrlHost && isLoopbackHost(requestUrlHost)) allowed.add(requestUrlHost);
  const requestHost = normalizedHost(request.headers.get("host") ?? "");
  if (
    requestHost &&
    isLoopbackHost(requestHost) &&
    requestUrlHost &&
    isLoopbackHost(requestUrlHost)
  ) {
    allowed.add(requestHost);
  }
  return allowed;
}

function validateRequest(request: Request): Response | null {
  if (!requestHostAllowed(request)) {
    return Response.json({ error: "Host non consentito" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  const normalized = origin ? normalizedOrigin(origin) : null;
  if (origin && (!normalized || !allowedOrigins(request).has(normalized))) {
    return Response.json({ error: "Origin non consentita" }, { status: 403 });
  }
  const declaredLength = request.headers.get("content-length");
  const contentLength = declaredLength === null ? null : Number.parseInt(declaredLength, 10);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Richiesta troppo grande" }, { status: 413 });
  }
  return null;
}

async function requestWithBoundedBody(request: Request): Promise<Request | Response> {
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const read = () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    if (request.signal.aborted) {
      reject(request.signal.reason);
      return;
    }
    const onAbort = () => reject(request.signal.reason);
    request.signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        request.signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        request.signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });

  while (true) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await read();
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    }
    const { done, value } = result;
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel("MCP request body limit exceeded").catch(() => undefined);
      return Response.json({ error: "Richiesta troppo grande" }, { status: 413 });
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(request.headers);
  headers.set("Content-Length", String(body.byteLength));
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  let operationalContext = extractMcpOperationalContext(request);
  const reportOperationalLimit = (
    outcome: "rate_limited" | "concurrency_limited" | "deadline_exceeded",
    status: 429 | 503 | 504,
  ) => reportMcpOperationalEvent({
    outcome,
    status,
    durationMs: performance.now() - startedAt,
    context: operationalContext,
    activeRequests: mcpConcurrency.active,
    concurrencyLimit: mcpConcurrency.max,
  });

  const rejected = validateRequest(request);
  if (rejected) return secureResponse(rejected, request);

  const clientKey = clientAddress(request) ?? "unknown";
  if (!mcpLimiter.consume(clientKey)) {
    reportOperationalLimit("rate_limited", 429);
    return secureResponse(Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Troppe richieste. Riprova tra un minuto." },
        id: operationalContext.requestId,
      },
      { status: 429, headers: { "Retry-After": "60" } },
    ), request);
  }

  const release = mcpConcurrency.tryAcquire();
  if (!release) {
    reportOperationalLimit("concurrency_limited", 503);
    return secureResponse(Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Server MCP occupato. Riprova tra pochi secondi." },
        id: operationalContext.requestId,
      },
      { status: 503, headers: { "Retry-After": "5" } },
    ), request);
  }

  try {
    const response = await runMcpExchangeWithDeadline(
      request,
      async (timedRequest) => {
        let boundedRequest: Request | Response;
        try {
          boundedRequest = await requestWithBoundedBody(timedRequest);
        } catch {
          if (timedRequest.signal.aborted) throw timedRequest.signal.reason;
          return Response.json(
            { error: "Richiesta interrotta o non leggibile" },
            { status: 400 },
          );
        }
        if (boundedRequest instanceof Response) return boundedRequest;
        try {
          operationalContext = extractMcpOperationalContext(
            boundedRequest,
            await boundedRequest.clone().json(),
          );
        } catch {
          operationalContext = extractMcpOperationalContext(boundedRequest);
        }
        return handler.fetch(boundedRequest);
      },
      MCP_HANDLER_TIMEOUT_MS,
      {
        requestId: () => operationalContext.requestId,
        onTimeout: () => reportOperationalLimit("deadline_exceeded", 504),
      },
    );
    return secureResponse(response, request);
  } finally {
    release();
  }
}

export function OPTIONS(request: Request) {
  const rejected = validateRequest(request);
  if (rejected) return secureResponse(rejected, request);

  const response = new Response(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, Last-Event-ID, MCP-Method, MCP-Name, MCP-Protocol-Version, MCP-Session-ID",
  );
  response.headers.set("Access-Control-Max-Age", "600");
  return secureResponse(response, request);
}

export function GET(request: Request) {
  const rejected = validateRequest(request);
  if (rejected) return secureResponse(rejected, request);

  return secureResponse(Response.json(
    { error: "Questo server MCP usa Streamable HTTP tramite POST" },
    { status: 405, headers: { Allow: "POST, OPTIONS, HEAD" } },
  ), request);
}

export function HEAD(request: Request) {
  const rejected = validateRequest(request);
  if (rejected) return secureResponse(rejected, request);
  return secureResponse(new Response(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS, HEAD" },
  }), request);
}
