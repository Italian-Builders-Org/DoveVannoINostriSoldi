import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { atlasTargets, clickText, hoverSeat, waitForAtlas } from "./politici-atlas-driver.mjs";
import "../ci/register-source-alias.mjs";
const {
  getRepubblicaMap,
  getRepubblicaLegislativeActs,
  getRepubblicaLegislativeSources,
} = await import("../../src/lib/politici-repubblica.ts");
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, waitForServer } from "./harness.mjs";

// Run against the real Next server. Only the final failure scenario intercepts API
// responses; the main scenarios reconcile the actual published roster and profile API.
const map = getRepubblicaMap();
const legislativeSources = getRepubblicaLegislativeSources();
const targets = atlasTargets(
  process.env.DVNS_POLITICI_URL ?? new URL("/politici", defaultBaseUrl()).href,
  process.env.DVNS_POLITICI_ALIAS_URL,
  "politici.dovevannoinostrisoldi.com",
);
const urls = targets.urls;
const output = path.join(defaultArtifactsDir(), "politici-atlas");
await mkdir(output, { recursive: true });
const results = [];
const browser = await launchBrowser({ extraArgs: targets.extraArgs });

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Overflow orizzontale del documento");
}

async function scenario(label, url, width, validate) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const consoleMessages = [];
  const hydrationWarnings = [];
  let phase = "navigation";
  let serverHtml = "";
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warn") return;
    const text = message.text();
    consoleMessages.push({ type: message.type(), text, location: message.location() });
    if (/hydrat|server rendered|validateDOMNesting|cannot be a descendant/i.test(text)) hydrationWarnings.push(text);
  });
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, hasTouch: width < 900, isMobile: width < 900 });
  page.setDefaultTimeout(15_000);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response?.ok(), `Pagina: HTTP ${response?.status()}`);
    serverHtml = await response.text();
    phase = "hydration";
    await waitForAtlas(page);
    assert.deepEqual(errors, [], "Errori JavaScript prima delle interazioni");
    assert.deepEqual(hydrationWarnings, [], "Errori di idratazione prima delle interazioni");
    phase = "interactions";
    await validate(page);
    await noOverflow(page);
    assert.deepEqual(errors, [], "Errori JavaScript");
    assert.deepEqual(hydrationWarnings, [], "Errori di idratazione");
    await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: false });
    results.push({ label, status: "pass", url, width });
    console.log(`PASS ${label}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${label}-failure.png`), fullPage: false }).catch(() => {});
    const clientHtml = await page.content().catch(() => "");
    await writeFile(path.join(output, `${label}-server.html`), serverHtml);
    await writeFile(path.join(output, `${label}-client.html`), clientHtml);
    await writeFile(path.join(output, `${label}-console.json`), JSON.stringify(consoleMessages, null, 2));
    results.push({ label, status: "fail", url, width, phase, error: String(error), pageErrors: errors, hydrationWarnings });
    console.error(`FAIL ${label}: ${error}`);
  } finally { await context.close(); }
}

try {
  for (const [siteIndex, url] of urls.entries()) {
    const parsed = new URL(url);
    assert.ok(["http:", "https:"].includes(parsed.protocol));
    if (url !== targets.localAlias) await waitForServer(parsed.origin, { readyPath: parsed.pathname });
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
        await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true });
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

  const legislators = ["camera", "senato"].map((chamberId) => map.people.find((item) => {
    if (item.chamberId !== chamberId) return false;
    const acts = getRepubblicaLegislativeActs(item.id);
    return (acts?.firstSigned.length ?? 0) > 0 && (acts?.voted.length ?? 0) > 0;
  }));
  assert.ok(legislators.every(Boolean), "Serve un parlamentare con firme e voti per ogni ramo");
  for (const legislator of legislators) for (const width of [390, 1280]) {
    await scenario(`legislative-acts-${legislator.chamberId}-${width}`, urls[0], width, async (page) => {
      await page.type('input[role="combobox"]', legislator.name);
      await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForSelector(`[data-profile-id="${legislator.id}"]`);
      await clickText(page, "Atti e voti");
      await page.waitForSelector(`[data-legislative-person="${legislator.id}"]`);
      const acts = getRepubblicaLegislativeActs(legislator.id);
      assert.equal(await page.$eval('[aria-label="Vista degli atti"] button[aria-pressed="true"]', (element) => element.textContent), "Votazioni finali");
      assert.equal(await page.$$eval("[data-act-id]", (elements) => elements.length), Math.min(8, acts.voted.length));
      assert.equal(await page.$eval("[data-act-id]", (element) => element.dataset.actId), acts.voted[0].id);
      if (legislator.chamberId === "senato") {
        const excluded = legislativeSources.senato.coverage.finalVotesExcluded.toLocaleString("it-IT");
        assert.equal(await page.$eval('[data-legislative-chamber="senato"]', (element, expected) => element.textContent.includes(`${expected} votazioni osservate su altri atti sono escluse`), excluded), true);
      }
      await page.click("[data-act-id] > summary");
      await page.waitForSelector("[data-act-id][open]");
      await page.type('[aria-label="Votazioni finali e proposte di legge"] input[type="search"]', "zzznontrovato98765");
      await page.waitForFunction(() => document.body.textContent.includes("Nessun atto corrisponde ai filtri"));
      await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Azzera ricerca negli atti")).click());
      await clickText(page, "Prima firma");
      assert.equal(await page.$$eval("[data-act-id]", (elements) => elements.length), Math.min(8, acts.firstSigned.length));
      await clickText(page, "Cofirme");
      assert.equal(await page.$$eval("[data-act-id]", (elements) => elements.length), Math.min(8, acts.coSigned.length));
    });
  }
  await scenario("rail-preview-and-persistence", urls[0], 1280, async (page) => {
    const selector = '[role="separator"][aria-label="Larghezza della scheda"]';
    await page.waitForSelector(selector);
    const initial = Number(await page.$eval(selector, (element) => element.getAttribute("aria-valuenow")));
    await page.focus(selector);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((selector, expected) => Number(document.querySelector(selector).getAttribute("aria-valuenow")) === expected, {}, selector, initial + 16);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAtlas(page);
    await page.waitForFunction((selector, expected) => Number(document.querySelector(selector)?.getAttribute("aria-valuenow")) === expected, {}, selector, initial + 16);
    const box = await (await page.$(selector)).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(Number(await page.$eval(selector, (element) => element.getAttribute("aria-valuenow"))), initial + 64);
    await page.focus(selector);
    await page.keyboard.press("End");
    await noOverflow(page);
    await page.click('[data-scope-button="camera"]');
    await hoverSeat(page);
    await page.waitForSelector('[role="tooltip"]');
    assert.equal(await page.$eval('[role="tooltip"]', (element) => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; }), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'));
    await page.focus(selector);
    await page.keyboard.press("Home");
    await noOverflow(page);
  });
  const person = map.people.find((item) => item.chamberId === "camera");
  await scenario("api-errors-retry-empty", urls[0], 390, async (page) => {
    let mode = "error";
    let initialFailures = 0;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/politici/profili" || /^\/api\/politici\/[^/]+\/news$/.test(pathname)) {
        const body = mode === "error" ? { ok: false, retry: false }
          : pathname.endsWith("/profili") ? { profiles: {} }
            : { ok: true, articles: [], connections: [], provider: null, observedAt: null };
        if (mode === "error") initialFailures++;
        void request.respond({ status: mode === "error" ? 503 : 200, contentType: "application/json", body: JSON.stringify(body) });
      } else void request.continue();
    });
    await page.type('input[role="combobox"]', person.name);
    await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-state="error"]');
    await page.waitForFunction(() => document.querySelector('[data-state="error"]'));
    const deadline = Date.now() + 5_000;
    while (initialFailures < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(initialFailures >= 2, "Both profile and news failures must precede retry");
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
