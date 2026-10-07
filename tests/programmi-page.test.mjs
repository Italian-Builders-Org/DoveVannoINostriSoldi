import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/programmi/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/app/programmi/programmi.module.css", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");
const llms = await readFile(new URL("../public/llms.txt", import.meta.url), "utf8");

test("programmi 2027 teaser is linked from Institutions and discovery", () => {
  assert.match(page, /Le promesse, messe di fronte ai numeri/);
  assert.match(page, /Campagne 2027/);
  assert.match(page, /ShareFactButton/);
  assert.match(page, /fail-closed/);
  assert.match(navigation, /href: "\/programmi", label: "Programmi elettorali 2027"/);
  assert.match(discovery, /"\/programmi"/);
  assert.match(llms, /\/programmi/);
});

test("programmi teaser keeps a shareable hero without dashboard clutter", () => {
  assert.match(css, /\.hero/);
  assert.match(css, /DoveVannoINostriSoldi|brand/);
  assert.match(css, /@keyframes (pulse|drift)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(page, /dashboard|KPI|stat strip/i);
});
