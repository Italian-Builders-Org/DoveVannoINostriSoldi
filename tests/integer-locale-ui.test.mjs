import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { integer } from "../src/lib/format.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("integer() always groups thousands in Italian locale", () => {
  assert.equal(integer(5395), "5.395");
  assert.equal(integer(9999), "9.999");
});

test("app and component pages use integer() instead of bare toLocaleString", async () => {
  const [ministeri, stato] = await Promise.all([
    source("../src/app/ministeri/page.tsx"),
    source("../src/app/stato/page.tsx"),
  ]);
  assert.doesNotMatch(ministeri, /\.toLocaleString\("it-IT"\)/);
  assert.match(ministeri, /integer\(coverage\.rowsReconciled\)/);
  assert.doesNotMatch(stato, /function compactEuro\(/);
  assert.match(stato, /import \{ compactEuro, integer \} from "@\/lib\/format"/);
});
