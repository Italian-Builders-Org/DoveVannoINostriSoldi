#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";

import lighthouse from "lighthouse";
import puppeteer from "puppeteer";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const AUDIT_PATH = "/territori/irpef";
const SERVER_WAIT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 5_000;
const REPORT_DIR = resolve(process.cwd(), ".lighthouseci");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "irpef-lighthouse.json");
const HTML_REPORT_PATH = resolve(REPORT_DIR, "irpef-lighthouse.html");
const SUMMARY_REPORT_PATH = resolve(REPORT_DIR, "irpef-lighthouse-summary.json");
const LIGHTHOUSE_RUN_COUNT = 3;

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function auditUrl() {
  const baseUrl = new URL(process.env.DVNS_BASE_URL ?? DEFAULT_BASE_URL);

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("DVNS_BASE_URL deve usare il protocollo http o https.");
  }

  return new URL(AUDIT_PATH, baseUrl).toString();
}

async function waitForServer(url) {
  const deadline = Date.now() + SERVER_WAIT_MS;
  let lastError = "nessuna risposta";

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });

      if (response.ok) {
        await response.body?.cancel();
        return;
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }

    await sleep(500);
  }

  throw new Error(
    `Server non pronto dopo ${SERVER_WAIT_MS / 1_000}s (${lastError}): ${url}`,
  );
}

async function executablePath() {
  const environmentCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
  ];
  const platformCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "linux"
        ? [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ]
        : [];

  let bundledCandidate;
  try {
    bundledCandidate = puppeteer.executablePath();
  } catch {
    // Puppeteer reports the actionable browser-install error if no candidate exists.
  }

  for (const candidate of [
    ...environmentCandidates,
    bundledCandidate,
    ...platformCandidates,
  ]) {
    if (!candidate) continue;

    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next known Chrome/Chromium location.
    }
  }

  return undefined;
}

function categoryScore(lhr, id) {
  const score = lhr.categories[id]?.score;
  return typeof score === "number" ? score : null;
}

function auditValue(lhr, id) {
  const value = lhr.audits[id]?.numericValue;
  return typeof value === "number" ? value : null;
}

function formatScore(score) {
  return score === null ? "n/d" : `${Math.round(score * 100)}%`;
}

function formatMetric(value, unit) {
  if (value === null) return "n/d";
  if (unit === "ms") return `${Math.round(value)} ms`;
  return value.toFixed(3);
}

function measuredValues(lhr) {
  return {
    accessibility: categoryScore(lhr, "accessibility"),
    bestPractices: categoryScore(lhr, "best-practices"),
    seo: categoryScore(lhr, "seo"),
    performance: categoryScore(lhr, "performance"),
    cls: auditValue(lhr, "cumulative-layout-shift"),
    lcp: auditValue(lhr, "largest-contentful-paint"),
    fcp: auditValue(lhr, "first-contentful-paint"),
    tbt: auditValue(lhr, "total-blocking-time"),
  };
}

function median(values) {
  if (values.some((value) => value === null)) return null;

  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianMetricValues(runs) {
  const keys = Object.keys(runs[0]);
  return Object.fromEntries(keys.map((key) => [key, median(runs.map((run) => run[key]))]));
}

function evaluate(values) {
  const errors = [];

  const requireMinimum = (value, threshold, label) => {
    const message =
      value === null
        ? `${label}: metrica assente`
        : `${label}: ${formatScore(value)} (soglia ${Math.round(threshold * 100)}%)`;
    if (value === null || value < threshold) errors.push(message);
  };
  const requireMaximum = (value, threshold, label, unit) => {
    const message =
      value === null
        ? `${label}: metrica assente`
        : `${label}: ${formatMetric(value, unit)} (soglia ${formatMetric(threshold, unit)})`;
    if (value === null || value > threshold) errors.push(message);
  };

  requireMinimum(values.accessibility, 0.95, "Accessibility");
  requireMinimum(values.bestPractices, 0.9, "Best practices");
  requireMinimum(values.seo, 0.9, "SEO");
  requireMaximum(values.cls, 0.1, "CLS", "unitless");
  requireMinimum(values.performance, 0.75, "Performance");
  requireMaximum(values.lcp, 4_000, "LCP", "ms");
  requireMaximum(values.fcp, 3_000, "FCP", "ms");
  requireMaximum(values.tbt, 300, "TBT", "ms");

  return { errors, values };
}

function printResults(values, errors) {
  console.log("\nLighthouse category scores");
  console.table([
    { categoria: "Performance", punteggio: formatScore(values.performance) },
    { categoria: "Accessibility", punteggio: formatScore(values.accessibility) },
    { categoria: "Best practices", punteggio: formatScore(values.bestPractices) },
    { categoria: "SEO", punteggio: formatScore(values.seo) },
  ]);

  console.log("Metriche lab (proxy CWV)");
  console.table([
    { metrica: "CLS", valore: formatMetric(values.cls, "unitless") },
    { metrica: "LCP", valore: formatMetric(values.lcp, "ms") },
    { metrica: "FCP", valore: formatMetric(values.fcp, "ms") },
    { metrica: "TBT", valore: formatMetric(values.tbt, "ms") },
  ]);

  for (const error of errors) console.error(`ERROR: ${error}`);

  if (errors.length === 0) {
    console.log("PASS: tutte le soglie bloccanti sono rispettate.");
  }
}

async function main() {
  const url = auditUrl();
  console.log(`Attendo ${url}`);
  await waitForServer(url);

  const resolvedExecutablePath = await executablePath();
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    executablePath: resolvedExecutablePath,
    headless: true,
  });

  try {
    const debuggingEndpoint = new URL(browser.wsEndpoint());
    const port = Number(debuggingEndpoint.port);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Porta CDP non valida: ${debuggingEndpoint.port}`);
    }

    const runs = [];
    for (let runNumber = 1; runNumber <= LIGHTHOUSE_RUN_COUNT; runNumber += 1) {
      console.log(`Lighthouse run ${runNumber}/${LIGHTHOUSE_RUN_COUNT}`);
      const runnerResult = await lighthouse(url, {
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        output: "html",
        port,
      });
      if (!runnerResult) throw new Error("Lighthouse non ha restituito un report.");

      const htmlReport = Array.isArray(runnerResult.report)
        ? runnerResult.report[0]
        : runnerResult.report;
      if (typeof htmlReport !== "string") {
        throw new Error("Il report HTML di Lighthouse non è disponibile.");
      }

      runs.push({
        htmlReport,
        lhr: runnerResult.lhr,
        values: measuredValues(runnerResult.lhr),
      });
    }

    await mkdir(REPORT_DIR, { recursive: true });
    const values = medianMetricValues(runs.map((run) => run.values));
    const representativeRun = [...runs].sort(
      (left, right) =>
        (left.values.tbt ?? Number.POSITIVE_INFINITY) -
        (right.values.tbt ?? Number.POSITIVE_INFINITY),
    )[Math.floor(runs.length / 2)];
    const runReports = runs.flatMap((run, index) => [
      writeFile(
        resolve(REPORT_DIR, `irpef-lighthouse-run-${index + 1}.json`),
        `${JSON.stringify(run.lhr, null, 2)}\n`,
      ),
      writeFile(
        resolve(REPORT_DIR, `irpef-lighthouse-run-${index + 1}.html`),
        run.htmlReport,
      ),
    ]);
    await Promise.all([
      ...runReports,
      writeFile(JSON_REPORT_PATH, `${JSON.stringify(representativeRun.lhr, null, 2)}\n`),
      writeFile(HTML_REPORT_PATH, representativeRun.htmlReport),
      writeFile(
        SUMMARY_REPORT_PATH,
        `${JSON.stringify({ runCount: LIGHTHOUSE_RUN_COUNT, values, runs: runs.map((run) => run.values) }, null, 2)}\n`,
      ),
    ]);

    const { errors } = evaluate(values);
    printResults(values, errors);
    console.log(`Valori bloccanti: mediana di ${LIGHTHOUSE_RUN_COUNT} run.`);
    console.log(`Report JSON: ${JSON_REPORT_PATH}`);
    console.log(`Report HTML: ${HTML_REPORT_PATH}`);
    console.log(`Riepilogo run: ${SUMMARY_REPORT_PATH}`);

    if (errors.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
