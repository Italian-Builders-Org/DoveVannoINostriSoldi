// Reference route test for GET /api/esplora (issue #105).
//
// This test needs the Next.js runtime, so it is skipped unless RUN_SERVER_TESTS=1
// (in the DVNS fork set that env var under `npm run test:node` / vitest with the
// Next test environment started). It is provided as the contract the route must
// satisfy; it does NOT run in this standalone repository.
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

test("GET /api/esplora?q= filtra e non fonde persone", { skip: !process.env.RUN_SERVER_TESTS }, async () => {
  const res = await fetch(`${BASE}/api/esplora?q=ROSSI&limit=50`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.query, "string");
  assert.ok(Array.isArray(data.results));
  const ids = new Set(data.results.map((r) => r.source_record_id));
  assert.equal(ids.size, data.results.length, "nessun arco duplicato nella risposta");
  for (const r of data.results) {
    assert.ok(
      (r.subject_key + r.object_key).toUpperCase().includes("ROSSI") ||
        r.source_record_id.toUpperCase().includes("ROSSI"),
      "risultato fuori query",
    );
  }
});
