type McpFetch = (request: Request) => Promise<Response>;

function timeoutResponse(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Timeout della richiesta MCP" },
      id: null,
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
 * time-to-first-byte.
 */
export async function runMcpExchangeWithDeadline(
  request: Request,
  fetcher: McpFetch,
  timeoutMs: number,
): Promise<Response> {
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
      resolve(timeoutResponse());
      controller.abort(new DOMException("MCP deadline exceeded", "TimeoutError"));
      void state.reader?.cancel("MCP deadline exceeded").catch(() => undefined);
    }, timeoutMs);
  });

  const exchange = (async () => bufferedResponse(await fetcher(timedRequest), state))();
  try {
    return await Promise.race([exchange, deadline]);
  } finally {
    if (!state.timedOut && timer) clearTimeout(timer);
  }
}
