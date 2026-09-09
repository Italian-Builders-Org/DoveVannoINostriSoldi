import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

async function inspectSelectedCulture(page, year) {
  assert.match(await page.$eval("#culture-selected-title", (element) => element.textContent), new RegExp(`GF08 · ${year}`));
  const apiLink = await page.$eval('main a[href^="/api/spese/cofog"]', (element) => element.href);
  const apiUrl = new URL(apiLink);
  assert.equal(apiUrl.searchParams.get("anno"), String(year));
  assert.equal(apiUrl.searchParams.get("paese"), "IT");
  assert.equal(apiUrl.searchParams.get("funzione"), "GF08");
  const payload = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API COFOG ${response.status}`);
    return response.json();
  }, apiLink);
  assert.equal(payload.observations.length, 1);
  const row = payload.observations[0];
  assert.equal(row.year, year);
  assert.equal(row.geo, "IT");
  assert.equal(row.function, "GF08");
  const exact = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2, useGrouping: "always" }).format(row.amountCents / 100);
  assert.ok((await page.$eval('[data-testid="culture-exact"]', (element) => element.textContent)).includes(exact));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `culture ${year}: overflow`);
}

export async function inspectCulture(page) {
  assert.equal(await page.$$eval("main h1", (elements) => elements.length), 1);
  assert.equal(await page.$eval("main h1", (element) => element.textContent), "Cultura e tempo libero");
  assert.equal(await page.$$eval('[data-testid="culture-history"] tbody tr', (rows) => rows.length), 11);
  assert.match(await page.$eval("main", (element) => element.textContent), /cultura e culto/);
  assert.match(await page.$eval("main", (element) => element.textContent), /Le sottofunzioni non sono disponibili nello snapshot/);
  await inspectSelectedCulture(page, 2024);
  assert.match(await page.$eval('[data-testid="culture-budget-selected"]', (element) => element.textContent), /3\.286\.989\.285,00/);
  const artifactDirectory = path.join(defaultArtifactsDir(), "culture", `${page.viewport().width}px`);
  mkdirSync(artifactDirectory, { recursive: true });
  await page.screenshot({ path: path.join(artifactDirectory, "culture-2024.png"), fullPage: true });

  await page.select("#culture-year", "2014");
  await page.focus('main form button[type="submit"]');
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.keyboard.press("Enter")]);
  await page.waitForSelector("#culture-selected-title");
  await inspectSelectedCulture(page, 2014);
  assert.equal(new URL(page.url()).searchParams.get("anno"), "2014");
  assert.equal(await page.$eval('[data-testid="culture-budget-selected"]', (element) => element.textContent), "Non disponibile");

  await page.focus('details:has([data-testid="culture-budget-history"]) > summary');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('details:has([data-testid="culture-budget-history"])')?.open === true);
  assert.equal(await page.$$eval('[data-testid="culture-budget-history"] tbody tr', (rows) => rows.length), 10);

  await page.focus('[data-testid="culture-sources"] > summary');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="culture-sources"]')?.open === true);
  assert.match(await page.$eval('[data-testid="culture-sources"]', (element) => element.textContent), /CC-BY-4\.0/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "culture expanded sources overflow");
  await page.screenshot({ path: path.join(artifactDirectory, "culture-2014-sources.png"), fullPage: true });
}

export async function inspectCultureJourney(page) {
  const link = await page.$('main a[href="/spese/cultura?anno=2014"]');
  assert.ok(link, "Home GF08 must preserve the selected year when linking to culture");
  await link.click();
  await page.waitForSelector("#culture-selected-title", { visible: true });
  assert.equal(new URL(page.url()).searchParams.get("anno"), "2014");
  await inspectSelectedCulture(page, 2014);
  assert.equal(await page.$eval('[data-testid="culture-budget-selected"]', (element) => element.textContent), "Non disponibile");
  await page.click('main a[href="/spese/sport"]');
  await page.waitForFunction(() => document.querySelector("main h1")?.textContent === "Fondi pubblici per lo sport");
  assert.match(await page.$eval("main", (element) => element.textContent), /non\s+costituiscono una scomposizione/);
  await page.click('main a[href="/spese/cultura"]');
  await page.waitForSelector("#culture-selected-title", { visible: true });
}

export async function inspectInvalidCultureYears(baseUrl = defaultBaseUrl()) {
  for (const query of ["anno=2013", "anno=2025", "anno=2024x", "anno=2024&anno=2023"]) {
    const response = await fetch(new URL(`/spese/cultura?${query}`, baseUrl));
    const html = await response.text();
    assert.ok(response.status === 404 || (response.status === 200 && /name="robots" content="noindex"/.test(html)), `invalid culture selection ${query}`);
    assert.doesNotMatch(html, /data-testid="culture-total"/);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseUrl = defaultBaseUrl();
  await waitForServer(baseUrl);
  const browser = await launchBrowser();
  try {
    for (const width of [320, 375, 390, 768, 1024, 1280, 1600]) {
      await runScenario(browser, { label: `Cultura ${width}px`, pathname: "/spese/cultura", width, validate: inspectCulture, suite: "culture" });
      console.log(`PASS Cultura ${width}px`);
    }
    for (const width of [390, 1280]) {
      await runScenario(browser, { label: `Home cultura sport ${width}px`, pathname: "/?anno=2014", width, validate: inspectCultureJourney, suite: "culture" });
      console.log(`PASS Home cultura sport ${width}px`);
    }
    await inspectInvalidCultureYears(baseUrl);
    console.log("PASS Invalid culture years");
  } finally {
    await closeBrowser(browser);
  }
}
