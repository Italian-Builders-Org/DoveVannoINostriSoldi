import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeBrowser,
  createPage,
  defaultBaseUrl,
  delay,
  launchBrowser,
  navigate,
  saveFailureArtifacts,
  scenarioIdFromLabel,
  waitForServer,
} from "./harness.mjs";

const ROUTES = ["/", "/territori", "/dati", "/debito", "/imprese"];
const REPORT_ONLY_HEADER = "content-security-policy-report-only";
const ENFORCED_HEADER = "content-security-policy";
const CSP_CONSOLE_PATTERN = /content security policy/i;

const baseUrl = defaultBaseUrl();
let browser;

try {
  await waitForServer(baseUrl);
  browser = await launchBrowser({ extraArgs: ["--disable-extensions"] });

  for (const pathname of ROUTES) {
    const label = `CSP Report-Only ${pathname}`;
    const page = await createPage(browser, { width: 1280 });
    const consoleViolations = [];
    let eventViolations = [];

    page.on("console", (message) => {
      if (CSP_CONSOLE_PATTERN.test(message.text())) {
        consoleViolations.push(message.text());
      }
    });
    await page.evaluateOnNewDocument(() => {
      window.__dvnsCspViolations = [];
      window.addEventListener("securitypolicyviolation", (event) => {
        window.__dvnsCspViolations.push({
          blockedURI: event.blockedURI,
          disposition: event.disposition,
          effectiveDirective: event.effectiveDirective,
          lineNumber: event.lineNumber,
          columnNumber: event.columnNumber,
          sourceFile: event.sourceFile,
          violatedDirective: event.violatedDirective,
        });
      });
    });

    try {
      const response = await navigate(page, {
        url: new URL(pathname, baseUrl).href,
        label,
      });
      const headers = response.headers();
      assert.ok(headers[REPORT_ONLY_HEADER], `${label}: header Report-Only assente`);
      assert.equal(
        headers[ENFORCED_HEADER],
        undefined,
        `${label}: una CSP bloccante non deve essere pubblicata`,
      );

      // Capture afterInteractive scripts without waiting for an unbounded
      // network-idle state.
      await delay(1_000);
      eventViolations = await page.evaluate(() => window.__dvnsCspViolations ?? []);
      assert.deepEqual(
        { eventViolations, consoleViolations },
        { eventViolations: [], consoleViolations: [] },
        `${label}: violazioni CSP rilevate:\n${JSON.stringify(
          { eventViolations, consoleViolations },
          null,
          2,
        )}`,
      );
      console.log(`PASS ${pathname}`);
    } catch (error) {
      const artifactDir = await saveFailureArtifacts(page, {
        suite: "csp-report-only",
        scenarioId: scenarioIdFromLabel(label),
        label,
        requestedUrl: new URL(pathname, baseUrl).href,
        finalUrl: page.url(),
        viewport: { width: 1280 },
        diagnostics: {
          pageerrors: [],
          consoleErrors: consoleViolations,
          requestFailures: [],
          httpErrors: eventViolations.map((violation) => JSON.stringify(violation)),
        },
      });
      if (artifactDir) {
        await writeFile(
          path.join(artifactDir, "violations.json"),
          `${JSON.stringify({ eventViolations, consoleViolations }, null, 2)}\n`,
        );
      }
      throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  if (browser) await closeBrowser(browser);
}
