import assert from "node:assert/strict";
import test from "node:test";
import { parseReferencePeriod } from "../src/lib/data/reference-period.ts";

test("reference period accepts latest, year and exact month", () => {
  assert.deepEqual(parseReferencePeriod(new URLSearchParams(), 2026), {
    ok: true,
    value: {},
  });
  assert.deepEqual(parseReferencePeriod(new URLSearchParams("anno=2024"), 2026), {
    ok: true,
    value: { year: 2024 },
  });
  assert.deepEqual(
    parseReferencePeriod(new URLSearchParams("anno=2025&mese=06"), 2026),
    { ok: true, value: { year: 2025, month: 6 } },
  );
});

test("reference period rejects incomplete or invalid dates", () => {
  assert.equal(parseReferencePeriod(new URLSearchParams("mese=4"), 2026).ok, false);
  assert.equal(
    parseReferencePeriod(new URLSearchParams("anno=2024&mese=13"), 2026).ok,
    false,
  );
  assert.equal(parseReferencePeriod(new URLSearchParams("anno=1999"), 2026).ok, false);
  assert.equal(parseReferencePeriod(new URLSearchParams("anno=anno"), 2026).ok, false);
});
