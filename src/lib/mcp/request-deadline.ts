type McpFetch = (request: Request) => Promise<Response>;
type JsonRpcId = string | number | null;
type DeadlineOptions = Readonly<{
  requestId?: () => JsonRpcId;
  onTimeout?: () => void;
  isSubscription?: () => boolean;
  onComplete?: () => void;
}>;

/** A subscription has a bounded lifetime, but its EOF is not an RPC timeout. */
function subscriptionResponse(
  response: Response,
  signal: AbortSignal,
  abort: () => void,
  remainingMs: number,
  onComplete?: () => void,
): Response {
  const reader = response.body!.getReader();
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = (reason?: unknown, error = false, cancelled = false) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (!cancelled) {
      if (error) output.error(reason);
      else output.close();
    }
    void reader.cancel(reason).catch(() => undefined).finally(() => reader.releaseLock());
    abort();
    onComplete?.();
  };
  const onAbort = () => finish(signal.reason);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      timer = setTimeout(() => finish("MCP subscription lifetime ended"), remainingMs);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (closed) return;
        if (done) finish();
        else controller.enqueue(value);
      } catch (error) {
        finish(error, true);
      }
    },
    cancel(reason) { finish(reason, false, true); },
  });
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function timeoutResponse(id: JsonRpcId): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Timeout della richiesta MCP" },
      id,
    },
    { status: 504 },
  );
}

async function bufferedResponse(
  response: Response,
  state: { reader: ReadableStreamDefaultReader<Uint8Array> | null; timedOut: boolean },
): Promise<Response> {
  if (!response.body) return response;

  const reader = response.body.getReader();
  state.reader = reader;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (state.timedOut) throw new DOMException("MCP deadline exceeded", "TimeoutError");
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    state.reader = null;
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Run and fully drain one bounded MCP exchange.
 *
 * Draining is intentional: legacy Streamable HTTP replies expose their SSE
 * headers before a tool finishes. Waiting for the terminal frame keeps the
 * application deadline in charge of the whole exchange instead of only the
 * time-to-first-byte. Subscription SSE is the exception: forward it immediately
 * and end its lifetime with a clean EOF, retaining the slot until it closes.
 */
export async function runMcpExchangeWithDeadline(
  request: Request,
  fetcher: McpFetch,
  timeoutMs: number,
  options: DeadlineOptions = {},
): Promise<Response> {
  const startedAt = performance.now();
  let streaming = false;
  const controller = new AbortController();
  const signal = request.signal.aborted
    ? request.signal
    : AbortSignal.any([request.signal, controller.signal]);
  const timedRequest = new Request(request, { signal });
  const state = {
    reader: null as ReadableStreamDefaultReader<Uint8Array> | null,
    timedOut: false,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Response>((resolve) => {
    timer = setTimeout(() => {
      state.timedOut = true;
      // Settle the public result before abort listeners can reject the losing
      // handler promise; callers must deterministically receive the 504.
      let requestId: JsonRpcId = null;
      try {
        requestId = options.requestId?.() ?? null;
      } catch {
        requestId = null;
      }
      resolve(timeoutResponse(requestId));
      try {
        options.onTimeout?.();
      } catch {
        // Operational telemetry must never prevent aborting an expired exchange.
      } finally {
        controller.abort(new DOMException("MCP deadline exceeded", "TimeoutError"));
        void state.reader?.cancel("MCP deadline exceeded").catch(() => undefined);
      }
    }, timeoutMs);
  });

  const exchange = (async () => {
    const response = await fetcher(timedRequest);
    if (state.timedOut) {
      void response.body?.cancel("MCP deadline exceeded").catch(() => undefined);
      return response;
    }
    if (!state.timedOut && response.ok && response.body
      && response.headers.get("content-type")?.split(";", 1)[0].trim() === "text/event-stream"
      && options.isSubscription?.()) {
      streaming = true;
      return subscriptionResponse(
        response, signal, () => controller.abort(),
        Math.max(0, timeoutMs - (performance.now() - startedAt)), options.onComplete,
      );
    }
    return bufferedResponse(response, state);
  })();
  try {
    return await Promise.race([exchange, deadline]);
  } finally {
    if (!state.timedOut && timer) clearTimeout(timer);
    if (!streaming) options.onComplete?.();
  }
}
