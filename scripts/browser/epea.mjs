import assert from "node:assert/strict";

export async function inspectEpea(page) {
  assert.match(await page.$eval("#selected-title", (element) => element.textContent), /Amministrazioni pubbliche.*2022/);
  assert.match(await page.$eval("main", (element) => element.textContent), /14\.134,7 mln €/);
  assert.equal(await page.$$eval('[data-testid="epea-classes"] tbody tr', (rows) => rows.length), 7);
  assert.equal(await page.$$eval('[data-testid="epea-history"] tbody tr', (rows) => rows.length), 7);
  await page.select("#epea-sector", "S1");
  await page.select("#epea-year", "2016");
  await page.focus('main form button[type="submit"]');
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
  assert.match(await page.$eval("#selected-title", (element) => element.textContent), /Totale economia · 2016/);
  assert.equal(new URL(page.url()).searchParams.get("anno"), "2016");
  const apiLink = await page.$eval('main a[href^="/api/spese/istat-epea"]', (element) => element.href);
  assert.equal(new URL(apiLink).searchParams.get("settore"), "S1");
  const payload = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API EPEA ${response.status}`);
    return response.json();
  }, apiLink);
  const total = payload.observations.find((row) => row.dataTypeAggr === "EPS_NEXP" && row.cepaClass === "TOT_CEPA");
  assert.equal(total.year, 2016);
  assert.equal(total.institutionalSector, "S1");
  const value = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: "always" }).format(total.amountCents / 100_000_000);
  assert.ok((await page.$eval("main", (element) => element.textContent)).includes(`${value} mln €`));
  await page.focus("main details summary");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("main details")?.open === true);
  assert.match(await page.$eval("main details", (element) => element.textContent), /07a30ae5d9abe9956bbfc00eafb1c01a12dbd7e1d6e1ebaa8fa32ca373748dcb/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "overflow EPEA");
}
