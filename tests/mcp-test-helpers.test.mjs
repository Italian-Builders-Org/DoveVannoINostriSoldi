import assert from "node:assert/strict";
import test from "node:test";
import { successfulMcpToolResult } from "../scripts/mcp_test_helpers.mjs";

function envelope(result) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result });
}

test("MCP smoke helpers accept only application-level success", () => {
  const success = successfulMcpToolResult(envelope({
    resultType: "complete",
    structuredContent: { ok: true, dataset: "mef_irpef_comunale", data: { value: 1 } },
  }), "mef_irpef_comunale");
  assert.deepEqual(success.data, { value: 1 });

  assert.throws(
    () => successfulMcpToolResult(envelope({
      resultType: "complete",
      isError: true,
      structuredContent: { ok: false, dataset: "mef_irpef_comunale" },
    }), "mef_irpef_comunale"),
    /isError=true/,
  );
  assert.throws(
    () => successfulMcpToolResult(envelope({
      resultType: "complete",
      structuredContent: { ok: false, dataset: "mef_irpef_comunale" },
    }), "mef_irpef_comunale"),
    /structuredContent\.ok/,
  );
});

test("MCP smoke helpers parse SSE data envelopes", () => {
  const body = `event: message\ndata: ${envelope({
    resultType: "complete",
    structuredContent: { ok: true, dataset: "mef_irpef_comunale", data: { value: 2 } },
  })}\n\n`;
  assert.deepEqual(successfulMcpToolResult(body, "mef_irpef_comunale").data, { value: 2 });
});

test("MCP smoke helpers distinguish legacy and modern completion markers", () => {
  const legacy = envelope({
    structuredContent: { ok: true, dataset: "mef_irpef_comunale", data: { value: 3 } },
  });
  assert.deepEqual(successfulMcpToolResult(legacy, "mef_irpef_comunale").data, { value: 3 });
  assert.throws(
    () => successfulMcpToolResult(legacy, "mef_irpef_comunale", { requireComplete: true }),
    /complete/,
  );
});
