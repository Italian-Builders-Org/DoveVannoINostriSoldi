import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultArtifactsDir } from "./harness.mjs";

const chart = 'ol[aria-label^="Composizione spesa pubblica Italia"]';

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
    await page.tap(selector);
    assert.equal(await page.$eval(selector, (button) => button.getAttribute("aria-expanded")), "true");
    await page.tap(selector);
    assert.equal(await page.$eval(selector, (button) => button.getAttribute("aria-expanded")), "false");
  }
  const theme = await page.$eval("html", (element) => element.dataset.theme);
  const directory = path.join(defaultArtifactsDir(), "home-composition", `${theme}-${width}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "geometry.json"), JSON.stringify(rows, null, 2));
  const panel = await page.$('section[aria-labelledby="pa-split-title"]');
  await panel.screenshot({ path: path.join(directory, "composition.png") });
}
