export type McpJsonRpcId = string | number | null;

export type McpOperationalContext = Readonly<{
  protocol: string;
  method: string;
  tool: string;
  requestId: McpJsonRpcId;
}>;

type JsonObject = Record<string, unknown>;

const OPERATIONAL_LOG_WINDOW_MS = 60_000;
const OPERATIONAL_LOG_MAX_KEYS = 8;

/**
 * Deterministic, per-instance throttle for low-cardinality operational events.
 *
 * Keys are selected by the caller from a fixed internal vocabulary; request
 * data, addresses and identifiers must never be used here. The hard cap keeps
 * memory bounded even if a future caller accidentally introduces more keys.
 */
export class BoundedOperationalLogThrottle {
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, number>();

  constructor(windowMs: number, { maxKeys = OPERATIONAL_LOG_MAX_KEYS }: { maxKeys?: number } = {}) {
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new Error("Operational log window must be a positive integer");
    }
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) {
      throw new Error("Operational log key limit must be a positive integer");
    }
    this.#windowMs = windowMs;
    this.#maxKeys = maxKeys;
  }

  shouldEmit(key: string, now = Date.now()): boolean {
    const window = Math.floor(now / this.#windowMs);
    if (this.#windows.get(key) === window) return false;

    if (!this.#windows.has(key) && this.#windows.size >= this.#maxKeys) {
      const oldest = this.#windows.keys().next().value;
      if (oldest !== undefined) this.#windows.delete(oldest);
    }
    this.#windows.set(key, window);
    return true;
  }
}

const operationalLogThrottle = new BoundedOperationalLogThrottle(OPERATIONAL_LOG_WINDOW_MS);

function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function safeDimension(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[a-z0-9][a-z0-9._:/-]{0,99}$/iu.test(candidate) ? candidate : null;
}

function jsonRpcId(value: unknown): McpJsonRpcId {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function extractMcpOperationalContext(
  request: Request,
  body?: unknown,
): McpOperationalContext {
  const envelope = jsonObject(body);
  const params = jsonObject(envelope?.params);
  const meta = jsonObject(params?._meta);

  return {
    protocol: safeDimension(request.headers.get("mcp-protocol-version"))
      ?? safeDimension(meta?.["io.modelcontextprotocol/protocolVersion"])
      ?? "unknown",
    method: safeDimension(request.headers.get("mcp-method"))
      ?? safeDimension(envelope?.method)
      ?? "unknown",
    tool: safeDimension(request.headers.get("mcp-name"))
      ?? safeDimension(params?.name)
      ?? safeDimension(params?.uri)
      ?? "unknown",
    requestId: jsonRpcId(envelope?.id),
  };
}

type McpOperationalOutcome = "rate_limited" | "concurrency_limited" | "deadline_exceeded";

export function reportMcpOperationalEvent(input: Readonly<{
  outcome: McpOperationalOutcome;
  status: 429 | 503 | 504;
  durationMs: number;
  context: McpOperationalContext;
  activeRequests: number;
  concurrencyLimit: number;
}>): void {
  if (!operationalLogThrottle.shouldEmit(`limit:${input.outcome}`)) return;

  const activeRequests = Math.max(0, Math.trunc(input.activeRequests));
  const concurrencyLimit = Math.max(1, Math.trunc(input.concurrencyLimit));
  const durationMs = Number.isFinite(input.durationMs)
    ? Math.max(0, Math.round(input.durationMs))
    : 0;

  console.warn(JSON.stringify({
    event: "mcp_operational_limit",
    outcome: input.outcome,
    status: input.status,
    durationMs,
    protocol: input.context.protocol,
    method: input.context.method,
    tool: input.context.tool,
    activeRequests,
    concurrencyLimit,
    saturated: activeRequests >= concurrencyLimit,
  }));
}

export function reportMcpHandlerError(error: Error): void {
  if (error.message.startsWith("Rejected inbound request")) return;
  if (!operationalLogThrottle.shouldEmit("handler_error")) return;
  console.error(JSON.stringify({ event: "mcp_handler_error" }));
}
