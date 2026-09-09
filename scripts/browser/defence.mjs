import assert from "node:assert/strict";
import budgetSnapshot from "../../src/data/generated/openbdap-budget-law-missions.json" with { type: "json" };

/** Start on the home page, then drive the public link and keyboard disclosures. */
export async function inspectDefence(page) {
  const link = 'main a[href^="/spese/difesa?anno="]';
  await page.waitForSelector(link);
  await page.focus(link);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/spese/difesa");
  await page.waitForSelector('[data-testid="defence-total"]');
  assert.equal(await page.$$eval("main h1", (elements) => elements.length), 1);
  assert.match(await page.$eval("main h1", (element) => element.textContent), /difesa/i);
  const apiHref = await page.$eval('main a[href^="/api/spese/cofog"]', (element) => element.href);
  const seriesHref = new URL(apiHref);
  const selectedYear = Number(seriesHref.searchParams.get("anno"));
  seriesHref.searchParams.delete("anno");
  const payload = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`COFOG API: ${response.status}`);
    return response.json();
  }, seriesHref.href);
  assert.ok(payload.observations.length > 0);
  assert.ok(payload.observations.every((point) => point.geo === "IT" && point.function === "GF02"));
  const selected = payload.observations.find((point) => point.year === selectedYear);
  assert.ok(selected);
  const exactEuro = (amount) => new Intl.NumberFormat("it-IT", {
    style: "currency", currency: "EUR", maximumFractionDigits: 2, useGrouping: "always",
  }).format(amount);
  const compactEuro = (amount) => `${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always",
  }).format(amount / 1_000_000_000)} mld €`;
  const body = await page.$eval("main", (element) => element.textContent);
  const summary = await page.$eval('section[aria-labelledby="defence-total-title"]', (element) => element.textContent);
  assert.ok(summary.includes(exactEuro(selected.amountCents / 100)));
  assert.equal(await page.$eval('[data-testid="defence-total"]', (element) => element.textContent), compactEuro(selected.amountCents / 100));
  assert.match(body, /SEC 2010/);
  assert.match(body, /non sommare/i);
  assert.match(body, /CP A1/);

  await page.focus('[data-testid="defence-annual"] summary');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="defence-annual"]').open);
  const rows = await page.$$eval('[data-testid="defence-annual"] tbody tr', (elements) => elements.map((row) => [...row.cells].map((cell) => cell.textContent)));
  for (const point of payload.observations) {
    assert.equal(rows.find((row) => row[0] === String(point.year))?.[1], exactEuro(point.amountCents / 100));
  }
  const allocations = budgetSnapshot.series.allocations.filter((point) => point.mission === "Difesa e sicurezza del territorio");
  for (const point of allocations) {
    assert.equal(rows.find((row) => row[0] === String(point.year))?.[3], exactEuro(point.amountEur));
  }
  const selectedBudget = allocations.find((point) => point.year === selected.year);
  const comparisonValues = await page.$$eval('[data-testid="defence-comparison"] dd', (elements) => elements.map((element) => element.textContent));
  assert.deepEqual(comparisonValues, [compactEuro(selected.amountCents / 100), selectedBudget ? compactEuro(selectedBudget.amountEur) : "Non disponibile"]);
  const latestBudget = allocations.reduce((left, right) => left.year > right.year ? left : right);
  const latestBudgetCopy = await page.$eval('[data-testid="defence-latest-budget"]', (element) => element.textContent);
  assert.ok(latestBudgetCopy.includes(String(latestBudget.year)));
  assert.ok(latestBudgetCopy.includes(exactEuro(latestBudget.amountEur)));
  assert.ok(rows.some((row) => row[1] === "Non disponibile"));
  assert.ok(rows.some((row) => row[3] === "Non disponibile"));
  await page.focus('[data-testid="defence-annual"] .table-scroll');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "region");
  await page.focus("#fonti-difesa > summary");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#fonti-difesa").open);
  const sources = await page.$eval("#fonti-difesa", (element) => element.textContent);
  assert.match(sources, /NATO/);
  assert.match(sources, /missioni estere/);
  assert.match(sources, /Non dichiarata nello snapshot/);
  assert.match(sources, /SHA-256/);
  const visibleHistory = await page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Spesa PA per la difesa per anno"]');
    const svg = document.querySelector('svg[aria-labelledby="defence-chart-title defence-chart-desc"]');
    return { list: getComputedStyle(list).display !== "none", svg: getComputedStyle(svg).display !== "none", width: innerWidth };
  });
  assert.equal(visibleHistory.list, visibleHistory.width <= 620);
  assert.equal(visibleHistory.svg, visibleHistory.width > 620);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Difesa: overflow orizzontale globale");

  const earliest = payload.observations.reduce((left, right) => left.year < right.year ? left : right);
  await page.select("#defence-year", String(earliest.year));
  await page.focus('form[action="/spese/difesa"] button');
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
  assert.equal(new URL(page.url()).searchParams.get("anno"), String(earliest.year));
  assert.match(await page.$eval("#defence-total-title", (element) => element.textContent), new RegExp(String(earliest.year)));
  assert.ok((await page.$eval('section[aria-labelledby="defence-total-title"]', (element) => element.textContent)).includes(exactEuro(earliest.amountCents / 100)));
  assert.equal(await page.$eval('[data-testid="defence-total"]', (element) => element.textContent), compactEuro(earliest.amountCents / 100));
  assert.match(await page.$eval('[data-testid="defence-comparison"]', (element) => element.textContent), /Non disponibile/);
  const backLink = `main a[href="/?anno=${earliest.year}#pa-split-title"]`;
  await page.focus(backLink);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/");
  const historicalEntry = `main a[href="/spese/difesa?anno=${earliest.year}"]`;
  await page.waitForSelector(historicalEntry);
  await page.focus(historicalEntry);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/spese/difesa");
  await page.waitForSelector('[data-testid="defence-total"]');
  assert.equal(new URL(page.url()).searchParams.get("anno"), String(earliest.year));
  assert.equal(await page.$eval('[data-testid="defence-total"]', (element) => element.textContent), compactEuro(earliest.amountCents / 100));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Difesa storica: overflow orizzontale globale");
}
