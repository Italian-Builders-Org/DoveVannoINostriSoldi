import assert from "node:assert/strict";

const notices = 'ol[aria-label="Avvisi TED"] > li';

async function search(page, query) {
  await page.focus("#ted-query");
  await page.$eval("#ted-query", (input) => input.select());
  await page.keyboard.type(query);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.keyboard.press("Enter"),
  ]);
  assert.equal(new URL(page.url()).searchParams.get("q"), query);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

export async function inspectTedNotices(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('main a[href="/appalti/ted"]'),
  ]);
  assert.match(await page.$eval("h1", (node) => node.textContent), /Avvisi TED con committenti in Italia/);
  assert.equal(await page.$$eval(notices, (rows) => rows.length), 25);
  assert.match(await page.$eval("#ted-scope + p", (node) => node.textContent), /non è il numero dei contratti/);
  const firstNumbers = await page.$$eval(`${notices} h3 a`, (nodes) => nodes.map((node) => node.href));
  await page.focus('nav[aria-label="Scorrimento degli avvisi"] a[href*="cursor="]');
  await page.keyboard.press("Tab");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  assert.ok(await page.$eval('nav[aria-label="Scorrimento degli avvisi"] a[href*="cursor="]', (node) => {
    const style = getComputedStyle(node);
    return document.activeElement === node && style.outlineStyle !== "none";
  }));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.keyboard.press("Enter"),
  ]);
  const secondNumbers = await page.$$eval(`${notices} h3 a`, (nodes) => nodes.map((node) => node.href));
  assert.equal(new Set([...firstNumbers, ...secondNumbers]).size, 50);
  await search(page, "548051-2026");
  assert.equal(new URL(page.url()).searchParams.has("cursor"), false);
  assert.equal(await page.$$eval(notices, (rows) => rows.length), 1);
  assert.equal(await page.$eval('main [role="status"]', (node) => node.textContent), "1 avviso mostrato su 1 corrispondenza.");
  const text = await page.$eval(notices, (node) => node.innerText);
  assert.match(text, /SWE, ITA/);
  assert.match(text, /European Food Safety Authority/);
  assert.ok(await page.$(`${notices} p[lang="en"]`));
  const url = await page.$eval(`${notices} h3 a`, (node) => node.href);
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/dati/ted-avvisi-italia-2026-08?q=548051-2026&limit=25");
    if (!response.ok) throw new Error(`API TED ${response.status}`);
    return response.json();
  });
  assert.equal(api.rows.length, 1);
  assert.equal(api.rows[0].cells["URL avviso"], url);
  assert.equal(api.dataset.publicRows, 2825);
  assert.equal(api.dataset.licenseStatus, "verified-open-eu-reuse");
  await search(page, "nessunavvisotedcorrisponde123");
  assert.equal(await page.$$eval(notices, (rows) => rows.length), 0);
  assert.match(await page.$eval('main [role="status"]', (node) => node.textContent), /Nessun avviso/);
  await page.goto(new URL("/appalti/ted?cursor=invalid", page.url()).href, { waitUntil: "networkidle0" });
  assert.match(await page.$eval('main [role="alert"]', (node) => node.textContent), /primi avvisi/);
  assert.equal(await page.$$eval(notices, (rows) => rows.length), 25);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
