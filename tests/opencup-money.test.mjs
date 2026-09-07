import assert from "node:assert/strict";
import test from "node:test";

const { formatOpenCupEuro, parseOpenCupEuroCents } = await import(
  "../src/lib/opencup-money.ts"
);

test("OpenCUP money preserves missing, zero and exact decimal-comma cents", () => {
  assert.equal(parseOpenCupEuroCents(null), null);
  assert.equal(parseOpenCupEuroCents("0"), 0n);
  assert.equal(parseOpenCupEuroCents("10,5"), 1_050n);
  assert.equal(parseOpenCupEuroCents("12345678901234,01"), 1_234_567_890_123_401n);
  assert.equal(formatOpenCupEuro(null), "non disponibile");
  assert.equal(formatOpenCupEuro("0"), "0,00 €");
  assert.equal(formatOpenCupEuro("1234567,8"), "1.234.567,80 €");
  assert.throws(() => parseOpenCupEuroCents("10.50"), /fuori contratto/);
});
