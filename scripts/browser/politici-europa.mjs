import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  closeBrowser,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  waitForServer,
} from "./harness.mjs";

const base = defaultBaseUrl();
const atlasUrl = new URL("/politici", base).href;
const europaUrl = new URL("/politici/europa", base).href;
const homeUrl = new URL("/", base).href;
const output = path.join(defaultArtifactsDir(), "politici-europa");
await mkdir(output, { recursive: true });

await waitForServer(base.href);
const browser = await launchBrowser();
const results = [];

async function scenario(label, run) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.setDefaultTimeout(20_000);
  try {
    await run(page);
    assert.deepEqual(errors, [], `Errori JavaScript in ${label}`);
    await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: false });
    results.push({ label, status: "pass" });
    console.log(`PASS ${label}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${label}-fail.png`), fullPage: true }).catch(() => {});
    results.push({ label, status: "fail", error: error instanceof Error ? error.message : String(error) });
    console.error(`FAIL ${label}:`, error);
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await scenario("atlas-to-europa-link", async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    const response = await page.goto(atlasUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response?.ok(), `Atlante HTTP ${response?.status()}`);
    await page.waitForSelector('[data-politici-atlas][data-atlas-ready="true"]', { visible: true });
    const entry = await page.$("[data-europa-entry]");
    assert.ok(entry, "Manca il collegamento visibile verso /politici/europa");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      entry.click(),
    ]);
    assert.equal(new URL(page.url()).pathname, "/politici/europa");
  });

  await scenario("europa-scroll-and-chrome", async (page) => {
    await page.setViewport({ width: 1280, height: 800 });
    const response = await page.goto(europaUrl, { waitUntil: "networkidle0", timeout: 45_000 });
    assert.ok(response?.ok(), `Europa HTTP ${response?.status()}`);
    await page.waitForSelector("#eurodeputati-italia", { visible: true });

    const state = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      return {
        immersive: html.dataset.immersive ?? null,
        bodyOverflow: getComputedStyle(body).overflow + "/" + getComputedStyle(body).overflowY,
        scrollHeight: Math.max(html.scrollHeight, body.scrollHeight),
        clientHeight: html.clientHeight,
        hasNav: Boolean(document.querySelector(".desktop-sidebar, .site-header, header.site-header, nav")),
        hasMenuTrigger: Boolean(document.querySelector(".mobile-menu-trigger, .desktop-sidebar")),
        title: document.querySelector("h1")?.textContent?.trim() ?? "",
      };
    });

    assert.equal(state.immersive, null, "data-immersive non deve restare su /politici/europa");
    assert.ok(state.scrollHeight > state.clientHeight + 80, "La pagina europa deve essere più alta del viewport (scrollabile)");
    assert.ok(state.hasNav || state.hasMenuTrigger, "Chrome di navigazione del sito assente su /politici/europa");
    assert.match(state.title, /Eurodeputati/i);

    // Force a scroll and confirm it sticks.
    await page.evaluate(() => window.scrollTo(0, 400));
    const scrolled = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop);
    assert.ok(scrolled >= 200, `Scroll verticale bloccato (scrollY=${scrolled})`);
  });

  await scenario("europa-dvns-home-keeps-menu", async (page) => {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(europaUrl, { waitUntil: "networkidle0", timeout: 45_000 });
    // Soft-nav to home via site brand/logo if present; otherwise go directly then assert chrome.
    const brand = await page.$('a[aria-label*="DoveVannoINostriSoldi"], a[href="/"], .site-logo, a.brand');
    if (brand) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        brand.click(),
      ]);
    } else {
      await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
    assert.equal(new URL(page.url()).pathname, "/");
    const home = await page.evaluate(() => ({
      immersive: document.documentElement.dataset.immersive ?? null,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      hasSidebar: Boolean(document.querySelector(".desktop-sidebar")),
      hasHeader: Boolean(document.querySelector(".site-header, header.site-header, .header")),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      clientHeight: document.documentElement.clientHeight,
    }));
    assert.equal(home.immersive, null, "Home non deve restare immersiva");
    assert.ok(home.hasSidebar || home.hasHeader, "Menu del sito assente dopo navigazione dalla vista europa");
    assert.notEqual(home.bodyOverflowY, "hidden", "Home non deve avere overflow:hidden sul body");
    assert.ok(home.scrollHeight > home.clientHeight + 40, "Home deve restare scrollabile");
  });

  console.log(JSON.stringify({ suite: "politici-europa", results }, null, 2));
} finally {
  await closeBrowser(browser);
}
