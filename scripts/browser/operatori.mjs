import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, navigate, runScenario } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const screenshots = path.join(defaultArtifactsDir(), "operatori");
mkdirSync(screenshots, { recursive: true });
const list = 'ol[aria-label="Elenco operatori ANAC"]';
const results = 'ol[aria-label="Risultati imprese aggiudicatarie"]';
const browser = await launchBrowser();
try {
  for (const width of [1280, 768, 390]) {
    await runScenario(browser, {
      label: `operatori list and detail ${width}`, pathname: "/appalti/operatori?vista=elenco", width, baseUrl, suite: "operatori", readySelector: list,
      validate: async (page) => {
        assert.equal(await page.$$eval(`${list} > li`, (rows) => rows.length), 50);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
        const firstRef = await page.$eval(`${list} h3 a`, (link) => link.getAttribute("href"));
        await page.screenshot({ path: path.join(screenshots, `list-${width}.png`) });
        await page.click('a[href="/appalti/operatori?vista=elenco&page=2"]');
        await page.waitForFunction(() => new URL(location.href).searchParams.get("page") === "2");
        await page.waitForFunction((selector, previous) => {
          const first = document.querySelector(`${selector} h3 a`);
          return first && first.getAttribute("href") !== previous;
        }, {}, list, firstRef);
        assert.equal(await page.$$eval(`${list} > li`, (rows) => rows.length), 50);
        await page.click('a[href="/appalti/operatori?vista=elenco&ordine=valore"]');
        await page.waitForFunction(() => new URL(location.href).searchParams.get("ordine") === "valore");
        await page.waitForSelector('[aria-label="Ordine dell\'elenco"] a[aria-current="page"][href*="ordine=valore"]');
        await page.waitForSelector(list);
        const ref = await page.$eval(`${list} h3 a`, (link) => link.getAttribute("href"));
        const name = await page.$eval(`${list} h3 a`, (link) => link.textContent);
        await page.click(`${list} h3 a`);
        await page.waitForSelector("#operatore-awards-title");
        assert.equal(new URL(page.url()).pathname, ref);
        assert.equal(await page.$eval("h1", (heading) => heading.textContent), name);
        assert.ok(await page.$$eval('main tbody tr', (rows) => rows.length > 0 && rows.length <= 15));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
        await page.screenshot({ path: path.join(screenshots, `detail-${width}.png`) });
        await navigate(page, { url: new URL('/appalti/operatori?q=autostrade', baseUrl).toString(), label: "operator name search", readySelector: results });
        assert.ok(await page.$$eval(`${results} > li`, (rows) => rows.length > 0 && rows.length <= 50));
        await page.focus("#operatori-query");
        await page.click("#operatori-query", { clickCount: 3 });
        await page.type("#operatori-query", "zzzzinesistentezzzz");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Nessuna impresa"));
        assert.equal(await page.$$eval(`${results} > li`, (rows) => rows.length), 0);
      },
    });
  }
  for (const query of ["page=1234", "page=99999", "page=-1", "ordine=valore&page=1234"]) {
    await runScenario(browser, { label: `operator pagination ${query}`, pathname: `/appalti/operatori?vista=elenco&${query}`, width: 390, baseUrl, suite: "operatori", readySelector: list,
      validate: async (page) => {
        assert.ok(await page.$$eval(`${list} > li`, (rows) => rows.length > 0 && rows.length <= 50));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      },
    });
  }
  console.log("Operator hub/list: both orders, navigation, deep/last pages, search/empty state and complete detail PASS at 390/768/1280px");
} finally { await closeBrowser(browser); }
