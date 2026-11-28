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

test("fromJanuaryTo uses the euphonic “ad” before months starting with a", async () => {
  const { fromJanuaryTo } = await import("../src/lib/format.ts");
  assert.equal(fromJanuaryTo("Agosto"), "da gennaio ad agosto");
  assert.equal(fromJanuaryTo("aprile"), "da gennaio ad aprile");
  assert.equal(fromJanuaryTo("Settembre"), "da gennaio a settembre");
  assert.equal(fromJanuaryTo("ottobre"), "da gennaio a ottobre");
  // A single month is not a range.
  assert.equal(fromJanuaryTo("Gennaio"), "a gennaio");
});

test("period labels turn ISO dates into Italian long dates and keep other labels", async () => {
  const { periodDateLabel } = await import("../src/lib/format.ts");
  // The company atlas snapshot labels monthly stocks with their raw ISO day.
  assert.equal(periodDateLabel("2026-09-30"), "30 settembre 2026");
  assert.equal(periodDateLabel("2025-12-31"), "31 dicembre 2025");
  // Non-date labels pass through untouched, invalid days are not reformatted.
  assert.equal(periodDateLabel("2° trimestre 2026"), "2° trimestre 2026");
  assert.equal(periodDateLabel("2024/25"), "2024/25");
  assert.equal(periodDateLabel("2026-02-31"), "2026-02-31");
  assert.equal(periodDateLabel("2026"), "2026");
});

test("the home company card shows its ISO period as a long Italian date", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/components/home-data-previews.tsx", import.meta.url), "utf8");
  assert.match(source, /periodDateLabel\(companies\.periodLabel\)/);
});
