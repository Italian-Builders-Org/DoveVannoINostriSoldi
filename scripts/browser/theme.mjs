import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, installDiagnostics, launchBrowser, navigate } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const browser = await launchBrowser();
const selector = '[aria-label="Attiva modalità scura"], [aria-label="Attiva modalità chiara"]';
async function expectTheme(page, theme) {
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, {}, theme);
  const label = theme === "dark" ? "Attiva modalità chiara" : "Attiva modalità scura";
  await page.waitForSelector(`button[aria-label="${label}"]`);
}
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const diagnostics = installDiagnostics(page, { label: "Tema persistente", baseUrl });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await navigate(page, { url: new URL("/privacy", baseUrl).href, label: "Preferenza di sistema" });
  await expectTheme(page, "dark");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await expectTheme(page, "light");
  await page.focus(selector);
  await page.keyboard.press("Enter");
  await expectTheme(page, "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("theme")), "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectTheme(page, "dark");

  const second = await context.newPage();
  const secondDiagnostics = installDiagnostics(second, { label: "Tema fra schede", baseUrl });
  await navigate(second, { url: new URL("/termini", baseUrl).href, label: "Seconda scheda" });
  await expectTheme(second, "dark");
  await second.click(selector);
  await expectTheme(second, "light");
  await expectTheme(page, "light");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await expectTheme(page, "light");
  await page.bringToFront();
  await page.click('footer a[href="/metodologia"]');
  await page.waitForFunction(() => location.pathname === "/metodologia");
  await expectTheme(page, "light");
  await diagnostics.assertNoErrors();
  await secondDiagnostics.assertNoErrors();
  await context.close();

  const blockedContext = await browser.createBrowserContext();
  const blocked = await blockedContext.newPage();
  const blockedDiagnostics = installDiagnostics(blocked, { label: "Storage non disponibile", baseUrl });
  await blocked.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage bloccato", "SecurityError"); } });
  });
  await blocked.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await navigate(blocked, { url: new URL("/privacy", baseUrl).href, label: "Storage bloccato" });
  await expectTheme(blocked, "dark");
  await blocked.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await expectTheme(blocked, "light");
  await blocked.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await expectTheme(blocked, "dark");
  await blocked.click(selector);
  await expectTheme(blocked, "light");
  await blocked.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await blocked.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await expectTheme(blocked, "light");
  await blockedDiagnostics.assertNoErrors();
  await blockedContext.close();

  const quotaContext = await browser.createBrowserContext();
  const quota = await quotaContext.newPage();
  await quota.evaluateOnNewDocument(() => {
    localStorage.setItem("theme", "dark");
    Storage.prototype.setItem = () => { throw new DOMException("Quota esaurita", "QuotaExceededError"); };
  });
  await quota.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await navigate(quota, { url: new URL("/privacy", baseUrl).href, label: "Storage pieno" });
  await expectTheme(quota, "dark");
  await quota.click(selector);
  await expectTheme(quota, "light");
  await quota.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await quota.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await expectTheme(quota, "light");
  await quotaContext.close();

  // Senza i bundle React il tema deve già essere quello salvato: la scelta
  // avviene nel documento iniziale e non dipende dall'idratazione.
  const initialContext = await browser.createBrowserContext();
  const initial = await initialContext.newPage();
  await initial.evaluateOnNewDocument(() => localStorage.setItem("theme", "dark"));
  await initial.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await initial.setRequestInterception(true);
  initial.on("request", (request) => request.resourceType() === "script" ? request.abort() : request.continue());
  await initial.goto(new URL("/privacy", baseUrl).href, { waitUntil: "domcontentloaded" });
  assert.equal(await initial.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await initial.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
  await initialContext.close();
  console.log("PASS: tema prima dell'idratazione, sistema, tastiera, ricarica, navigazione, schede e storage bloccato.");
} finally {
  await closeBrowser(browser);
}
