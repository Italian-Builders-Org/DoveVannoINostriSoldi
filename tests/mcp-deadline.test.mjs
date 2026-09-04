import assert from "node:assert/strict";
import test from "node:test";

const { runMcpExchangeWithDeadline } = await import("../src/lib/mcp/request-deadline.ts");

test("MCP deadline closes a streaming exchange even when the handler never finishes", { timeout: 2_000 }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  let streamCancelled = false;
  let timeoutEvents = 0;

  const pending = runMcpExchangeWithDeadline(
    new Request("https://example.test/api/mcp", { method: "POST" }),
    async (request) => {
      requestSignal = request.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: message\ndata: partial\n\n"));
        },
        cancel() {
          streamCancelled = true;
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    },
    25,
    {
      requestId: () => "rpc-timeout-42",
      onTimeout: () => { timeoutEvents += 1; },
    },
  );

  // Let the response body acquire its reader before advancing the deadline.
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(24);
  assert.equal(requestSignal.aborted, false);
  assert.equal(timeoutEvents, 0);
  context.mock.timers.tick(1);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Timeout della richiesta MCP" },
    id: "rpc-timeout-42",
  });
  assert.equal(requestSignal.aborted, true);
  assert.equal(streamCancelled, true);
  assert.equal(timeoutEvents, 1);
});

test("MCP deadline buffers a completed SSE response before returning it", async () => {
  const response = await runMcpExchangeWithDeadline(
    new Request("https://example.test/api/mcp", { method: "POST" }),
    async () => new Response("event: message\ndata: complete\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "X-Test": "preserved" },
    }),
    250,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-test"), "preserved");
  assert.equal(await response.text(), "event: message\ndata: complete\n\n");
});
