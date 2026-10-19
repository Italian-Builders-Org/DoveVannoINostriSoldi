import assert from "node:assert/strict";

export async function inspectContoAnnualeOccupazione(page) {
  assert.match(await page.$eval("h1", (node) => node.textContent), /Personale delle istituzioni pubbliche/);
  await page.type("#occupazione-search", "Roma Capitale");
  await page.waitForSelector('a[href="/personale-pa/conto-annuale/6144"]', { visible: true });
  await page.click('a[href="/personale-pa/conto-annuale/6144"]');
  await page.waitForSelector('[data-testid="staff-latest"]', { visible: true });
  assert.equal(await page.$eval('[data-testid="staff-latest"]', (node) => node.textContent), "22.125");
  assert.equal(await page.$eval('[data-testid="staff-delta-baseline"]', (node) => node.textContent), "−3.398");
  assert.equal(await page.$$eval('[data-testid="staff-series-chart"]', (nodes) => nodes.length), 1);
  assert.match(await page.$eval("h1", (node) => node.textContent), /ROMA CAPITALE/);
  const provenance = await page.$eval("section[aria-labelledby='provenienza']", (node) => node.textContent);
  assert.doesNotMatch(provenance, /NaN/);
  assert.match(provenance, /153\.121/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Conto Annuale occupazione: overflow");
}
