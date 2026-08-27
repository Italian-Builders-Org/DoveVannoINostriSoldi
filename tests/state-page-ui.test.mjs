import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/stato/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/app/stato/stato.module.css", import.meta.url), "utf8");
const administrationPage = await readFile(
  new URL("../src/app/stato/amministrazioni/[codice]/page.tsx", import.meta.url),
  "utf8",
);

test("state page reads the Next 16 searchParams promise and fails closed", () => {
  assert.match(page, /searchParams: Promise<\{ anno\?: string \| string\[\] \}>/);
  assert.match(page, /const params = await searchParams;/);
  assert.match(page, /parseStateOverviewSelection\(params\.anno\)/);
  assert.match(page, /if \(selection\.kind === "invalid"\) notFound\(\);/);
});

test("state page exposes distinct monthly and definitive annual releases", () => {
  assert.match(page, /Ultimo rilascio mensile disponibile/);
  assert.match(page, /Consuntivo \{STATE_CONSUNTIVO_YEAR\} · definitivo/);
  assert.match(page, /Consuntivo \$\{snapshot\.period\.year\} · definitivo/);
  assert.match(page, /Rilascio mensile cumulativo/);
  assert.match(page, /serie mensile non viene mostrata/i);
});

test("state page never renders monthly history alongside the annual consuntivo", () => {
  assert.equal(page.match(/<StateSpendingHistorySection \/>/g)?.length, 1);
  assert.match(
    page,
    /\{isConsuntivo \? \([\s\S]*?La serie mese per mese resta mensile[\s\S]*?\) : \([\s\S]*?<StateSpendingHistorySection \/>/,
  );
});

test("state period controls preserve keyboard-sized targets on narrow screens", () => {
  assert.match(css, /\.periodSelector a,\s*\.separationLink \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.periodSelector \{\s*display: block;/);
  assert.match(css, /\.periodSelector a\[aria-current="page"\]/);
});

test("state payment bars scale against the true series maximum", () => {
  assert.match(page, /Math\.max\(\.\.\.snapshot\.paymentMethods\.map\(\(method\) => method\.value\), 0\)/);
  assert.match(administrationPage, /Math\.max\(\.\.\.data\.paymentMethods\.map\(\(method\) => method\.value\), 0\)/);
  assert.doesNotMatch(page, /paymentMethods\[0\]/);
  assert.doesNotMatch(administrationPage, /paymentMethods\[0\]/);
});
