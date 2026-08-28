import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/esplora/route.ts");

test("GET /api/esplora filtra senza fondere persone", async () => {
  const response = GET(new Request("https://example.test/api/esplora?q=ROSSI&limit=50"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const data = await response.json();
  assert.equal(data.query, "ROSSI");
  assert.ok(Array.isArray(data.results));
  assert.ok(data.results.length <= 50);
  const ids = new Set(data.results.map((result) => result.source_record_id));
  assert.equal(ids.size, data.results.length, "nessun arco duplicato nella risposta");
  for (const result of data.results) {
    const haystack = [
      result.subject_key,
      result.object_key,
      result.source_record_id,
      ...(result.references?.cig ?? []),
      ...(result.references?.cup ?? []),
    ].join(" ");
    assert.ok(!("note_source" in result));
    assert.match(haystack, /ROSSI/i, "risultato fuori query");
  }
});

test("GET /api/esplora espone un hint sicuro senza query", async () => {
  const response = GET(new Request("https://example.test/api/esplora"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const data = await response.json();
  assert.equal(data.dataset, "incarichi-nominativi-shard");
  assert.match(data.hint, /\?q=/);
});

test("GET /api/esplora rifiuta query oltre 200 caratteri", async () => {
  const query = "a".repeat(201);
  const response = GET(new Request(`https://example.test/api/esplora?q=${query}`));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const data = await response.json();
  assert.match(data.error, /200 caratteri/);
});

test("GET /api/esplora rifiuta limit non intero o non positivo", async () => {
  for (const value of ["0", "-1", "1.5", "501", "Infinity", "999999999999999999999"]) {
    const response = GET(new Request(`https://example.test/api/esplora?q=ROSSI&limit=${value}`));
    assert.equal(response.status, 400, value);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  }
});

test("GET /api/esplora mantiene la risposta proiettata sotto 750 KiB", async () => {
  const response = GET(new Request("https://example.test/api/esplora?q=CONSULENTE&limit=500"));
  const body = await response.text();
  assert.ok(new TextEncoder().encode(body).byteLength <= 750 * 1024);
  const data = JSON.parse(body);
  assert.ok(Array.isArray(data.results));
  assert.equal(data.count, data.results.length);
  assert.ok(data.results.every((result) => !("note_source" in result)));
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
