import { test } from "node:test";
import assert from "node:assert/strict";

import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/esplora/route.ts");

test("GET /api/esplora filters committed records without merging people", async () => {
  const res = GET(new Request("https://example.test/api/esplora?q=ROSSI&limit=50"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.query, "string");
  assert.ok(Array.isArray(data.results));
  assert.ok(data.results.length > 0 && data.results.length <= 50);
  const ids = new Set(data.results.map((r) => r.id));
  assert.equal(ids.size, data.results.length, "nessun arco duplicato nella risposta");
  for (const r of data.results) {
    assert.ok(
      (r.subject_key + r.object_key).toUpperCase().includes("ROSSI") ||
        r.source_record_id.toUpperCase().includes("ROSSI") ||
        (r.note_source ?? "").toUpperCase().includes("ROSSI"),
      "risultato fuori query",
    );
  }
});
