import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

// Shared Puppeteer lifecycle for the browser suites.
//
// Centralizes the parts that were previously duplicated and diverging across
// browser_e2e.mjs, integrated_editorial_browser.mjs and lighthouse_budget.mjs:
// browser executable resolution, launch/close, page lifecycle, viewport,
// HTTP server readiness, navigation, console/pageerror/requestfailed/HTTP
// diagnostics, and structured failure artifacts.

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ARTIFACTS_DIR = path.join(process.cwd(), "artifacts", "browser");
export const SERVER_TIMEOUT_MS = 60_000;
export const NAVIGATION_TIMEOUT_MS = 45_000;
export const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;
export const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

export function defaultBaseUrl() {
  return new URL(process.env.DVNS_BASE_URL ?? DEFAULT_BASE_URL);
}

export function defaultArtifactsDir() {
  return process.env.DVNS_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function closeBrowser(browser) {
  let timeout;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timeout durante la chiusura di Chromium.")),
          BROWSER_CLOSE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    const browserProcess = browser.process();
    if (browserProcess && !browserProcess.killed) browserProcess.kill("SIGKILL");
    console.warn(error instanceof Error ? error.message : String(error));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Merges the previously divergent executable resolution into one source of
// truth. Covers explicit env overrides, the Puppeteer-bundled Chrome, and the
// common macOS/Linux system locations. Returns undefined when nothing is found
// so the caller can surface Puppeteer's actionable install error.
export function resolveBrowserExecutable() {
  const configured = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
  ].filter(Boolean);
  const systemCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];
  let bundled;
  try {
    bundled = puppeteer.executablePath();
  } catch {
    // Puppeteer reports the actionable browser-install error if no candidate exists.
  }
  return [...configured, bundled, ...systemCandidates]
    .filter((candidate) => typeof candidate === "string" && candidate.length > 0)
    .find((candidate) => existsSync(candidate));
}

export async function launchBrowser({
  executablePath,
  headless = true,
  timeoutMs = BROWSER_LAUNCH_TIMEOUT_MS,
  extraArgs = [],
} = {}) {
  return puppeteer.launch({
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox", ...extraArgs],
    executablePath: executablePath ?? resolveBrowserExecutable(),
    headless,
    timeout: timeoutMs,
  });
}

function pageUrl(pathname, baseUrl) {
  return new URL(pathname, baseUrl).toString();
}

// HTTP readiness: polls a stable route instead of sleeping a fixed amount.
// Fails if the server returns non-2xx within the bounded timeout.
export async function waitForServer(
  baseUrl = defaultBaseUrl(),
  {
    timeoutMs = SERVER_TIMEOUT_MS,
    requestTimeoutMs = 3_000,
    readyPath = "/territori/irpef",
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(pageUrl(readyPath, baseUrl), {
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  const detail = lastError instanceof Error ? lastError.message : "errore sconosciuto";
  throw new Error(`Server non pronto entro ${timeoutMs / 1_000}s: ${detail}`);
}

// Filters request failures that are expected Next.js behaviour and do not
// affect the rendered route (cancelled speculative RSC prefetches and optional
// location lookups). Kept identical to the previous core-suite semantics.
function relevantRequestFailure(request) {
  const failure = request.failure();
  const resourceType = request.resourceType();
  const requestUrl = request.url();

  if (!failure || !/^https?:/i.test(requestUrl)) return null;

  const cancelledNextPrefetch =
    failure.errorText === "net::ERR_ABORTED" &&
    (resourceType === "fetch" || resourceType === "other") &&
    new URL(requestUrl).searchParams.has("_rsc");
  const cancelledLocationLookup =
    failure.errorText === "net::ERR_ABORTED" &&
    resourceType === "fetch" &&
    new URL(requestUrl).pathname === "/api/location";
  if (cancelledNextPrefetch || cancelledLocationLookup) return null;

  return `${resourceType} ${requestUrl}: ${failure.errorText}`;
}

// Installs console.error, pageerror, requestfailed and same-origin HTTP>=400
// collectors on the page. Returns a controller exposing `assertNoErrors` and
// `diagnostics` (structured snapshot for failure artifacts).
export function installDiagnostics(page, { label, baseUrl = defaultBaseUrl() } = {}) {
  const pageerrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];

  page.on("pageerror", (error) => {
    pageerrors.push(error instanceof Error ? error.message : String(error));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    const suffix = location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : "";
    consoleErrors.push(`${message.text()}${suffix}`);
  });
  page.on("requestfailed", (request) => {
    const failure = relevantRequestFailure(request);
    if (failure) requestFailures.push(failure);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const responseUrl = new URL(response.url());
    if (responseUrl.origin !== baseUrl.origin) return;
    httpErrors.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  function diagnostics() {
    return { pageerrors, consoleErrors, requestFailures, httpErrors };
  }

  async function assertNoErrors(isExpectedFailure = () => false) {
    await delay(150);
    const all = [
      ...pageerrors.map((entry) => `pageerror: ${entry}`),
      ...consoleErrors.map((entry) => `console.error: ${entry}`),
      ...requestFailures.map((entry) => `requestfailed: ${entry}`),
      ...httpErrors.map((entry) => entry),
    ];
    const unexpected = all.filter((failure) => !isExpectedFailure(failure));
    assert.deepEqual(
      unexpected,
      [],
      `${label}: errori browser:\n${unexpected.join("\n")}`,
    );
  }

  return { assertNoErrors, diagnostics };
}

export function scenarioIdFromLabel(label) {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Writes structured failure diagnostics under
// <artifactsDir>/<suite>/<scenarioId>/. Only invoked on failure, so a green
// run leaves no per-scenario artifacts behind.
export async function saveFailureArtifacts(
  page,
  {
    suite,
    scenarioId,
    label,
    requestedUrl,
    finalUrl,
    viewport,
    diagnostics,
    artifactsDir = defaultArtifactsDir(),
  },
) {
  const dir = path.join(artifactsDir, suite, scenarioId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }

  const payload = {
    scenario: scenarioId,
    label,
    requestedUrl,
    finalUrl,
    viewport,
    pageerrors: diagnostics.pageerrors,
    consoleErrors: diagnostics.consoleErrors,
    requestFailures: diagnostics.requestFailures,
    httpErrors: diagnostics.httpErrors,
  };

  try {
    if (!page.isClosed()) {
      await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true });
    }
  } catch {
    // A screenshot is best-effort; the diagnostics file is the source of truth.
  }

  writeFileSync(path.join(dir, "diagnostics.json"), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(path.join(dir, "console.log"), `${diagnostics.consoleErrors.join("\n")}\n`);
  writeFileSync(
    path.join(dir, "requests-failed.json"),
    `${JSON.stringify([...diagnostics.requestFailures, ...diagnostics.httpErrors], null, 2)}\n`,
  );
  return dir;
}

// Navigation readiness uses DOMContentLoaded + a specific selector + font
// readiness. It deliberately does NOT use networkidle as a universal readiness
// proof (PR1.8).
export async function navigate(
  page,
  {
    url,
    label,
    waitUntil = "domcontentloaded",
    readySelector = "main h1",
    timeoutMs = NAVIGATION_TIMEOUT_MS,
  },
) {
  const response = await page.goto(url, { timeout: timeoutMs, waitUntil });
  assert.ok(response, `${label}: navigazione senza risposta HTTP`);
  // 200 is the normal response; 304 is a valid conditional-GET cache hit
  // (Next.js returns it when the browser sends If-None-Match). Both are
  // successful navigations — 304 is not an error.
  const status = response.status();
  assert.ok(
    status === 200 || status === 304,
    `${label}: HTTP ${status}`,
  );
  if (readySelector) {
    await page.waitForSelector(readySelector, { visible: true, timeout: timeoutMs });
  }
  await page.evaluate(() => document.fonts.ready);
  return response;
}

// Creates a page with the shared viewport policy. Uses realistic browser cache
// (no global setCacheEnabled(false)) per PR1.9.
export async function createPage(browser, { width }) {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await page.setViewport({
    width,
    height: width <= 460 ? 844 : 900,
    deviceScaleFactor: 1,
    hasTouch: width <= 390,
    isMobile: width <= 390,
  });
  return page;
}

// Shared scenario lifecycle: create page, install diagnostics, navigate, run an
// optional afterNavigate hook, run the scenario validate, assert no browser
// errors, and on failure write structured artifacts before rethrowing.
export async function runScenario(
  browser,
  {
    label,
    pathname,
    width,
    validate,
    baseUrl = defaultBaseUrl(),
    artifactsDir = defaultArtifactsDir(),
    suite = "core",
    scenarioId,
    expectedFailure = () => false,
    waitUntil = "domcontentloaded",
    readySelector = "main h1",
    afterNavigate,
  },
) {
  const id = scenarioId ?? scenarioIdFromLabel(label);
  const page = await createPage(browser, { width });
  const { assertNoErrors, diagnostics } = installDiagnostics(page, { label, baseUrl });
  const requestedUrl = pageUrl(pathname, baseUrl);
  let thrown;

  try {
    await navigate(page, { url: requestedUrl, label, waitUntil, readySelector });
    if (afterNavigate) await afterNavigate(page, { label, width });
    await validate(page);
    await assertNoErrors(expectedFailure);
  } catch (error) {
    thrown = error;
    await saveFailureArtifacts(page, {
      suite,
      scenarioId: id,
      label,
      requestedUrl,
      finalUrl: page.url(),
      viewport: { width },
      diagnostics: diagnostics(),
      artifactsDir,
    });
  } finally {
    await page.close().catch(() => {});
  }

  if (thrown) throw thrown;
}
