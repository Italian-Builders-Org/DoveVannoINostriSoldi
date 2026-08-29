import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/fonti/stato/page.tsx", import.meta.url), "utf8");
const css = await readFile(
  new URL("../src/app/fonti/stato/stato.module.css", import.meta.url),
  "utf8",
);

test("source status is a labelled native table at every responsive width", () => {
  assert.match(page, /<table className=\{styles\.dataTable\}>/);
  assert.match(page, /<caption className=\{styles\.caption\}>/);
  assert.match(page, /<thead className=\{styles\.tableHeader\}>[\s\S]*<th scope="col">Fonte<\/th>/);
  assert.match(page, /<tbody>[\s\S]*<tr className=\{styles\.row\}/);
  assert.match(page, /<th scope="row" className=\{styles\.source\} data-label="Fonte">/);
  assert.equal((page.match(/<th scope="col">/g) ?? []).length, 4);
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]*\.tableHeader,[\s\S]*\.dataTable tbody[\s\S]*display: block;/);
  assert.match(css, /\.row > th::before,[\s\S]*content: attr\(data-label\);/);
});
