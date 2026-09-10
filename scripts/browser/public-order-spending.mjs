import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

export async function inspectPublicOrderSpending(page) {
  assert.equal(await page.$eval("h1", (heading) => heading.textContent), "Ordine pubblico e sicurezza");
  const text = await page.$eval("main", (main) => main.innerText);
  assert.match(text, /39,09 mld €/);
  assert.match(text, /39\.094\.000\.000/);
  assert.match(text, /SEC 2010/);
  assert.match(text, /Dettaglio non disponibile/);
  assert.equal(await page.$eval("#sicurezza-detail-title", (heading) => heading.textContent), "Polizia, vigili del fuoco e giustizia");

  const tableSummary = await page.$(".chart-data > summary");
  await tableSummary.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".chart-data[open] tbody tr");
  const rows = await page.$$eval(".chart-data tbody tr", (rows) => rows.map((row) => row.innerText));
  assert.equal(rows.length, 11);
  assert.match(rows[0], /2014.*30\.317\.000\.000/s);
  assert.match(rows.at(-1), /2024.*39\.094\.000\.000/s);
  const tableRegion = await page.$(".chart-data [role=region]");
  await tableRegion.focus();
  assert.equal(await tableRegion.evaluate((element) => document.activeElement === element), true);

  const sourceSummary = await page.$("#sicurezza-fonti > summary");
  await sourceSummary.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#sicurezza-fonti[open]");
  const sourceText = await page.$eval("#sicurezza-fonti", (element) => element.innerText);
  assert.match(sourceText, /21 luglio 2026/);
  assert.match(sourceText, /10 settembre 2026/);
  assert.match(sourceText, /CP A1/);
  assert.match(sourceText, /non si sommano/);
  const hashes = await page.$("#sicurezza-fonti details > summary");
  await hashes.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#sicurezza-fonti details[open]");
  const codes = await page.$$eval("#sicurezza-fonti code", (codes) => codes.map((code) => code.textContent));
  assert.equal(codes.length, 3);
  for (const code of codes) assert.match(code, /^[a-f0-9]{64}$/);
  const apiHref = await page.$eval('main a[href^="/api/spese/cofog"]', (link) => link.href);
  const api = await page.evaluate(async (href) => {
    const response = await fetch(href);
    return { status: response.status, data: await response.json() };
  }, apiHref);
  assert.equal(api.status, 200);
  assert.equal(api.data.observations.length, 1);
  assert.equal(api.data.observations[0].geo, "IT");
  assert.equal(api.data.observations[0].function, "GF03");
  assert.equal(api.data.observations[0].amountCents, 3_909_400_000_000);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const artifactDirectory = path.join(defaultArtifactsDir(), "public-order", `${page.viewport().width}px`);
  mkdirSync(artifactDirectory, { recursive: true });
  await page.screenshot({ path: path.join(artifactDirectory, "sicurezza-2024-fonti.png"), fullPage: true });

  await page.select("#sicurezza-year", "2014");
  const submit = await page.$('form[action="/spese/sicurezza"] button');
  await submit.focus();
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
  assert.equal(new URL(page.url()).searchParams.get("anno"), "2014");
  assert.match(await page.$eval('[data-testid="sicurezza-total"]', (element) => element.innerText), /30,32 mld €/);
  assert.ok(await page.$('main a[href="/?anno=2014#pa-split-title"]'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(artifactDirectory, "sicurezza-2014.png"), fullPage: true });

  if (page.viewport().width === 390 || page.viewport().width === 1280) {
    await page.goto(new URL("/?anno=2014", page.url()).href, { waitUntil: "networkidle0" });
    const entry = await page.$('main a[href="/spese/sicurezza?anno=2014"]');
    assert.ok(entry, "La composizione PA deve collegare la funzione GF03 conservando l’anno");
    await entry.focus();
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
    assert.equal(new URL(page.url()).pathname, "/spese/sicurezza");
    assert.match(await page.$eval('[data-testid="sicurezza-total"]', (element) => element.innerText), /30,32 mld €/);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await waitForServer(defaultBaseUrl());
  const browser = await launchBrowser();
  try {
    for (const width of [320, 375, 390, 768, 1024, 1280, 1600]) {
      await runScenario(browser, {
        label: `Ordine pubblico e sicurezza ${width}px`, pathname: "/spese/sicurezza", width,
        validate: inspectPublicOrderSpending, suite: "public-order",
      });
      console.log(`PASS Ordine pubblico e sicurezza ${width}px`);
    }
  } finally {
    await closeBrowser(browser);
  }
}
