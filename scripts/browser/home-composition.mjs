import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultArtifactsDir } from "./harness.mjs";

const chart = 'ol[aria-label^="Composizione spesa pubblica Italia"]';

async function tapVisibleTooltipTrigger(page, selector) {
  // page.tap() scrolls the control to the top of the viewport. On this
  // homepage the sticky announcement+header cover that strip, so the tap
  // hits the ticker instead of the COFOG trigger and aria-expanded stays false.
  await page.$eval(selector, (button) => {
    button.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  });
  await page.waitForFunction((sel) => {
    const button = document.querySelector(sel);
    if (!(button instanceof HTMLElement)) return false;
    const rect = button.getBoundingClientRect();
    const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
    if (rect.width < 44 || rect.height < 44) return false;
    if (rect.top < headerBottom + 1 || rect.bottom > window.innerHeight - 1) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && button.contains(hit));
  }, {}, selector);
  const box = await page.$eval(selector, (button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.touchscreen.tap(box.x, box.y);
}

async function geometry(page) {
  return page.$$eval(`${chart} > li`, (rows) => rows.map((row) => {
    const copy = row.querySelector(":scope > div");
    const name = copy.querySelector("a");
    const amount = copy.querySelector('[class*="barAmount"]');
    const button = copy.querySelector("button");
    const bounds = (element) => {
      const { top, bottom, left, right, height, width } = element.getBoundingClientRect();
      return { top, bottom, left, right, height, width };
    };
    return {
      name: name.textContent, amount: amount.textContent,
      row: bounds(row), copy: bounds(copy), title: bounds(name), amountBox: bounds(amount),
      button: button ? bounds(button) : null,
    };
  }));
}

export async function inspectHomeCompositionSpacing(page, { width }) {
  const rows = await geometry(page);
  assert.equal(rows.length, 10, "Home: ten COFOG divisions remain visible");
  assert.ok(rows.filter((row) => row.button).length >= 3, "Home: tooltip rows missing");
  for (const [index, row] of rows.entries()) {
    assert.match(row.amount, /mld €/);
    const textGap = row.amountBox.top - row.title.bottom;
    assert.ok(textGap >= -1 && textGap <= 6, `${row.name}: title/amount gap ${textGap}px`);
    if (row.button) {
      assert.ok(row.button.width >= 44 && row.button.height >= 44, `${row.name}: touch target shrunk`);
      assert.ok(row.button.left >= row.title.right, `${row.name}: tooltip overlaps title`);
      assert.ok(row.button.top >= row.row.top - 1 && row.button.bottom <= row.row.bottom + 1, `${row.name}: touch target overlaps another row`);
    }
    if (index) assert.ok(row.row.top - rows[index - 1].row.bottom <= 9, `${row.name}: extra inter-row space`);
  }

  const triggers = await page.$$eval(`${chart} button[aria-controls]`, (buttons) => buttons.map((button) => button.getAttribute("aria-controls")));
  for (const id of triggers) {
    const selector = `${chart} button[aria-controls="${id}"]`;
    await page.focus(selector);
    await page.waitForFunction((id) => document.getElementById(id)?.dataset.positioned === "true", {}, id);
    const box = await page.$eval(`#${id}`, (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    assert.ok(box.left >= 0 && box.right <= width + 1, `${id}: tooltip outside viewport`);
    const openedRows = await geometry(page);
    for (const [index, row] of rows.entries()) {
      assert.ok(Math.abs(openedRows[index].row.height - row.row.height) <= 1, `${id}: opening changes row height`);
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.$eval(selector, (button) => button.getAttribute("aria-expanded")), "false");
  }

  if (width === 390) {
    const selector = `${chart} button[aria-controls="${triggers[0]}"]`;
    await tapVisibleTooltipTrigger(page, selector);
    assert.equal(await page.$eval(selector, (button) => button.getAttribute("aria-expanded")), "true");
    await tapVisibleTooltipTrigger(page, selector);
    assert.equal(await page.$eval(selector, (button) => button.getAttribute("aria-expanded")), "false");
  }
  const theme = await page.$eval("html", (element) => element.dataset.theme);
  console.log(JSON.stringify({
    check: "home-composition-spacing", theme, width,
    maxTitleAmountGap: Math.max(...rows.map((row) => row.amountBox.top - row.title.bottom)),
    rowHeights: rows.map((row) => row.row.height),
    tooltipTargets: rows.filter((row) => row.button).map((row) => row.button.width),
  }));
  const directory = path.join(defaultArtifactsDir(), "home-composition", `${theme}-${width}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "geometry.json"), JSON.stringify(rows, null, 2));
  const panel = await page.$('section[aria-labelledby="pa-split-title"]');
  await panel.screenshot({ path: path.join(directory, "composition.png") });
}
