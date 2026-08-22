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

  if (route === "/palazzo-chigi") {
    assert.equal(shell.stats, 3, `${route}: la prima vista deve avere tre fatti`);
    await page.waitForSelector('figure [role="img"] svg');
    const evidence = await page.evaluate(() => {
      const chart = document.querySelector('figure [role="img"]');
      const tableRegion = document.querySelector(
        '[role="region"][aria-label="Valori esatti dei pagamenti PCM per missione"]',
      );
      tableRegion?.focus();
      return {
        activeTable: document.activeElement === tableRegion,
        rectangles: chart?.querySelectorAll("svg rect").length ?? 0,
        labels: chart
          ? [...chart.querySelectorAll("svg text")].filter(
              (node) => getComputedStyle(node).display !== "none",
            ).length
          : 0,
        rows: tableRegion?.querySelectorAll("tbody tr").length ?? 0,
        total: tableRegion?.querySelector("tfoot")?.textContent?.replace(/\s+/g, " ").trim(),
      };
    });
    assert.equal(evidence.activeTable, true, `${route}: tabella non focalizzabile`);
    assert.ok(evidence.rectangles >= 11, `${route}: treemap incompleto`);
    assert.equal(evidence.rows, 13, `${route}: tabella missioni incompleta`);
    assert.match(evidence.total ?? "", /Totale PCM.+100,0\s?%/, `${route}: totale tabella assente`);
    if (viewport.width <= 620) {
      assert.ok(evidence.labels <= 12, `${route}: troppe micro-label nel treemap mobile`);
    }
  } else {
    const evidence = await page.evaluate(() => ({
      metadataRows: document.querySelectorAll(
        '[aria-label="Copertura dei documenti contabili di Camera e Senato"] tbody tr',
      ).length,
      metadataStatuses: [...document.querySelectorAll("td")].filter((node) =>
        node.textContent?.includes("Solo metadati"),
      ).length,
    }));
    assert.equal(evidence.metadataRows, 2, `${route}: copertura Camera/Senato incompleta`);
    assert.equal(evidence.metadataStatuses, 2, `${route}: stato PDF non verificato assente`);
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
    ["/palazzo-chigi", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/palazzo-chigi", { width: 390, height: 844, deviceScaleFactor: 1 }],
    ["/parlamento", { width: 1440, height: 1000, deviceScaleFactor: 1 }],
    ["/parlamento", { width: 390, height: 844, deviceScaleFactor: 1 }],
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
  if (!closed && browserProcess?.exitCode === null) browserProcess.kill("SIGTERM");
}
