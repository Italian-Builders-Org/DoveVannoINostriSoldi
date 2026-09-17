import assert from "node:assert/strict";
import test from "node:test";
import {
  compactEuro, compactEuroLike, compactEuroFromCents, exactEuro,
  billions, integer, percent, longDate, shortDate,
} from "../src/lib/format.ts";

test("money formatting preserves scale, signs, grouping and exact cents", () => {
  assert.equal(exactEuro(1234.56), "1.234,56\u00a0€");
  assert.equal(integer(7893), "7.893");
  assert.equal(compactEuro(999999), "999.999,00\u00a0€");
  assert.equal(compactEuro(1e6), "1,0 mln €");
  assert.equal(compactEuro(-1e9), "-1,00 mld €");
  assert.equal(compactEuroLike(1e6, 1e9), "0,00 mld €");
  assert.equal(billions(72940000000), "72,94");
  assert.equal(compactEuroFromCents(123456), "1.234,56\u00a0€");
  assert.throws(() => compactEuroFromCents(1.5), /intero sicuro/);
  assert.throws(() => compactEuroFromCents(Number.MAX_SAFE_INTEGER + 1), /intero sicuro/);
});

test("percentage precision is per call and is not a fractional percentage conversion", () => {
  assert.equal(percent(12.345), "12,3%");
  assert.equal(percent(12.345, 2), "12,35%");
  assert.equal(percent(12.345, 0), "12%");
  assert.equal(percent(12.345), "12,3%");
  assert.throws(() => percent(12, -1), RangeError);
});

test("dates use Rome civil time across year boundaries and reject unavailable values", () => {
  assert.equal(longDate("2025-12-31T23:30:00Z"), "1 gennaio 2026");
  assert.equal(shortDate("2024-02-29"), "29 feb 2024");
  for (const value of [null, undefined, "", "invalid"]) {
    assert.equal(longDate(value), "non disponibile");
    assert.equal(shortDate(value), "non disponibile");
  }
});
