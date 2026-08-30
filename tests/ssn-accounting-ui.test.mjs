import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, component, css] = await Promise.all([
  readFile(new URL("../src/app/spese/sanita/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/spese/sanita/ssn-accounting-comparison.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/spese/sanita/ssn-accounting-comparison.module.css", import.meta.url), "utf8"),
]);

test("SSN accounting comparison offers a chart/table switch without losing the exact table", () => {
  assert.match(page, /import \{ SsnAccountingComparison \} from "\.\/ssn-accounting-comparison"/);
  assert.match(page, /<SsnAccountingComparison data=\{comparisonData\} \/>/);
  assert.match(page, /grafico confronta\s*\n?\s*gli importi/);
  assert.match(component, /^"use client";/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /aria-label="Vista delle voci contabili"/);
  assert.match(component, /<BarChart/);
  assert.match(component, /layout="vertical"/);
  assert.match(component, /ChartDataTable/);
  assert.match(component, /Codice fonte/);
  assert.match(component, /Copertura dettaglio/);
  assert.match(component, /isAnimationActive=\{false\}/);
  assert.match(component, /role="img"/);
  assert.match(component, /aria-label=/);
  assert.match(css, /\.viewSelector button\[aria-selected="true"\]/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
