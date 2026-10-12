import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import snapshot from "../../src/data/generated/consulenti-regionali.json" with { type: "json" };
import {
  closeBrowser,
  defaultBaseUrl,
  launchBrowser,
  runScenario,
  waitForServer,
} from "./harness.mjs";

const exactEuro = (amount) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
    useGrouping: "always",
  }).format(amount);

export async function inspectIncarichiTerritori(page) {
  await page.waitForSelector('[data-testid="territori-summary"]');
  assert.equal(await page.$$eval("main h1", (elements) => elements.length), 1);
  assert.match(
    await page.$eval("main h1", (element) => element.textContent),
    /territorio/i,
  );

  const latest = snapshot.years[snapshot.years.length - 1];
  const body = await page.$eval("main", (element) => element.textContent);
  assert.match(body, /Non sono i bilanci delle sole Regioni/i);
  assert.match(body, /non sommare/i);
  assert.match(body, /Consulenti Pubblici/i);
  assert.ok(body.includes(exactEuro(latest.paidCents / 100)));

  const rows = await page.$$eval(
    '[data-testid="territori-table"] tbody tr',
    (elements) => elements.map((row) => [...row.cells].map((cell) => cell.textContent.trim())),
  );
  assert.equal(rows.length, latest.territoryCount);
  for (const territory of latest.territories) {
    const match = rows.find((row) => row[0] === territory.territoryLabel);
    assert.ok(match, `manca ${territory.territoryLabel}`);
    assert.ok(match[3].includes(exactEuro(territory.paidCents / 100)));
  }

  await page.focus('[data-testid="territori-table"]');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "region");

  const closedYear = snapshot.years[0].year;
  assert.ok(await page.$('form[action="/incarichi/territori"] select[name="anno"]'));
  await page.goto(
    new URL(`/incarichi/territori?anno=${closedYear}`, page.url()).href,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForSelector('[data-testid="territori-summary"]');
  const selectedLabel = await page.$eval(
    'select[name="anno"]',
    (element) => element instanceof HTMLSelectElement ? element.value : "",
  );
  assert.equal(selectedLabel, String(closedYear));
  const closed = snapshot.years.find((item) => item.year === closedYear);
  const closedBody = await page.$eval("main", (element) => element.textContent);
  assert.ok(closedBody.includes(exactEuro(closed.paidCents / 100)));

  const api = await page.evaluate(async (year) => {
    const response = await fetch(`/api/incarichi/territori?anno=${year}`);
    if (!response.ok) throw new Error(`API territori: ${response.status}`);
    return response.json();
  }, closedYear);
  assert.equal(api.ok, true);
  assert.equal(api.selectedYear, closedYear);
  assert.equal(api.data.paidCents, closed.paidCents);
  assert.equal(api.data.territories.length, closed.territoryCount);

  await page.focus("#fonti-territori > summary");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#fonti-territori").open);
  const sources = await page.$eval("#fonti-territori", (element) => element.textContent);
  assert.match(sources, /Dipartimento della Funzione Pubblica/);
  assert.match(sources, /RGS/);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await waitForServer(defaultBaseUrl());
  const browser = await launchBrowser();
  try {
    for (const width of [390, 768, 1280]) {
      await runScenario(browser, {
        label: `Incarichi territori ${width}px`,
        pathname: "/incarichi/territori",
        width,
        validate: inspectIncarichiTerritori,
        suite: "incarichi-territori",
      });
      console.log(`PASS incarichi territori ${width}px`);
    }
  } finally {
    await closeBrowser(browser);
  }
}
