import assert from "node:assert/strict";
import test from "node:test";

const { formatOpenCupEuro } = await import(
  "../src/lib/opencup-money.ts"
);

test("OpenCUP money preserves missing, zero and exact integer EUR", () => {
  assert.equal(formatOpenCupEuro(null), "non disponibile");
  assert.equal(formatOpenCupEuro("0"), "0,00 €");
  assert.equal(formatOpenCupEuro("12345678901234567"), "12.345.678.901.234.567,00 €");
  for (const invalid of ["10.50", "10,5", "-1", "NaN"]) {
    assert.throws(() => formatOpenCupEuro(invalid), /fuori contratto/);
  }
});
