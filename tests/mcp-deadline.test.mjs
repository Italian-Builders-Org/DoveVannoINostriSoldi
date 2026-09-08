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

test("MCP subscriptions deliver the acknowledgement immediately and close cleanly at the deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false, completed = 0, timeouts = 0, signal;
  const pending = runMcpExchangeWithDeadline(
    new Request("https://example.test/api/mcp", { method: "POST" }),
    async (request) => {
      signal = request.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("data: acknowledged\n\n")); },
        cancel() { cancelled = true; },
      }), { headers: { "Content-Type": "text/event-stream" } });
    },
    25,
    { isSubscription: () => true, onComplete: () => completed++, onTimeout: () => timeouts++ },
  );
  let response;
  pending.then((value) => { response = value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(response, "subscription headers must be delivered before the deadline");
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /acknowledged/);
  assert.equal(completed, 0, "keep the concurrency slot until the stream ends");
  context.mock.timers.tick(25);
  assert.equal((await reader.read()).done, true);
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
  assert.equal(completed, 1);
  assert.equal(timeouts, 0, "a normal subscription lifetime is not a request timeout");
});

for (const mode of ["cancel", "abort", "eof", "error"]) {
  test(`MCP subscription releases resources once on ${mode}`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const caller = new AbortController();
    let source, cancelled = 0, completed = 0;
    const response = await runMcpExchangeWithDeadline(
      new Request("https://example.test/api/mcp", { method: "POST", signal: caller.signal }),
      async () => new Response(new ReadableStream({
        start(controller) { source = controller; },
        cancel() { cancelled++; },
      }), { headers: { "Content-Type": "text/event-stream" } }),
      25,
      { isSubscription: () => true, onComplete: () => completed++ },
    );
    const reader = response.body.getReader();
    if (mode === "cancel") await reader.cancel();
    else if (mode === "abort") { caller.abort(); assert.equal((await reader.read()).done, true); }
    else if (mode === "eof") { source.close(); assert.equal((await reader.read()).done, true); }
    else { source.error(new Error("broken stream")); await assert.rejects(reader.read(), /broken stream/); }
    assert.equal(completed, 1);
    if (["cancel", "abort"].includes(mode)) assert.equal(cancelled, 1);
    context.mock.timers.tick(100);
    assert.equal(completed, 1);
  });
}

test("MCP subscription setup errors remain finite JSON responses", async () => {
  let completed = 0;
  const response = await runMcpExchangeWithDeadline(
    new Request("https://example.test/api/mcp", { method: "POST" }),
    async () => Response.json({ error: "invalid subscription" }, { status: 400 }),
    25,
    { isSubscription: () => true, onComplete: () => completed++ },
  );
  assert.equal(response.status, 400);
  assert.equal(completed, 1);
});

test("MCP still times out subscription setup and cancels a late response", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let deliver, completed = 0, timeouts = 0, cancelled = false;
  const pending = runMcpExchangeWithDeadline(
    new Request("https://example.test/api/mcp", { method: "POST" }),
    () => new Promise((resolve) => { deliver = resolve; }), 25,
    { isSubscription: () => true, onComplete: () => completed++, onTimeout: () => timeouts++ },
  );
  context.mock.timers.tick(25);
  assert.equal((await pending).status, 504);
  deliver(new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { "Content-Type": "text/event-stream" },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(completed, 1);
  assert.equal(timeouts, 1);
});
