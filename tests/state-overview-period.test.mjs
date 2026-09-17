import assert from "node:assert/strict";
import test from "node:test";
import {
  STATE_SUPPORTED_YEARS,
  parseStateOverviewSelection,
} from "../src/lib/data/state-overview-period.ts";

test("state overview defaults to the latest supported release", () => {
  assert.deepEqual(parseStateOverviewSelection(undefined), { kind: "latest" });
});

test("state overview accepts the verified annual year and keeps monthly latest implicit", () => {
  assert.deepEqual(parseStateOverviewSelection("2025"), { kind: "year", year: 2025 });
  assert.deepEqual(parseStateOverviewSelection(["2025"]), { kind: "year", year: 2025 });
  assert.equal(parseStateOverviewSelection("2026").kind, "invalid");
  assert.deepEqual(STATE_SUPPORTED_YEARS, [2025]);
});

test("state overview rejects unsupported, malformed and repeated years", () => {
  for (const value of ["2024", "2025x", "20", ["2025", "2026"]]) {
    assert.equal(parseStateOverviewSelection(value).kind, "invalid");
  }
});
