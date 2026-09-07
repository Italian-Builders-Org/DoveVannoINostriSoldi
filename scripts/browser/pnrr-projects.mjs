import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const records = 'section[aria-labelledby="results-title"] article';

async function submit(page) {
  await page.focus('main button[type="submit"]');
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.keyboard.press("Enter"),
  ]);
}

async function cupSearch(page, cup) {
  await page.focus('input[name="cup"]');
  await page.$eval('input[name="cup"]', (input) => input.select());
  await page.keyboard.type(cup);
  await submit(page);
}

export async function inspectPnrrProjects(page) {
  const width = page.viewport().width;
  const directory = "artifacts/browser/pnrr-projects";
  await mkdir(directory, { recursive: true });
  assert.match(await page.$eval("h1", (node) => node.textContent), /Dove sono i progetti del PNRR/);
  assert.match(await page.$eval("main", (node) => node.innerText), /285\.992/);
  assert.match(await page.$eval("main", (node) => node.innerText), /Finanziamento non significa pagamento/);
  assert.equal(await page.$$eval(records, (rows) => rows.length), 25);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(directory, `catalog-${width}.png`), fullPage: false });
  const firstCups = await page.$$eval(`${records} dd a`, (links) => links.map((link) => link.href));
  const next = 'nav[aria-label="Pagine risultati PNRR"] a';
  await page.focus(next);
  await page.keyboard.press("Tab");
  await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
  assert.ok(await page.$eval(next, (node) => document.activeElement === node && getComputedStyle(node).outlineStyle !== "none"));
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
  assert.match(await page.$eval("#results-title + p", (node) => node.textContent), /Mostrate 26 a 50/);
  const jsonHref = await page.$eval('section[aria-labelledby="results-title"] a[href^="/api/pnrr/progetti"]', (link) => link.href);
  assert.equal(new URL(jsonHref).searchParams.get("cursor"), new URL(page.url()).searchParams.get("cursor"));
  const secondCups = await page.$$eval(`${records} dd a`, (links) => links.map((link) => link.href));
  assert.notDeepEqual(firstCups, secondCups);
  await cupSearch(page, "F81C23001370006");
  assert.equal(new URL(page.url()).searchParams.has("cursor"), false);
  assert.equal(await page.$$eval(records, (rows) => rows.length), 2);
  assert.match(await page.$eval(records, (node) => node.innerText), /2\.299\.193,71 €/);
  await page.click(`${records} summary`);
  assert.ok(await page.$eval(`${records} details`, (node) => node.open));
  assert.match(await page.$eval(records, (node) => node.innerText), /97832870584/);
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/pnrr/progetti?cup=F81C23001370006");
    if (!response.ok) throw new Error(`API PNRR ${response.status}`);
    return response.json();
  });
  assert.equal(api.matchedRows, 2);
  assert.equal(api.rows[0].cells["Finanziamento PNRR"], "2299193,71");
  await page.screenshot({ path: join(directory, `cup-${width}.png`), fullPage: true });
  await page.focus('input[name="cup"]');
  await page.$eval('input[name="cup"]', (input) => input.select());
  await page.keyboard.press("Backspace");
  await page.select('select[name="mission"]', "M1");
  await page.select('select[name="region"]', "012");
  await submit(page);
  assert.ok(await page.$$eval(records, (rows) => rows.length > 0));
  const territorialApi = await page.evaluate(async () => (await fetch("/api/pnrr/progetti?mission=M1&region=012")).json());
  const titles = await page.$$eval(`${records} h3`, (nodes) => nodes.map((node) => node.textContent));
  assert.deepEqual(titles, territorialApi.rows.map((row) => row.cells["Titolo Progetto"]));
  await page.screenshot({ path: join(directory, `filters-${width}.png`), fullPage: false });
  await cupSearch(page, "Z99Z99999999999");
  assert.equal(await page.$$eval(records, (rows) => rows.length), 0);
  assert.match(await page.$eval("#results-title + p", (node) => node.textContent), /Nessuna registrazione/);
  await page.goto(new URL("/pnrr?cursor=invalid", page.url()).href, { waitUntil: "networkidle0" });
  assert.match(await page.$eval('[role="alert"]', (node) => node.textContent), /Cursor PNRR/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.ok(await page.$('main a[href="/coesione/asili"]'));
}
