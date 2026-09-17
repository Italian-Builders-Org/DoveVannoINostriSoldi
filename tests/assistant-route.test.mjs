import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { POST } = await import("../src/app/api/assistant/route.ts");

function request({ headers = {}, body = JSON.stringify({ prompt: "aiuto" }), url = "https://example.test/api/assistant" } = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(url).origin,
      Host: new URL(url).host,
      ...headers,
    },
    body,
  });
}

test("assistant API rejects non-JSON requests", async () => {
  const response = await POST(request({ headers: { "Content-Type": "text/plain" } }));
  assert.equal(response.status, 415);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("assistant API rejects missing or foreign origins", async () => {
  const missing = new Request("https://example.test/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "example.test" },
    body: JSON.stringify({ prompt: "aiuto" }),
  });
  assert.equal((await POST(missing)).status, 403);

  const foreign = await POST(request({ headers: { Origin: "https://attacker.test" } }));
  assert.equal(foreign.status, 403);
  assert.match(await foreign.text(), /Origin non consentita/);
});

test("assistant API rejects host confusion and invalid content length", async () => {
  const host = await POST(request({ headers: { Host: "other.test" } }));
  assert.equal(host.status, 403);
  assert.match(await host.text(), /Host non consentito/);

  const length = await POST(request({ headers: { "Content-Length": "wat" } }));
  assert.equal(length.status, 400);
  assert.match(await length.text(), /Content-Length non valido/);
});

test("assistant API accepts an HTTPS or loopback HTTP origin with an IPv6 host and port", async () => {
  const response = await POST(request({
    url: "http://[::1]:3000/api/assistant",
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).kind, "help");

  const alternateLoopback = await POST(request({
    url: "http://localhost:3000/api/assistant",
    headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
  }));
  assert.equal(alternateLoopback.status, 200);
  assert.equal((await alternateLoopback.json()).kind, "help");
});

test("assistant API enforces declared and streamed body limits", async () => {
  const declared = await POST(request({ headers: { "Content-Length": "16385" } }));
  assert.equal(declared.status, 413);

  const streamed = await POST(request({ body: JSON.stringify({ prompt: "x".repeat(20_000) }) }));
  assert.equal(streamed.status, 413);
});

test("assistant API cancels a body reader when the request is aborted", async () => {
  const controller = new AbortController();
  const body = new ReadableStream({ start() {} });
  const pending = POST({
    url: "https://example.test/api/assistant",
    headers: new Headers({
      "Content-Type": "application/json",
      Origin: "https://example.test",
      Host: "example.test",
    }),
    body,
    signal: controller.signal,
  });
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 400);
  assert.match(await response.text(), /interrotta/);
});

test("assistant API exposes a deterministic help response without provider calls", async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "help");
  assert.ok(Array.isArray(payload.examples));
  assert.equal(JSON.stringify(payload).includes("provider"), false);
});

test("assistant API returns the same verified national SIOPE value as the adapter", async () => {
  const response = await POST(request({
    body: JSON.stringify({ prompt: "Quanto hanno speso i Comuni nel 2025?" }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "answer");
  assert.equal(payload.answer.dataset, "siope_comuni");
  assert.equal(payload.answer.observation.value, 114197852372.52);
  assert.equal(payload.answer.observation.scope, "Italia");
  assert.ok(payload.answer.source.url.startsWith("https://"));
  assert.ok(payload.answer.caveats.length > 0);
});

test("assistant API rejects malformed JSON and unsupported request fields", async () => {
  const malformed = await POST(request({ body: "{" }));
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /JSON/);

  const fields = await POST(request({ body: JSON.stringify({ prompt: "aiuto", history: [] }) }));
  assert.equal(fields.status, 400);
  const payload = await fields.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "invalid_request");
});

test("assistant API rate-limits malformed bodies before reading another payload", async () => {
  const address = "198.51.100.240";
  for (let index = 0; index < 30; index += 1) {
    const malformed = await POST(request({
      headers: { "X-Forwarded-For": address },
      body: "{",
    }));
    assert.equal(malformed.status, 400, `payload malformato ${index + 1}`);
  }

  const limited = await POST(request({ headers: { "X-Forwarded-For": address } }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("assistant API preserves both years and source receipts in a comparison", async () => {
  const response = await POST(request({
    body: JSON.stringify({ prompt: "Confronta i pagamenti dei Comuni tra 2024 e 2025" }),
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const payload = await response.json();
  assert.equal(payload.kind, "comparison");
  assert.deepEqual(payload.comparison.answers.map((answer) => answer.period.year), [2024, 2025]);
  assert.equal(payload.comparison.answers[1].observation.value, 114197852372.52);
  assert.ok(payload.comparison.answers.every((answer) => answer.source.url.startsWith("https://")));
  assert.ok(Number.isFinite(payload.comparison.change.euro));
});
