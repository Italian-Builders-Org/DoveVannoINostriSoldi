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
  assert.match(page, /code: definition\.code/);
  assert.match(page, /valueCents: national\[metric\]/);
  assert.match(page, /detailPresent: data\.detailCoverage\.present\[metric\]/);
  assert.match(page, /detailMissing: data\.detailCoverage\.missing\[metric\]/);
  assert.match(page, /grafico confronta\s*\n?\s*gli importi/);
  assert.match(page, /region\.values\.productionCosts/);
  assert.match(page, /region\.values\.purchasedServices/);
  assert.match(page, /entity\.missing\.nonHealthcareWorkServices/);
  assert.match(page, /entity\.values\.purchasedServices/);
  assert.match(component, /^"use client";/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /aria-label="Vista delle voci contabili"/);
  assert.match(component, /aria-orientation="horizontal"/);
  assert.match(component, /ArrowRight/);
  assert.match(component, /ArrowLeft/);
  assert.match(component, /event\.key === "Home"/);
  assert.match(component, /event\.key === "End"/);
  assert.match(component, /tabIndex=\{view === option\.id \? 0 : -1\}/);
  assert.match(component, /hidden=\{view !== "grafico"\}/);
  assert.match(component, /hidden=\{view !== "tabella"\}/);
  assert.match(component, /<BarChart/);
  assert.match(component, /layout="vertical"/);
  assert.match(component, /value: point\.valueCents \/ 100/);
  assert.match(component, /domain=\{\[0, "auto"\]\}/);
  assert.match(component, /position=\{\{ x: 8 \}\}/);
  assert.match(component, /ChartDataTable/);
  assert.match(component, /Codice fonte/);
  assert.match(component, /Copertura dettaglio/);
  assert.match(component, /role="region" aria-label="Voci contabili sanità 2024"/);
  assert.match(component, /scope="row"/);
  assert.match(component, /isAnimationActive=\{false\}/);
  assert.match(component, /role="img"/);
  assert.match(component, /aria-label=/);
  assert.match(component, /Scala lineare da zero/);
  assert.match(component, /import \{ compactEuro, exactEuro, integer \} from "@\/lib\/format";/);
  assert.doesNotMatch(component, /new Intl\.NumberFormat/);
  assert.match(component, /exactEuro\(point\.value/);
  assert.match(css, /\.viewSelector button\[aria-selected="true"\]/);
  assert.match(css, /\.viewBlock > \[role="tabpanel"\][\s\S]*?min-width: 0/);
  assert.match(css, /\.viewBlock :global\(\.table-scroll\)[\s\S]*?min-width: 0/);
  assert.match(css, /max-width: min\(310px, calc\(100vw - 80px\)\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
