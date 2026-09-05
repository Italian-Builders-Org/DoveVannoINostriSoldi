import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
mkdirSync("artifacts/browser", { recursive: true });
await waitForServer(baseUrl);
assert.equal((await fetch(new URL("/paper/dai-fondi-ai-posti", baseUrl))).status, 404, "Il paper in lavorazione non deve avere una route pubblica");
const browser = await launchBrowser();
try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      label: `Paper ${width}px`, pathname: "/paper", width, suite: "papers",
      validate: async (page) => {
        const state = await page.evaluate(() => ({
          headings: [...document.querySelectorAll("main h1")].map((node) => node.textContent),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          current: [...document.querySelectorAll('nav.primary-nav a[data-section-active="true"]')].map((node) => node.textContent.trim()),
          text: document.querySelector("main").textContent,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
          pdfLinks: document.querySelectorAll('main a[href$=".pdf"]').length,
        }));
        assert.deepEqual(state.headings, ["Paper e ricerca"]);
        assert.equal(state.overflow, false);
        assert.deepEqual(state.current, ["Paper"]);
        assert.match(state.text, /Non ci sono ancora paper pubblicati/);
        assert.equal(state.pdfLinks, 0);
        assert.equal(state.canonical, "https://www.dovevannoinostrisoldi.com/paper");
        const method = await page.$('main a[href="/metodologia"]');
        await method.focus();
        assert.equal(await method.evaluate((node) => node === document.activeElement), true);
        await page.screenshot({ path: `artifacts/browser/papers-${width}.png`, fullPage: true });
      },
    });
  }
} finally { await closeBrowser(browser); }
console.log("PASS paper: archive, discovery, keyboard, responsive layouts and unpublished 404");
