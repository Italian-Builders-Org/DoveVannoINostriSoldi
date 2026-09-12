import assert from "node:assert/strict";

export async function inspectInequality(page) {
  assert.equal(await page.$eval("h1", (node) => node.textContent), "Disuguaglianza dei redditi");
  assert.equal(await page.$eval('[data-testid="gini-latest"]', (node) => node.textContent), "31,0");
  assert.equal(await page.$eval('[data-testid="s80s20-latest"]', (node) => node.textContent), "5,13 volte");
  assert.equal(await page.$$eval('main svg[role="img"]', (nodes) => nodes.length), 2);
  for (const key of ["gini", "s80s20"]) {
    const selector = `[data-testid="${key}-data"]`;
    assert.equal(await page.$eval(selector, (node) => node.open), false);
    await page.focus(`${selector} > summary`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(`${selector}[open] tbody tr`, { visible: true });
    const rows = await page.$$eval(`${selector} tbody tr`, (nodes) => nodes.map((row) => [...row.cells].map((cell) => cell.textContent)));
    assert.equal(rows.length, 12);
    assert.deepEqual(rows.at(-1), ["2024", "2025", key === "gini" ? "31,0" : "5,13", ""]);
    await page.focus(`${selector} [role="region"]`);
    assert.equal(await page.$eval(`${selector} [role="region"]`, (node) => node === document.activeElement), true);
  }
  await page.focus("#disuguaglianza-metodo > summary");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#disuguaglianza-metodo[open] h2", { visible: true });
  assert.match(await page.$eval("#disuguaglianza-metodo", (node) => node.innerText), /rilevazione 2025 descrive i redditi del 2024/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Disuguaglianza: overflow");
}
