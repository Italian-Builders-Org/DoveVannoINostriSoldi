import assert from "node:assert/strict";

const bandiSelector = 'ol[aria-label="Bandi TED aperti"] > li';
const mepaSelector = 'ol[aria-label="Bandi Consip programma"] > li';

export async function inspectOpenProcurement(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('main a[href="/appalti/bandi-aperti"]'),
  ]);
  assert.match(await page.$eval("h1", (node) => node.textContent), /Bandi aperti con committente in Italia/);
  await page.select("#bandi-tipo", "forniture");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("#bandi-applica-filtri"),
  ]);
  assert.match(await page.$eval('[role="status"]', (node) => node.textContent), /con i filtri applicati/);
  assert.ok(await page.$$eval(bandiSelector, (rows) => rows.length > 0));
  assert.ok(await page.$$eval(`${bandiSelector} strong`, (labels) => labels.every((node) => node.textContent === "Forniture")));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const official = await page.$eval(`${bandiSelector} a[href^="https://ted.europa.eu/"]`, (node) => node.href);
  assert.match(official, /ted\.europa\.eu/);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('a[href="/appalti/mepa"]'),
  ]);
  assert.match(await page.$eval("h1", (node) => node.textContent), /MePA e bandi del programma Consip/);
  assert.match(
    await page.$eval('aside[aria-labelledby="mepa-limits"]', (node) => node.textContent),
    /non replica la vetrina operativa/,
  );
  assert.ok(await page.$$eval(mepaSelector, (rows) => rows.length > 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
