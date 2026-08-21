import assert from "node:assert/strict";

function parseMcpEnvelope(body) {
  const candidates = body.trim().startsWith("{")
    ? [body]
    : body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
  assert.ok(candidates.length > 0, "Risposta MCP senza envelope JSON-RPC");
  return JSON.parse(candidates.at(-1));
}

export function successfulMcpToolResult(body, dataset, { requireComplete = false } = {}) {
  const envelope = parseMcpEnvelope(body);
  assert.equal(envelope.error, undefined, JSON.stringify(envelope.error));
  if (requireComplete) {
    assert.equal(envelope.result?.resultType, "complete");
  } else {
    assert.ok(
      envelope.result?.resultType === undefined || envelope.result.resultType === "complete",
      `resultType MCP inatteso: ${envelope.result?.resultType}`,
    );
  }
  assert.notEqual(envelope.result?.isError, true, "Il tool MCP ha restituito isError=true");
  assert.equal(envelope.result?.structuredContent?.ok, true, "structuredContent.ok non è true");
  assert.equal(envelope.result.structuredContent.dataset, dataset);
  return envelope.result.structuredContent;
}
