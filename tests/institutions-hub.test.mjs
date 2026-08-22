import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/app/istituzioni/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/istituzioni/istituzioni.module.css", import.meta.url), "utf8");
const navigation = fs.readFileSync(new URL("../src/components/navigation.tsx", import.meta.url), "utf8");

test("Institutions hub indexes four separate routes without a combined total", () => {
  for (const route of ["/parlamento", "/palazzo-chigi", "/ministeri", "/regioni"]) {
    assert.match(page, new RegExp(`href: "${route}"`));
    assert.match(navigation, new RegExp(`"${route}"`));
  }
  assert.match(navigation, /href: "\/istituzioni",\s*\n\s*label: "Istituzioni"/);
  assert.match(page, /non li sommiamo in un totale unico/);
  assert.match(page, /Sommarli produrrebbe un numero\s*\n?\s*fuorviante/);
  assert.doesNotMatch(page, /compactEuro|exactEuro|treemap/i);
});

test("Institutions hub keeps cards readable on narrow screens", () => {
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /border-radius|box-shadow|linear-gradient|transition:\s*all/);
});
