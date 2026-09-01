import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/spese/pensioni/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/app/spese/pensioni/pensioni.module.css", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const search = await readFile(new URL("../src/lib/global-search.ts", import.meta.url), "utf8");

test("the pensions page keeps INPS 2026 and ISTAT 2022 as distinct perimeters", () => {
  assert.match(page, /pensionBenefits/);
  assert.match(page, /pensioners/);
  assert.match(page, /inpsPensionsOsservatorioSnapshot/);
  assert.match(page, /stock al 31 dicembre/);
  assert.match(page, /importi nominali/);
  assert.match(page, /tutti gli enti del Casellario/);
  assert.match(page, /I numeri non si sommano/);
  assert.match(page, /vintageCube\.url/);
  assert.match(page, /Pensioni per anno di decorrenza/);
  assert.match(page, /href="\/spese\/invalidita"/);
  assert.match(page, /non vanno sommati/);
});

test("the pensions page has an accessible text-first composition graphic", () => {
  assert.match(page, /<figure className=\{styles\.composition\}/);
  assert.match(page, /<ol>/);
  assert.match(page, /aria-hidden="true"/);
  assert.match(page, /<figcaption/);
  assert.match(page, /IVS e indennitarie/);
  assert.match(page, /Civili, sociali e guerra/);
  assert.match(page, /right\.grossAmountCents - left\.grossAmountCents/);
  assert.match(page, /category\.grossAmountCents \/ latestBenefits\.grossAmountCents/);
  assert.match(page, /<table className="table">/);
  assert.match(css, /background: var\(--color-accent\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /CHART_COLORS|chart-category-colors/);
});

test("pensions owns the generic search term and follows invalidity in both maps", () => {
  const invalidityLinks = [...navigation.matchAll(/href: "\/spese\/invalidita"/g)].map((match) => match.index);
  const pensionsLinks = [...navigation.matchAll(/href: "\/spese\/pensioni"/g)].map((match) => match.index);
  assert.equal(invalidityLinks.length, 2);
  assert.equal(pensionsLinks.length, 2);
  assert.ok(invalidityLinks.every((index, position) => index < pensionsLinks[position]));
  assert.match(search, /"\/spese\/invalidita": \["invalidita", "inps", "prestazioni"\]/);
  assert.match(search, /"\/spese\/pensioni": \[[\s\S]*"pensioni"/);
});
