import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const baseUrl = new URL(process.env.DVNS_BASE_URL ?? "http://127.0.0.1:3000");
const outputDir = path.resolve(process.env.DVNS_UI_PROOF_DIR ?? ".audit/institutional-ui");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    puppeteer.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates
    .filter((candidate) => typeof candidate === "string" && candidate.length > 0)
    .find((candidate) => existsSync(candidate));
}

async function inspect(page, route, viewport) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === baseUrl.origin) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  await page.setViewport(viewport);
  await page.setCacheEnabled(false);
  const response = await page.goto(new URL(route, baseUrl).toString(), {
    waitUntil: "networkidle0",
    timeout: 45_000,
  });
  assert.equal(response?.status(), 200, `${route}: risposta non valida`);
  await page.evaluate(() => document.fonts.ready);

  const shell = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    h1: [...document.querySelectorAll("h1")].map((node) => node.textContent?.trim()),
    stats: document.querySelectorAll(".stat-strip > div").length,
  }));
  assert.deepEqual(shell.h1.length, 1, `${route}: deve avere un solo h1`);
  assert.ok(shell.bodyWidth <= shell.clientWidth + 1, `${route}: overflow orizzontale globale`);
  assert.deepEqual(errors, [], `${route}: errori runtime o HTTP`);

  if (route === "/istituzioni") {
    const evidence = await page.evaluate(() => ({
      activeHub: document.querySelector('a[href="/istituzioni"][aria-current="page"]')?.textContent?.trim(),
      links: [...document.querySelectorAll("[data-institution-link]")].map((link) => link.getAttribute("href")),
    }));
    assert.equal(evidence.activeHub, "Istituzioni", `${route}: voce menu non attiva`);
    assert.deepEqual(evidence.links, ["/parlamento", "/palazzo-chigi", "/ministeri", "/regioni"]);
  } else if (route === "/palazzo-chigi") {
    assert.equal(shell.stats, 3, `${route}: la prima vista deve avere tre fatti`);
    await page.waitForSelector('figure [role="img"] svg');
    const evidence = await page.evaluate(() => {
      const chart = document.querySelector('figure [role="img"]');
      const tableRegion = document.querySelector(
        '[role="region"][aria-label="Valori esatti dei pagamenti PCM per missione"]',
      );
      tableRegion?.focus();
      const initialScrollLeft = tableRegion?.scrollLeft ?? 0;
      if (tableRegion) tableRegion.scrollLeft = tableRegion.scrollWidth;
      const result = {
        activeTable: document.activeElement === tableRegion,
        rectangles: chart?.querySelectorAll("svg rect").length ?? 0,
        labels: chart
          ? [...chart.querySelectorAll("svg text")].filter(
              (node) => getComputedStyle(node).display !== "none",
            ).length
          : 0,
        rows: tableRegion?.querySelectorAll("tbody tr").length ?? 0,
        scrollable: Boolean(
          tableRegion &&
          tableRegion.scrollWidth > tableRegion.clientWidth &&
          tableRegion.scrollLeft > initialScrollLeft,
        ),
        total: tableRegion?.querySelector("tfoot")?.textContent?.replace(/\s+/g, " ").trim(),
      };
      if (tableRegion) tableRegion.scrollLeft = initialScrollLeft;
      return result;
    });
    assert.equal(evidence.activeTable, true, `${route}: tabella non focalizzabile`);
    assert.ok(evidence.rectangles >= 11, `${route}: treemap incompleto`);
    assert.equal(evidence.rows, 13, `${route}: tabella missioni incompleta`);
    assert.match(evidence.total ?? "", /Totale PCM.+100,0\s?%/, `${route}: totale tabella assente`);
    if (viewport.width <= 620) {
      assert.ok(evidence.labels <= 12, `${route}: troppe micro-label nel treemap mobile`);
      assert.equal(evidence.scrollable, true, `${route}: tabella mobile non scorre`);
    }
  } else if (route === "/ministeri") {
    assert.equal(shell.stats, 3, `${route}: Totale CP, Pagato CP e Rimasto CP devono restare verificabili`);
    await page.waitForSelector('figure [role="img"] svg');
    const evidence = await page.evaluate(() => {
      const tableRegion = document.querySelector(
        '[role="region"][aria-label="Valori esatti dei Ministeri nel rendiconto RGS 2025"]',
      );
      tableRegion?.focus();
      const initialScrollLeft = tableRegion?.scrollLeft ?? 0;
      if (tableRegion) tableRegion.scrollLeft = tableRegion.scrollWidth;
      const result = {
        activeTable: document.activeElement === tableRegion,
        rectangles: document.querySelectorAll('figure [role="img"] svg rect').length,
        sections: document.querySelectorAll("[data-institutional-section]").length,
        totalCpHeaders: [...(tableRegion?.querySelectorAll("th") ?? [])]
          .filter((node) => node.textContent?.trim() === "Totale CP").length,
        rows: tableRegion?.querySelectorAll("tbody tr").length ?? 0,
        scrollable: Boolean(
          tableRegion &&
          tableRegion.scrollWidth > tableRegion.clientWidth &&
          tableRegion.scrollLeft > initialScrollLeft,
        ),
        total: tableRegion?.querySelector("tfoot")?.textContent?.replace(/\s+/g, " ").trim(),
      };
      if (tableRegion) tableRegion.scrollLeft = initialScrollLeft;
      return result;
    });
    assert.equal(evidence.activeTable, true, `${route}: tabella non focalizzabile`);
    assert.equal(evidence.rows, 15, `${route}: copertura dei Ministeri incompleta`);
    assert.equal(evidence.totalCpHeaders, 1, `${route}: fallback esatto Totale CP assente`);
    assert.ok(evidence.rectangles >= 15, `${route}: treemap Ministeri incompleto`);
    assert.equal(evidence.sections, 4, `${route}: devono esserci quattro sezioni verticali`);
    assert.match(evidence.total ?? "", /Totale dei 15 Ministeri/);
    if (viewport.width <= 620) {
      assert.equal(evidence.scrollable, true, `${route}: tabella mobile non scorre`);
    }
  } else if (route === "/regioni") {
    assert.equal(shell.stats, 3, `${route}: la prima vista deve avere tre fatti`);
    await page.waitForSelector('figure [role="img"] svg');
    const evidence = await page.evaluate(() => {
      const chart = document.querySelector('figure [role="img"]');
      const titleTable = document.querySelector(
        '[role="region"][aria-label^="Valori esatti degli impegni 2024"]',
      );
      const coverageTable = document.querySelector(
        '[role="region"][aria-label="Impegni esatti delle 22 amministrazioni regionali"]',
      );
      titleTable?.focus();
      const initialScrollLeft = titleTable?.scrollLeft ?? 0;
      if (titleTable) titleTable.scrollLeft = titleTable.scrollWidth;
      const result = {
        activeTable: document.activeElement === titleTable,
        coverageRows: coverageTable?.querySelectorAll("tbody tr").length ?? 0,
        rectangles: chart?.querySelectorAll("svg rect").length ?? 0,
        scrollable: Boolean(
          titleTable &&
          titleTable.scrollWidth > titleTable.clientWidth &&
          titleTable.scrollLeft > initialScrollLeft,
        ),
        titleRows: titleTable?.querySelectorAll("tbody tr").length ?? 0,
        total: titleTable?.querySelector("tfoot")?.textContent?.replace(/\s+/g, " ").trim(),
      };
      if (titleTable) titleTable.scrollLeft = initialScrollLeft;
      return result;
    });
    assert.equal(evidence.activeTable, true, `${route}: tabella Titoli non focalizzabile`);
    assert.equal(evidence.titleRows, 6, `${route}: Titoli incompleti`);
    assert.equal(evidence.coverageRows, 22, `${route}: copertura amministrazioni incompleta`);
    assert.ok(evidence.rectangles >= 5, `${route}: treemap incompleto`);
    assert.match(evidence.total ?? "", /Totale ufficiale.+100,0\s?%/);
    if (viewport.width <= 620) {
      assert.equal(evidence.scrollable, true, `${route}: tabella Titoli mobile non scorre`);
    }
  } else {
    const evidence = await page.evaluate(() => {
      const tableRegion = document.querySelector(
        '[role="region"][aria-label="Copertura dei documenti contabili di Camera e Senato"]',
      );
      tableRegion?.focus();
      const initialScrollLeft = tableRegion?.scrollLeft ?? 0;
      if (tableRegion) tableRegion.scrollLeft = tableRegion.scrollWidth;
      const result = {
        activeTable: document.activeElement === tableRegion,
        metadataRows: tableRegion?.querySelectorAll("tbody tr").length ?? 0,
        metadataStatuses: [...(tableRegion?.querySelectorAll("td") ?? [])].filter((node) =>
          node.textContent?.includes("Solo metadati"),
        ).length,
        scrollable: Boolean(
          tableRegion &&
          tableRegion.scrollWidth > tableRegion.clientWidth &&
          tableRegion.scrollLeft > initialScrollLeft,
        ),
      };
      if (tableRegion) tableRegion.scrollLeft = initialScrollLeft;
      return result;
    });
    assert.equal(evidence.activeTable, true, `${route}: tabella copertura non focalizzabile`);
    assert.equal(evidence.metadataRows, 2, `${route}: copertura Camera/Senato incompleta`);
    assert.equal(evidence.metadataStatuses, 2, `${route}: stato PDF non verificato assente`);
    if (viewport.width <= 620) {
      assert.equal(evidence.scrollable, true, `${route}: tabella copertura mobile non scorre`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const label = `${route.slice(1)}-${viewport.width}x${viewport.height}`;
  const screenshot = path.join(outputDir, `${label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  return { route, viewport, screenshot, errors: errors.length };
}

const executablePath = chromeExecutable();
if (!executablePath) throw new Error("Chrome/Chromium non disponibile");

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const scenarios = [
    ["/istituzioni", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/istituzioni", { width: 390, height: 844, deviceScaleFactor: 1 }],
    ["/palazzo-chigi", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/palazzo-chigi", { width: 390, height: 844, deviceScaleFactor: 1 }],
    ["/parlamento", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/parlamento", { width: 390, height: 844, deviceScaleFactor: 1 }],
    ["/ministeri", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/ministeri", { width: 390, height: 844, deviceScaleFactor: 1 }],
    ["/regioni", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/regioni", { width: 390, height: 844, deviceScaleFactor: 1 }],
  ];
  for (const [route, viewport] of scenarios) {
    const page = await browser.newPage();
    try {
      console.log(JSON.stringify(await inspect(page, route, viewport)));
    } finally {
      await page.close();
    }
  }
} finally {
  const browserProcess = browser.process();
  const closed = await Promise.race([browser.close().then(() => true), delay(3_000).then(() => false)]);
  if (!closed && browserProcess?.exitCode === null) {
    browserProcess.kill("SIGTERM");
    browserProcess.unref();
  }
}

process.exit(0);
