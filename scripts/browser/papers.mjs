import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
mkdirSync("artifacts/browser", { recursive: true });
await waitForServer(baseUrl);
const alias = await fetch(new URL("/paper", baseUrl), { redirect: "manual" });
assert.equal(alias.status, 308, "L'alias deve conservare l'archivio canonico Studi");
assert.equal(new URL(alias.headers.get("location"), baseUrl).pathname, "/studi");
assert.equal((await fetch(new URL("/studi/non-pubblicato", baseUrl))).status, 404, "Le bozze non devono avere route pubbliche");
const browser = await launchBrowser();
try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      label: `Archivio Studi ${width}px`, pathname: "/paper", width, suite: "papers",
      validate: async (page) => {
        await page.waitForNetworkIdle({ idleTime: 250, timeout: 10_000 });
        const state = await page.evaluate(() => ({
          headings: [...document.querySelectorAll("main h1")].map((node) => node.textContent),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          current: [...document.querySelectorAll('nav.primary-nav a[data-section-active="true"]')].map((node) => node.textContent.trim()),
          text: document.querySelector("main").textContent,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
          pdf: document.querySelector('main a[href$=".pdf"]')?.getAttribute("href"),
          research: document.querySelector('main a[href*="/tree/"]')?.getAttribute("href"),
        }));
        assert.deepEqual(state.headings, ["Paper di ricerca"]);
        assert.equal(state.overflow, false);
        assert.deepEqual(state.current, ["Studi"]);
        assert.match(state.text, /Dai fondi ai posti/);
        assert.match(state.text, /Versione 1\.3/);
        assert.match(state.text, /13 giugno 2026/);
        assert.doesNotMatch(state.text, /Non ci sono ancora studi/);
        assert.equal(state.pdf, "/studi/dai-fondi-ai-posti/v1.3/dai-fondi-ai-posti.pdf");
        assert.match(state.research, /\/tree\/[a-f0-9]{40}\//);
        assert.equal(state.canonical, "https://www.dovevannoinostrisoldi.com/studi");
        const nav = await page.$$eval(".primary-nav-list > li", (items) => items.map((item) => ({
          top: item.getBoundingClientRect().top,
          icons: item.querySelectorAll(":scope > a > svg").length,
        })));
        assert.equal(new Set(nav.map((item) => Math.round(item.top))).size, 1, "La navigazione deve restare su una riga");
        assert.ok(nav.every((item) => item.icons === 1), "Ogni sezione deve avere un'icona coerente");
        const navLabels = await page.$$eval('.nav-item > a', (links) => links.map((link) => link.textContent.trim()));
        assert.deepEqual(navLabels.slice(0, 5), ['Home', 'Imprese', 'Istruzione', 'Soldi', 'Territori']);
        assert.deepEqual(navLabels.slice(-2), ['Report mensili', 'Studi']);
        assert.equal(await page.evaluate(() => {
          const container = document.querySelector('.primary-nav').getBoundingClientRect();
          const active = document.querySelector('.nav-item > a[data-section-active="true"]').getBoundingClientRect();
          return active.left >= container.left - 1 && active.right <= container.right + 1;
        }), true, 'La sezione attiva deve essere visibile anche su mobile');
        if (width === 1280) {
          const backward = await page.$('.nav-scroll-control-backward');
          await backward.focus();
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.querySelector('.primary-nav').scrollLeft <= 1);
          await page.click('.nav-scroll-control-forward');
          await page.waitForFunction(() => {
            const container = document.querySelector('.primary-nav');
            const last = container.querySelector('li:last-child');
            return last.getBoundingClientRect().right <= container.getBoundingClientRect().right + 1;
          });
        }
        const details = await page.$("main details summary");
        await details.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.$eval("main details", (node) => node.open), true);
        assert.match(await page.$eval("main details code", (node) => node.textContent), /^[a-f0-9]{64}$/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: `artifacts/browser/papers-${width}.png`, fullPage: true });
      },
    });
  }
} finally { await closeBrowser(browser); }
console.log("PASS paper: canonical archive, published study, versions, alias, keyboard and responsive layouts");
