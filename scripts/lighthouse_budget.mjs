#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import lighthouse from "lighthouse";
import {
  closeBrowser,
  defaultBaseUrl,
  launchBrowser,
  resolveBrowserExecutable,
  waitForServer,
} from "./browser/harness.mjs";

const AUDIT_PATH = "/territori/irpef";
const REPORT_DIR = resolve(process.cwd(), ".lighthouseci");
const JSON_REPORT_PATH = resolve(REPORT_DIR, "irpef-lighthouse.json");
const HTML_REPORT_PATH = resolve(REPORT_DIR, "irpef-lighthouse.html");
const SUMMARY_REPORT_PATH = resolve(REPORT_DIR, "irpef-lighthouse-summary.json");
const LIGHTHOUSE_RUN_COUNT = 3;

function auditUrl() {
  return new URL(AUDIT_PATH, defaultBaseUrl()).toString();
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
  await waitForServer();

  const resolvedExecutablePath = resolveBrowserExecutable();
  const browser = await launchBrowser({
    executablePath: resolvedExecutablePath,
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
    await closeBrowser(browser);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
