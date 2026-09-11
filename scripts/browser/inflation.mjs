import assert from "node:assert/strict";

export async function inspectInflation(page) {
  assert.equal(await page.$eval("h1", (heading) => heading.textContent), "Inflazione IPCA");
  assert.equal(await page.$eval('[data-testid="hicp-annual-rate"]', (node) => node.textContent), "+3,2%");
  assert.match(await page.$eval("main", (node) => node.innerText), /prezzi al consumo, non di spesa pubblica/);
  await page.waitForSelector("#ipca-andamento .recharts-line-curve", { visible: true });
  assert.equal(await page.$$eval("#ipca-andamento .recharts-line-curve", (nodes) => nodes.length), 2);
  assert.equal(await page.$$eval("#ipca-capitoli ol > li", (rows) => rows.length), 13);
  assert.equal(await page.$$eval("#ipca-capitoli tbody tr", (rows) => rows.length), 13);
  assert.match(await page.$eval("#ipca-capitoli", (node) => node.innerText), /Non sono contributi additivi/);
  const comparison = await page.$eval("#ipca-confronto", (node) => node.innerText);
  assert.match(comparison, /luglio 2026/);
  assert.match(comparison, /Unione europea.*\+3,0%.*Area euro.*\+3,0%.*Italia.*\+2,9%/s);

  await page.focus(".chart-data > summary");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".chart-data[open] tbody tr", { visible: true });
  const rows = await page.$$eval(".chart-data tbody tr", (nodes) => nodes.map((row) => [...row.cells].map((cell) => cell.textContent)));
  assert.equal(rows.length, 56);
  assert.deepEqual(rows.at(-1), ["agosto 2026", "+3,2%", "+0,1%", "102,70", "Stima Eurostat"]);
  assert.equal(rows[0][0], "gennaio 2022");
  const table = '.chart-data [role="region"]';
  await page.focus(table);
  assert.equal(await page.$eval(table, (node) => document.activeElement === node), true);
  if (await page.$eval(table, (node) => node.scrollWidth > node.clientWidth)) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((selector) => document.querySelector(selector).scrollLeft > 0, {}, table);
  }

  await page.focus("#ipca-fonti > summary");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#ipca-fonti[open] section", { visible: true });
  assert.match(await page.$eval("#ipca-fonti", (node) => node.innerText), /CC-BY-4\.0/);
  await page.focus("#ipca-fonti details > summary");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#ipca-fonti details[open] code", { visible: true });
  assert.equal(await page.$$eval("#ipca-fonti details code", (nodes) => nodes.filter((node) => /^[a-f0-9]{64}$/.test(node.textContent)).length), 5);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Inflazione: overflow con tabelle e provenance aperte");
  console.log(`PASS Inflazione IPCA ${page.viewport().width}px: chart, 56 months, 13 divisions, common period, keyboard, provenance, overflow`);
}
