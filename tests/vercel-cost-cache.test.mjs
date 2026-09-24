import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Snapshot pages must ISR instead of force-dynamic: every hit was Fluid Active CPU. */
const ISR_PAGES = [
  ["src/app/spese/sanita/storico/page.tsx", "21_600"],
  ["src/app/stato/legislature/page.tsx", "21_600"],
  ["src/app/fonti/stato/page.tsx", "300"],
];

for (const [path, seconds] of ISR_PAGES) {
  test(`${path} uses ISR revalidate=${seconds}, not force-dynamic`, () => {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /export const dynamic = ["']force-dynamic["']/);
    assert.match(source, new RegExp(`export const revalidate = ${seconds}\\b`));
  });
}

test("SSN storico API allows parallel warm hits (avoids 503 no-store storms)", () => {
  const source = readFileSync("src/app/api/spese/sanita/storico/route.ts", "utf8");
  assert.match(source, /ConcurrencyLimiter\(3\)/);
  assert.doesNotMatch(source, /ConcurrencyLimiter\(1\)/);
});

test("legislature spending API allows parallel warm hits", () => {
  const source = readFileSync("src/app/api/spese/stato/legislature/route.ts", "utf8");
  assert.match(source, /ConcurrencyLimiter\(3\)/);
});
