import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/esplora/route.ts");

test("GET /api/esplora filtra senza fondere persone", async () => {
  const response = GET(new Request("https://example.test/api/esplora?q=ROSSI&limit=50"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
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
      result.note_source,
    ].join(" ");
    assert.match(haystack, /ROSSI/i, "risultato fuori query");
  }
});

test("GET /api/esplora espone un hint sicuro senza query", async () => {
  const response = GET(new Request("https://example.test/api/esplora"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
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
