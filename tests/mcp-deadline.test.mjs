import assert from "node:assert/strict";
import test from "node:test";

const { runMcpExchangeWithDeadline } = await import("../src/lib/mcp/request-deadline.ts");

test("MCP deadline closes a streaming exchange even when the handler never finishes", async () => {
  let requestSignal;
  let streamCancelled = false;
  const startedAt = Date.now();

  const response = await runMcpExchangeWithDeadline(
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
  );

  const elapsedMs = Date.now() - startedAt;
  assert.equal(response.status, 504);
  assert.match(await response.text(), /Timeout della richiesta MCP/);
  assert.equal(requestSignal.aborted, true);
  assert.equal(streamCancelled, true);
  assert.ok(elapsedMs < 250, `deadline returned after ${elapsedMs}ms`);
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
