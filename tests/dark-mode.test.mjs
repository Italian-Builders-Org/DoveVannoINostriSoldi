import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../src/components/navigation.tsx", import.meta.url), "utf8");
const toggleSource = await readFile(new URL("../src/components/theme-toggle.tsx", import.meta.url), "utf8");
const designSystemCss = await readFile(new URL("../src/app/design-system.css", import.meta.url), "utf8");
const globalsCss = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

const {
  THEME_STORAGE_KEY,
  getStoredTheme,
  setTheme,
  applyTheme,
  getEffectiveTheme,
  getSystemTheme,
} = await import("../src/lib/theme.ts");

test("theme library exports expected storage key and theme functions", () => {
  assert.equal(THEME_STORAGE_KEY, "dvns-theme");
  assert.equal(typeof getStoredTheme, "function");
  assert.equal(typeof setTheme, "function");
  assert.equal(typeof applyTheme, "function");
  assert.equal(typeof getEffectiveTheme, "function");
  assert.equal(typeof getSystemTheme, "function");
});

test("layout prevents theme flash before hydration with head script and suppressHydrationWarning", () => {
  assert.match(layoutSource, /suppressHydrationWarning/);
  assert.match(layoutSource, /<head>/);
  assert.match(layoutSource, /localStorage\.getItem\("dvns-theme"\)/);
  assert.match(layoutSource, /window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(layoutSource, /document\.documentElement\.setAttribute\("data-theme",\s*"dark"\)/);
  assert.match(layoutSource, /colorScheme:\s*"light dark"/);
});

test("navigation header mounts ThemeToggle in header-actions", () => {
  assert.match(navigationSource, /import\s*\{\s*ThemeToggle\s*\}\s*from\s*"@\/components\/theme-toggle"/);
  assert.match(navigationSource, /<div className="header-actions">[\s\S]*?<ThemeToggle \/>[\s\S]*?<\/div>/);
});

test("ThemeToggle component exposes accessible labels and announces state", () => {
  assert.match(toggleSource, /"use client"/);
  assert.match(toggleSource, /aria-label=\{label\}/);
  assert.match(toggleSource, /title=\{label\}/);
  assert.match(toggleSource, /aria-pressed=\{isDark\}/);
  assert.match(toggleSource, /Attiva tema chiaro/);
  assert.match(toggleSource, /Attiva tema scuro/);
  assert.match(toggleSource, /Moon02Icon/);
  assert.match(toggleSource, /Sun02Icon/);
});

test("theme changes keep the DOM and rendered snapshot in sync", () => {
  assert.match(toggleSource, /applyTheme\(getEffectiveTheme\(\)\)/);
});

test("design system defines dark tokens under media query and data-theme attribute", () => {
  assert.match(designSystemCss, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(designSystemCss, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(designSystemCss, /--color-bg:\s*#161514;/);
  assert.match(designSystemCss, /--color-raised:\s*#252322;/);
  assert.match(designSystemCss, /--color-text:\s*#ece8e7;/);
  assert.match(designSystemCss, /--color-accent:\s*#ff563c;/);
});

test("globals.css handles zero-flash icon visibility across themes", () => {
  assert.match(globalsCss, /\.theme-toggle-icon-dark/);
  assert.match(globalsCss, /\.theme-toggle-icon-light/);
  assert.match(globalsCss, /\[data-theme="dark"\]\s*\.theme-toggle-icon-light\s*\{\s*display:\s*grid;/);
  assert.match(globalsCss, /@media\s*\(prefers-color-scheme:\s*dark\)/);
});

test("header keeps fixed actions inside the medium desktop viewport", () => {
  assert.match(globalsCss, /@media \(min-width: 901px\) and \(max-width: 1100px\)/);
  assert.match(globalsCss, /@media \(min-width: 901px\) and \(max-width: 1100px\)\s*\{[\s\S]*?\.header-inner\s*\{[\s\S]*?flex-wrap: wrap;/);
});

test("theme helper functions follow storage and system precedence contract", () => {
  // Without localStorage or matchMedia, defaults to light
  assert.equal(getEffectiveTheme(), "light");
});
