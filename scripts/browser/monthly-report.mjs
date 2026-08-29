import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeBrowser,
  defaultBaseUrl,
  launchBrowser,
  runScenario,
  waitForServer,
} from "./harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseUrl = defaultBaseUrl();
const reviewDirectory = path.join(root, ".impeccable", "review");

assert.ok(["http:", "https:"].includes(baseUrl.protocol), "DVNS_BASE_URL non valido");
mkdirSync(reviewDirectory, { recursive: true });

async function inspectReport(page, width) {
  const label = `report agosto 2026 ${width}px`;
  const state = await page.evaluate(() => {
    const rootElement = document.documentElement;
    const figures = [...document.querySelectorAll("main figure")];
    const details = [...document.querySelectorAll("main figure details.chart-data")];
    const captions = [...document.querySelectorAll("main figure table caption")];
    const rowCounts = [...document.querySelectorAll("main figure table tbody")].map(
      (body) => body.querySelectorAll("tr").length,
    );
    const currentLinks = [...document.querySelectorAll('nav.primary-nav a[data-section-active="true"]')]
      .map((link) => link.textContent?.trim());
    return {
      h1Count: document.querySelectorAll("main h1").length,
      h1: document.querySelector("main h1")?.textContent?.trim(),
      bodyWidth: document.body.scrollWidth,
      clientWidth: rootElement.clientWidth,
      figureCount: figures.length,
      detailsCount: details.length,
      captions: captions.map((caption) => caption.textContent?.trim()),
      rowCounts,
      currentLinks,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      openGraphType: document.querySelector('meta[property="og:type"]')?.getAttribute("content"),
      author: document.querySelector('meta[name="author"]')?.getAttribute("content"),
    };
  });

  assert.equal(state.h1Count, 1, `${label}: serve un solo h1`);
  assert.equal(state.h1, "Imprese e territori", `${label}: titolo inatteso`);
  assert.ok(state.bodyWidth <= state.clientWidth + 1, `${label}: overflow globale`);
  assert.equal(state.figureCount, 2, `${label}: servono due visualizzazioni`);
  assert.equal(state.detailsCount, 2, `${label}: servono due tabelle accessibili`);
  assert.deepEqual(state.rowCounts, [16, 20], `${label}: righe grafici e tabelle divergenti`);
  assert.equal(state.captions.length, 2, `${label}: caption delle tabelle assenti`);
  assert.ok(state.captions.every(Boolean), `${label}: caption vuota`);
  assert.deepEqual(state.currentLinks, ["Report mensili"], `${label}: navigazione attiva errata`);
  assert.equal(
    state.canonical,
    "https://www.dovevannoinostrisoldi.com/report/2026-08",
    `${label}: canonical errato`,
  );
  assert.equal(state.openGraphType, "article", `${label}: Open Graph non è article`);
  assert.equal(state.author, "Redazione DVNS", `${label}: autore metadata errato`);

  const firstSummary = await page.$("main figure details.chart-data > summary");
  assert.ok(firstSummary, `${label}: summary della tabella assente`);
  await firstSummary.focus();
  assert.equal(
    await firstSummary.evaluate((element) => document.activeElement === element),
    true,
    `${label}: summary non raggiungibile da tastiera`,
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (element) => element.closest("details")?.open === true,
    { timeout: 2_000 },
    firstSummary,
  );

  await page.screenshot({
    path: path.join(reviewDirectory, `monthly-report-${width}.png`),
    fullPage: true,
  });
}

async function inspectArchive(page, width) {
  const label = `archivio report ${width}px`;
  const state = await page.evaluate(() => ({
    h1Count: document.querySelectorAll("main h1").length,
    h1: document.querySelector("main h1")?.textContent?.trim(),
    bodyWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    issueLinks: [...document.querySelectorAll('main a[href^="/report/"]')]
      .map((link) => link.getAttribute("href")),
    currentLinks: [...document.querySelectorAll('nav.primary-nav a[data-section-active="true"]')]
      .map((link) => link.textContent?.trim()),
  }));
  assert.equal(state.h1Count, 1, `${label}: serve un solo h1`);
  assert.equal(state.h1, "Il mese dei soldi pubblici", `${label}: titolo inatteso`);
  assert.ok(state.bodyWidth <= state.clientWidth + 1, `${label}: overflow globale`);
  assert.ok(state.issueLinks.includes("/report/2026-08"), `${label}: edizione assente`);
  assert.deepEqual(state.currentLinks, ["Report mensili"], `${label}: navigazione attiva errata`);
}

await waitForServer(baseUrl);
const missingResponse = await fetch(new URL("/report/2026-09", baseUrl));
assert.equal(missingResponse.status, 404, "Un mese sconosciuto deve restituire 404");

const browser = await launchBrowser();
try {
  for (const width of [390, 1280]) {
    await runScenario(browser, {
      label: `Archivio report ${width}px`,
      pathname: "/report",
      width,
      suite: "monthly-report",
      validate: (page) => inspectArchive(page, width),
    });
    await runScenario(browser, {
      label: `Report agosto 2026 ${width}px`,
      pathname: "/report/2026-08",
      width,
      suite: "monthly-report",
      validate: (page) => inspectReport(page, width),
    });
  }
} finally {
  await closeBrowser(browser);
}

console.log("PASS monthly report browser: archivio, edizione, 404, metadata e accessibilità");
