import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../src/app/design-system.css", import.meta.url), "utf8");
const declarations = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const light = declarations(css.match(/:root\s*\{([\s\S]*?)\n\}/)[1]);
const dark = { ...light, ...declarations(css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1]) };
function value(tokens, name) {
  const raw = tokens[name];
  assert.ok(raw, `${name}: missing token`);
  const alias = raw.match(/^var\((--[\w-]+)\)$/);
  return alias ? value(tokens, alias[1]) : raw;
}
function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
for (const [theme, tokens] of Object.entries({ light, dark })) {
  test(`${theme}: civic text, links, controls and status role pairs meet AA`, () => {
    const pairs = [];
    for (const surface of ["bg", "surface", "raised", "neutral-100", "neutral-200"]) {
      for (const foreground of ["text", "neutral-600", "neutral-700", "neutral-800", "accent-700", "accent-800"]) {
        pairs.push([`--color-${foreground}`, `--color-${surface}`, 4.5]);
      }
    }
    for (const status of ["positive", "warning", "critical"]) pairs.push([`--color-${status}`, `--color-${status}-bg`, 4.5]);
    for (const foreground of ["on-strong", "on-strong-muted"]) pairs.push([`--color-${foreground}`, "--color-text", 4.5]);
    for (const action of ["accent-700", "accent-800", "accent-900"]) pairs.push(["--color-raised", `--color-${action}`, 4.5]);
    for (const surface of ["bg", "surface", "raised"]) {
      pairs.push(["--focus-ring", `--color-${surface}`, 3], ["--color-neutral-400", `--color-${surface}`, 3]);
    }
    pairs.push(["--color-announcement-text", "--color-announcement-bg", 4.5], ["--chart-data-primary", "--chart-data-track", 3], ["--chart-progress", "--chart-progress-track", 3]);
    for (const [foreground, background, minimum] of pairs) {
      const ratio = contrast(value(tokens, foreground), value(tokens, background));
      assert.ok(ratio >= minimum, `${foreground} on ${background}: ${ratio.toFixed(3)} < ${minimum}`);
    }
  });
  test(`${theme}: additive category tints retain AA text`, () => {
    for (const category of ["blue", "teal", "purple", "amber", "green", "slate"]) {
      const fill = value(tokens, `--chart-category-${category}`);
      const raised = value(tokens, "--color-raised");
      const mixed = "#" + [1, 3, 5].map((offset) => Math.round(
        parseInt(fill.slice(offset, offset + 2), 16) * 0.4 + parseInt(raised.slice(offset, offset + 2), 16) * 0.6,
      ).toString(16).padStart(2, "0")).join("");
      assert.ok(contrast(value(tokens, "--color-text"), mixed) >= 4.5, `${category}: text on 40% category tint`);
    }
  });
  test(`${theme}: map bins are strictly sequential and normal quantities are not red`, () => {
    const ramp = [1, 2, 3, 4, 5].map((step) => luminance(value(tokens, `--chart-map-${step}`)));
    assert.equal(new Set(ramp).size, 5);
    for (let index = 1; index < ramp.length; index++) assert.ok(theme === "light" ? ramp[index] < ramp[index - 1] : ramp[index] > ramp[index - 1]);
    for (const role of ["primary", "data-primary", "quinary", "map-5"]) {
      assert.notEqual(value(tokens, `--chart-${role}`), value(tokens, "--color-accent"));
      assert.notEqual(value(tokens, `--chart-${role}`), value(tokens, "--color-accent-700"));
    }
  });
}

test("home bars, map and additive composition retain dedicated data roles and text equivalents", () => {
  for (const file of ["../src/app/home.module.css", "../src/components/home-italy-charts.module.css"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /background: var\(--chart-data-primary\)/);
    assert.match(source, /background: var\(--chart-data-track\)/);
  }
  const composition = fs.readFileSync(new URL("../src/components/spending-composition.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(composition, /var\(--color-accent/);
  const map = fs.readFileSync(new URL("../src/components/italy-regions-map.tsx", import.meta.url), "utf8");
  assert.match(map, /aria-label/);
  assert.match(map, /data-region-selector/);
});
