import assert from "node:assert/strict";

export async function inspectReceipts(page) {
  const national = await page.$eval(".stat-strip", (element) => element.textContent);
  assert.match(national, /2026/);
  assert.match(await page.$eval("main", (element) => element.textContent), /dati parziali/i);
  await page.select("#receipts-region", "Lazio");
  await page.focus("#receipts-region");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "receipts-name");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("type")), "submit");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
  assert.equal(new URL(page.url()).searchParams.get("regione"), "Lazio");
  assert.equal(await page.$eval(".stat-strip", (element) => element.textContent), national, "Il filtro deve conservare il contesto nazionale");
  const rows = '#comuni-incassi tbody tr';
  assert.equal(await page.$$eval(rows, (items) => items.length), 25);
  assert.ok(await page.$$eval(`${rows} td:first-of-type`, (items) => items.every((item) => item.textContent === "Lazio")));
  const firstPage = await page.$$eval(`${rows} th`, (items) => items.map((item) => item.textContent));
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('a[rel="next"]')]);
  assert.equal(new URL(page.url()).searchParams.get("pagina"), "2");
  const headingVisible = await page.evaluate(() => {
    const heading = document.getElementById("receipts-municipalities-title").getBoundingClientRect();
    const header = document.querySelector(".site-header");
    const bottom = getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0;
    return heading.top >= bottom && heading.top < innerHeight;
  });
  assert.ok(headingVisible, "Il titolo della sezione deve restare visibile dopo la paginazione");
  const secondPage = await page.$$eval(`${rows} th`, (items) => items.map((item) => item.textContent));
  assert.ok(secondPage.every((name) => !firstPage.includes(name)), "Pagine senza duplicati");
  await page.type("#receipts-name", "zzzzComuneInesistentezzzz");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('main form button[type="submit"]')]);
  assert.match(await page.$eval("#comuni-incassi", (element) => element.textContent), /Nessun Comune corrisponde/);
  assert.equal(new URL(page.url()).searchParams.has("pagina"), false, "Il cambio filtro deve ripartire dalla prima pagina");
  const invalid = new URL("/entrate?anno=2023", page.url());
  await page.goto(invalid.href, { waitUntil: "networkidle0" });
  assert.match(await page.$eval('[role="alert"]', (element) => element.textContent), /Impossibile mostrare/);
  assert.ok(await page.$('[role="alert"] a[href="/entrate"]'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "overflow incassi");
}
