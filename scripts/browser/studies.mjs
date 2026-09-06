import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const capsule = JSON.parse(await readFile(new URL("../../src/content/studies/childcare.json", import.meta.url), "utf8"));
const evidence = new URL("../../artifacts/browser/studies/", import.meta.url);
await mkdir(evidence, { recursive: true });
await waitForServer(baseUrl);
const browser = await launchBrowser();
const results = [];
try {
  for (const width of [390, 1440]) {
    await runScenario(browser, {
      label: `Studi: archivio, dettaglio e download a ${width}px`,
      suite: "studies", pathname: "/fonti", width,
      validate: async (page) => {
        await page.click('footer a[href="/studi"]');
        await page.waitForFunction(() => location.pathname === "/studi" && document.querySelector("main h1")?.textContent === "Paper di ricerca");
        await page.waitForFunction(() => {
          const title = document.querySelector("main h1")?.getBoundingClientRect();
          const header = document.querySelector(".site-header")?.getBoundingClientRect();
          return title && header && title.top >= header.bottom && title.bottom <= innerHeight;
        });
        assert.equal(await page.$eval("main h1", el => el.textContent), "Paper di ricerca");
        await page.screenshot({ path: new URL(`archive-${width}.png`, evidence).pathname, fullPage: true });
        await page.screenshot({ path: new URL(`archive-top-${width}.png`, evidence).pathname });
        await page.click('main a[href="/studi/dai-fondi-ai-posti"]');
        await page.waitForFunction(() => location.pathname === "/studi/dai-fondi-ai-posti" && document.querySelector("main h1")?.textContent === "Dai fondi ai posti");
        await page.waitForFunction(() => {
          const title = document.querySelector("main h1")?.getBoundingClientRect();
          const header = document.querySelector(".site-header")?.getBoundingClientRect();
          return title && header && title.top >= header.bottom && title.bottom <= innerHeight;
        });
        const state = await page.evaluate(() => ({
          headings: document.querySelectorAll("main h1").length,
          body: document.querySelector("main").textContent,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
          rows: document.querySelectorAll("main tbody tr").length,
          download: document.querySelector('main a[download]')?.getAttribute("href"),
        }));
        assert.equal(state.headings, 1);
        assert.equal(state.overflow, false);
        assert.equal(await page.$eval("main dd", el => el.textContent.replace(/\D/g, "")), "2980");
        assert.match(state.body, /13 giugno 2026/);
        assert.match(state.canonical, /\/studi\/dai-fondi-ai-posti$/);
        assert.equal(state.rows, 7);
        const response = await fetch(new URL(state.download, baseUrl));
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /application\/pdf/);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(createHash("sha256").update(bytes).digest("hex"), capsule.assets["dai-fondi-ai-posti.pdf"].sha256);
        await page.screenshot({ path: new URL(`study-${width}.png`, evidence).pathname, fullPage: true });
        await page.screenshot({ path: new URL(`study-top-${width}.png`, evidence).pathname });
        await page.click("main details summary");
        assert.equal(await page.$eval("main details", el => el.open), true);
        results.push({ width, ...state, body: undefined, pdfHashVerified: true });
      },
    });
  }
  await writeFile(new URL("state.json", evidence), JSON.stringify(results, null, 2));
  console.log("PASS: studies desktop/mobile, navigation, canonical, denominators and PDF checksum");
} finally {
  await closeBrowser(browser);
}
