import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/app/design-system.css", import.meta.url), "utf8");
const coesioneCss = await readFile(new URL("../src/app/coesione/coesione.module.css", import.meta.url), "utf8");

function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `token --${name} non trovato`);
  return match[1];
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("coesione trace panel keeps high-contrast text on the dark surface", () => {
  const surface = token("color-neutral-900");
  assert.match(coesioneCss, /\.tracePanel[\s\S]*background:\s*var\(--color-neutral-900\)/);
  assert.match(coesioneCss, /\.tracePanel > div > span:first-child[\s\S]*color:\s*var\(--color-accent-300\)/);
  assert.match(coesioneCss, /\.traceAction span[\s\S]*color:\s*var\(--color-on-strong-muted\)/);

  const pairs = [
    ["trace heading", token("color-raised"), surface],
    ["trace body", token("color-neutral-300"), surface],
    ["trace kicker", token("color-accent-300"), surface],
    ["trace metric label", token("color-on-strong-muted"), surface],
    ["trace metric value", token("color-raised"), surface],
  ];

  for (const [label, foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${label} sotto 4.5:1 sul pannello scuro`);
  }
});
