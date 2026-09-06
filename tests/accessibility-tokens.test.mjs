import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/app/design-system.css", import.meta.url), "utf8");

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

test("secondary text token meets WCAG AA on every shared light surface", () => {
  const foreground = token("color-neutral-600");
  for (const surface of ["color-bg", "color-surface", "color-raised"]) {
    assert.ok(contrast(foreground, token(surface)) >= 4.5, `${surface} sotto 4.5:1`);
  }
});

test("primary button pair meets WCAG AA", () => {
  assert.ok(contrast(token("color-accent-700"), token("color-raised")) >= 4.5);
  assert.ok(contrast(token("color-accent-800"), token("color-raised")) >= 4.5);
  assert.match(css, /\.btn-primary\s*\{[^}]*background:\s*var\(--color-accent-700\)[^}]*color:\s*var\(--color-raised\)/s);
  assert.match(
    css,
    /\.btn-primary:hover,\s*\.btn-primary:focus-visible\s*\{[^}]*background:\s*var\(--color-accent-800\)[^}]*color:\s*var\(--color-raised\)/s,
  );
});

test("municipality summary and partial status palette pairs meet WCAG AA", () => {
  assert.ok(contrast(token("color-accent-800"), token("color-accent-100")) >= 4.5);
  assert.ok(contrast(token("color-warning"), token("color-warning-bg")) >= 4.5);
});
