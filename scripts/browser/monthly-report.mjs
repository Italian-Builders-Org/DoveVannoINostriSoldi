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
    const main = document.querySelector("main");
    const mainStyle = getComputedStyle(main);
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
      headerWidth: document.querySelector("main article > header").getBoundingClientRect().width,
      primaryLinks: document.querySelectorAll("nav.primary-nav .nav-item > a").length,
      primaryLinkIcons: document.querySelectorAll("nav.primary-nav .nav-item > a svg").length,
      factUnits: [...document.querySelectorAll("main article > section strong > span:last-child")].map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return { text: node.textContent, lines: range.getClientRects().length };
      }),
      mainWidth: main.clientWidth - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
      figureWidths: figures.map((figure) => figure.getBoundingClientRect().width),
      detailsCount: details.length,
      captions: captions.map((caption) => caption.textContent?.trim()),
      rowCounts,
      currentLinks,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      openGraphType: document.querySelector('meta[property="og:type"]')?.getAttribute("content"),
      publishedOn: document.querySelector('meta[property="article:published_time"]')?.getAttribute("content"),
      author: document.querySelector('meta[name="author"]')?.getAttribute("content"),
      sourceLinksValid: [...document.querySelectorAll('main a[href^="#report-source-"]')].every((link) => document.getElementById(link.hash.slice(1))),
    };
  });

  assert.equal(state.h1Count, 1, `${label}: serve un solo h1`);
  assert.equal(state.h1, "Imprese e territori", `${label}: titolo inatteso`);
  assert.ok(state.bodyWidth <= state.clientWidth + 1, `${label}: overflow globale`);
  assert.ok(state.figureWidths.every((width) => width >= state.mainWidth * 0.95), `${label}: margini predefiniti restringono i grafici`);
  assert.ok(Math.abs(state.headerWidth - state.mainWidth) < 2, `${label}: intestazione e articolo disallineati`);
  assert.equal(state.primaryLinkIcons, state.primaryLinks, `${label}: icone incoerenti nei link primari`);
  assert.deepEqual(state.factUnits.map((unit) => unit.text), ["sedi di impresa", "miliardi €", "miliardi €"]);
  assert.ok(state.factUnits.every((unit) => unit.lines === 1), `${label}: unità spezzate nelle schede`);
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
  assert.equal(state.publishedOn, "2026-09-06", `${label}: data di pubblicazione errata`);
  assert.equal(state.openGraphType, "article", `${label}: Open Graph non è article`);
  assert.equal(state.author, "Redazione DVNS", `${label}: autore metadata errato`);
  assert.equal(state.sourceLinksValid, true, `${label}: riferimento a fonte assente`);

  const summaries = await page.$$("main figure details.chart-data > summary");
  for (const summary of summaries) {
    await summary.focus();
    assert.equal(
      await summary.evaluate((element) => document.activeElement === element),
      true,
      `${label}: summary non raggiungibile da tastiera`,
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (element) => element.closest("details")?.open === true,
      { timeout: 2_000 },
      summary,
    );
  }
  const labelLineCounts = await page.$$eval('main figure tbody th[scope="row"]', (cells) => cells.map((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    return range.getClientRects().length;
  }));
  assert.equal(labelLineCounts.length, 36, `${label}: etichette tabellari mancanti`);
  assert.ok(labelLineCounts.every((count) => count === 1), `${label}: nomi delle regioni spezzati nelle tabelle`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: tabelle aperte causano overflow globale`);

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
  for (const width of [390, 768, 1280]) {
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
