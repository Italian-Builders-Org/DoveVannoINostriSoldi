import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const designSystem = fs.readFileSync(new URL("../src/app/design-system.css", import.meta.url), "utf8");
const palette = fs.readFileSync(new URL("../src/lib/chart-category-colors.ts", import.meta.url), "utf8");
const pcm = fs.readFileSync(new URL("../src/app/palazzo-chigi/pcm-mission-treemap.tsx", import.meta.url), "utf8");
const ministries = fs.readFileSync(new URL("../src/app/ministeri/ministry-commitment-treemap.tsx", import.meta.url), "utf8");
const ministryPage = fs.readFileSync(new URL("../src/app/ministeri/page.tsx", import.meta.url), "utf8");
const regions = fs.readFileSync(new URL("../src/app/regioni/region-title-treemap.tsx", import.meta.url), "utf8");
const regionPage = fs.readFileSync(new URL("../src/app/regioni/page.tsx", import.meta.url), "utf8");
const pcmPage = fs.readFileSync(new URL("../src/app/palazzo-chigi/page.tsx", import.meta.url), "utf8");

const tokenNames = ["blue", "teal", "purple", "amber", "green", "slate"];

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastWithWhite(hex) {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  return 1.05 / (luminance + 0.05);
}

test("institutional categorical tokens provide six non-red AA families", () => {
  for (const name of tokenNames) {
    const match = designSystem.match(new RegExp(`--chart-category-${name}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(match, `${name}: token missing`);
    assert.ok(contrastWithWhite(match[1]) >= 4.5, `${name}: white text must meet WCAG AA`);
    assert.match(palette, new RegExp(`var\\(--chart-category-${name}\\)`));
  }
  assert.doesNotMatch(palette, /accent|red/i);
});

test("additive treemaps use the categorical palette and keep value plus share in text", () => {
  for (const [name, component] of [["PCM", pcm], ["Ministeri", ministries], ["Regioni", regions]]) {
    assert.match(component, /institutionalCategoryColor\(node\.index\)/, `${name}: categorical fill missing`);
    assert.doesNotMatch(component, /fill="var\(--color-accent\)"|fillOpacity/, `${name}: old red fill remains`);
    assert.match(component, /compactEuro\.format[\s\S]*·[\s\S]*percentage\.format/, `${name}: value and share are not paired`);
  }
});

test("each additive view states its denominator and exposes an exact table equivalent", () => {
  assert.match(pcm, /del pagato PCM/);
  assert.match(pcmPage, /Quota del pagato PCM/);
  assert.match(ministries, /del Totale CP dei 15 Ministeri/);
  assert.match(ministryPage, /Quota del Totale CP/);
  assert.match(ministryPage, /percentage\.format\(ministry\.commitmentsCpCents \/ totals\.commitmentsCpCents\)/);
  assert.match(regions, /degli impegni/);
  assert.match(regionPage, /denominatore è il totale ufficiale/);
  assert.match(regionPage, /<th scope="col">Quota<\/th>/);
});
