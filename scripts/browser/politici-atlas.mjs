import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import "../ci/register-source-alias.mjs";
const { getRepubblicaMap } = await import("../../src/lib/politici-repubblica.ts");
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, waitForServer } from "./harness.mjs";

// Run against the real Next server. Only the final failure scenario intercepts API
// responses; the main scenarios reconcile the actual published roster and profile API.
const map = getRepubblicaMap();
const urls = [process.env.DVNS_POLITICI_URL ?? new URL("/politici", defaultBaseUrl()).href,
  process.env.DVNS_POLITICI_ALIAS_URL].filter(Boolean);
const output = path.join(defaultArtifactsDir(), "politici-atlas");
await mkdir(output, { recursive: true });
const results = [];
const browser = await launchBrowser();

async function clickText(page, label) {
  const handle = await page.evaluateHandle((text) => [...document.querySelectorAll("button")]
    .find((element) => element.textContent.trim() === text && element.getClientRects().length), label);
  const element = handle.asElement();
  assert.ok(element, `Pulsante non trovato: ${label}`);
  try { await element.click(); } finally { await handle.dispose(); }
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Overflow orizzontale del documento");
}

async function scenario(label, url, width, validate) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, hasTouch: width < 900, isMobile: width < 900 });
  page.setDefaultTimeout(15_000);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response?.ok(), `Pagina: HTTP ${response?.status()}`);
    await page.waitForSelector("[data-politici-atlas]");
    await validate(page);
    await noOverflow(page);
    assert.deepEqual(errors, [], "Errori JavaScript");
    await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: false });
    results.push({ label, status: "pass", url, width });
    console.log(`PASS ${label}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${label}-failure.png`), fullPage: false }).catch(() => {});
    results.push({ label, status: "fail", url, width, error: String(error), pageErrors: errors });
    console.error(`FAIL ${label}: ${error}`);
  } finally { await context.close(); }
}

try {
  for (const [siteIndex, url] of urls.entries()) {
    const parsed = new URL(url);
    assert.ok(["http:", "https:"].includes(parsed.protocol));
    await waitForServer(parsed.origin, { readyPath: parsed.pathname });
    for (const width of [320, 390, 768, 1280, 1920]) {
      await scenario(`site-${siteIndex}-${width}`, url, width, async (page) => {
        await page.click('[data-scope-button="camera"]');
        await page.waitForSelector('[data-chamber="camera"]');
        assert.equal(await page.$$eval("[data-seat-person]", (items) => items.length), map.coverage.deputies);
        assert.equal(await page.$$eval('[data-seat-person][tabindex="0"]', (items) => items.length), 1);
        const before = page.url();
        await page.click('[data-scope-button="senato"]');
        await page.waitForSelector('[data-chamber="senato"]');
        assert.equal(await page.$$eval("[data-seat-person]", (items) => items.length), map.coverage.senators);
        await page.evaluate(() => history.back());
        await page.waitForSelector('[data-chamber="camera"]');
        assert.equal(page.url(), before, "Cronologia e selezione non sincronizzate");
        assert.equal(new URL(page.url()).origin, parsed.origin);
        assert.equal(new URL(page.url()).pathname, parsed.pathname);

        const person = map.people.find((item) => item.chamberId === "camera");
        await page.type('input[role="combobox"]', person.name);
        await page.waitForSelector('[role="listbox"] [role="option"]');
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await page.waitForSelector(`[data-profile-id="${person.id}"]`);
        await page.waitForSelector('[aria-label="Curriculum istituzionale"]');
        assert.equal(new URL(page.url()).searchParams.get("person"), person.id);
        if (width < 900) {
          await page.waitForSelector("dialog[open]");
          for (let step = 0; step < 20; step++) {
            await page.keyboard.press("Tab");
            assert.equal(await page.evaluate(() => document.querySelector("dialog[open]").contains(document.activeElement)), true);
          }
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.querySelector("dialog[open]"));
        }
        await clickText(page, "Elenco");
        await page.waitForSelector("[data-person-row]");
        await page.type('input[role="combobox"]', "zzzznessunapersona987654");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.body.textContent.includes("Nessuna persona corrisponde ai filtri"));
        await page.click('[aria-label="Cancella ricerca"]');
        await clickText(page, "Mappa");
        await page.waitForSelector('[data-chamber="camera"]');
        await page.click('[aria-label="Ingrandisci mappa"]');
        await noOverflow(page);
        await page.click('[aria-label="Ripristina ingrandimento"]');

        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        assert.equal(await page.$eval("[data-seat-person]", (element) => getComputedStyle(element).transitionDuration), "0s");
        const toggle = await page.$('[aria-label="Attiva modalità scura"]');
        if (toggle) await toggle.click();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
      });
    }
  }

  const person = map.people.find((item) => item.chamberId === "camera");
  await scenario("api-errors-retry-empty", urls[0], 390, async (page) => {
    let mode = "error";
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/politici/profili" || /^\/api\/politici\/[^/]+\/news$/.test(pathname)) {
        const body = mode === "error" ? { ok: false, retry: false }
          : pathname.endsWith("/profili") ? { profiles: {} }
            : { ok: true, articles: [], connections: [], provider: null, observedAt: null };
        void request.respond({ status: mode === "error" ? 503 : 200, contentType: "application/json", body: JSON.stringify(body) });
      } else void request.continue();
    });
    await page.type('input[role="combobox"]', person.name);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-state="error"]');
    mode = "empty";
    await clickText(page, "Riprova");
    await page.waitForFunction(() => document.body.textContent.includes("Scheda non presente nello snapshot"));
    await clickText(page, "Notizie");
    await page.waitForSelector('[data-state="error"]');
    await clickText(page, "Riprova");
    await page.waitForFunction(() => document.body.textContent.includes("Nessuna notizia"));
    assert.equal(await page.$eval("[data-profile-id]", (element) => element.dataset.profileId), person.id);
  });
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  await closeBrowser(browser);
}
if (results.some((item) => item.status === "fail")) process.exitCode = 1;
