import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { defaultArtifactsDir } from "./harness.mjs";

// Read the production DOM and computed styles: token-only tests cannot detect
// component overrides or production CSS ordering regressions.
export async function inspectInstitutionalPalette(page, { label, width }) {
  const state = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const context = document.createElement("canvas").getContext("2d");
    function rgb(css) {
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }
    function luminance(css) {
      const channels = rgb(css).map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    function contrast(first, second) {
      const a = luminance(first), b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    function background(element) {
      for (let current = element; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
      }
      return root.getPropertyValue("--color-bg");
    }
    const texts = [...document.querySelectorAll('main h1, .panel-title, footer a, header .brand, main .notice a')]
      .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
      .map((element) => ({ text: element.textContent.trim().slice(0, 60), ratio: contrast(getComputedStyle(element).color, background(element)) }));
    const bars = [...document.querySelectorAll('main li > i > b')]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => ({
        color: rgb(getComputedStyle(element).backgroundColor).join(","),
        ratio: contrast(getComputedStyle(element).backgroundColor, getComputedStyle(element.parentElement).backgroundColor),
        label: element.closest("li").textContent.trim(),
      }));
    return {
      theme: document.documentElement.dataset.theme,
      texts, bars,
      data: rgb(root.getPropertyValue("--chart-data-primary")).join(","),
      running: rgb(root.getPropertyValue("--color-neutral-500")).join(","),
      regions: document.querySelectorAll('[data-region-map="true"] path[role="button"]').length,
      mapLabels: [...document.querySelectorAll('[data-region-map="true"] path[role="button"]')].every((element) => Boolean(element.getAttribute("aria-label"))),
    };
  });
  assert.ok(state.texts.length > 5, `${label}: no visible civic text samples`);
  for (const sample of state.texts) assert.ok(sample.ratio >= 4.5, `${label}: ${sample.text} contrast ${sample.ratio}`);
  assert.ok(state.bars.length >= 12, `${label}: monthly and category bars missing`);
  for (const bar of state.bars) {
    assert.ok([state.data, state.running].includes(bar.color), `${label}: ordinary bar uses a non-quantitative role`);
    assert.ok(bar.ratio >= 3, `${label}: bar/track contrast ${bar.ratio}`);
    assert.ok(bar.label.length > 0, `${label}: bar lacks a text equivalent`);
  }
  assert.equal(state.regions, 20, `${label}: regional map missing`);
  assert.equal(state.mapLabels, true, `${label}: region values must remain accessible without colour`);
  if ([390, 1280].includes(width)) {
    const directory = path.join(defaultArtifactsDir(), "institutional-palette", `${state.theme}-${width}`);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, "home.png"), fullPage: true });
  }
}
