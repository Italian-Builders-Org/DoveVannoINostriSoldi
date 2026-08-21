import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

const baseUrl = new URL(process.env.DVNS_BASE_URL ?? "http://127.0.0.1:3000");
const SERVER_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 45_000;
const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;
const TABLE_REGION = '[role="region"][aria-label="Redditi e variabili IRPEF per territorio"]';
const ACTIVE_LEVEL = 'nav[aria-label="Livello territoriale"] a[aria-current="page"]';
const INFO_TOOLTIP_IDS = ["cash-payments-tip", "spending-glossary-tip"];

if (!/^https?:$/.test(baseUrl.protocol)) {
  throw new Error("DVNS_BASE_URL deve usare il protocollo HTTP oppure HTTPS.");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pageUrl(pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(pageUrl("/territori/irpef"), {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  const detail = lastError instanceof Error ? lastError.message : "errore sconosciuto";
  throw new Error(`Server non pronto entro ${SERVER_TIMEOUT_MS / 1_000}s: ${detail}`);
}

function chromeExecutable() {
  const configured = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ].filter(Boolean);
  const systemCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  let bundled;

  try {
    bundled = puppeteer.executablePath();
  } catch {
    // Puppeteer can be installed with its browser download disabled in CI.
  }

  return [...configured, bundled, ...systemCandidates]
    .filter((candidate) => typeof candidate === "string" && candidate.length > 0)
    .find((candidate) => existsSync(candidate));
}

function relevantRequestFailure(request) {
  const failure = request.failure();
  const resourceType = request.resourceType();
  const requestUrl = request.url();

  if (!failure || !/^https?:/i.test(requestUrl)) return null;

  // Next may cancel speculative RSC prefetches without affecting the rendered page.
  const cancelledNextPrefetch =
    failure.errorText === "net::ERR_ABORTED" &&
    (resourceType === "fetch" || resourceType === "other") &&
    new URL(requestUrl).searchParams.has("_rsc");
  const cancelledLocationLookup =
    failure.errorText === "net::ERR_ABORTED" &&
    resourceType === "fetch" &&
    new URL(requestUrl).pathname === "/api/location";
  // Location is an optional client hint and can be cancelled when a scenario
  // closes its page; neither cancellation affects the rendered route.
  if (cancelledNextPrefetch || cancelledLocationLookup) return null;

  return `${resourceType} ${requestUrl}: ${failure.errorText}`;
}

function installDiagnostics(page, label) {
  const failures = [];

  page.on("pageerror", (error) => {
    failures.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    const suffix = location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : "";
    failures.push(`console.error: ${message.text()}${suffix}`);
  });
  page.on("requestfailed", (request) => {
    const failure = relevantRequestFailure(request);
    if (failure) failures.push(`requestfailed: ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const responseUrl = new URL(response.url());
    if (responseUrl.origin !== baseUrl.origin) return;
    failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  return async function assertNoBrowserErrors() {
    await delay(150);
    assert.deepEqual(failures, [], `${label}: errori browser:\n${failures.join("\n")}`);
  };
}

async function saveFailureScreenshot(page, label) {
  if (page.isClosed()) return null;
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const screenshotPath = path.join(tmpdir(), `dvns-browser-e2e-${safeLabel}-${Date.now()}.png`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch {
    return null;
  }
}

async function viewportState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const main = document.querySelector("main");
    const mainRect = main?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;

    return {
      bodyScrollWidth: body.scrollWidth,
      clientWidth: root.clientWidth,
      h1Count: document.querySelectorAll("h1").length,
      innerWidth,
      mainVisible: Boolean(
        main &&
        mainRect &&
        mainRect.width > 0 &&
        mainRect.height > 0 &&
        mainStyle?.display !== "none" &&
        mainStyle?.visibility !== "hidden",
      ),
      rootScrollWidth: root.scrollWidth,
    };
  });
}

async function assertResponsiveShell(page, label, width) {
  const state = await viewportState(page);
  assert.equal(state.innerWidth, width, `${label}: viewport inatteso`);
  assert.equal(state.h1Count, 1, `${label}: deve esserci un solo h1`);
  assert.equal(state.mainVisible, true, `${label}: il contenuto principale non è visibile`);
  assert.ok(
    state.rootScrollWidth <= state.clientWidth + 1,
    `${label}: overflow globale ${state.rootScrollWidth}px > ${state.clientWidth}px`,
  );
  assert.ok(
    state.bodyScrollWidth <= state.clientWidth + 1,
    `${label}: overflow del body ${state.bodyScrollWidth}px > ${state.clientWidth}px`,
  );
}

async function assertInfoTooltips(page, label) {
  for (const tooltipId of INFO_TOOLTIP_IDS) {
    const selector = `button[aria-controls="${tooltipId}"]`;
    const button = await page.$(selector);
    assert.ok(button, `${label}: trigger ${tooltipId} assente`);

    await button.focus();
    await page.waitForFunction(
      (id) => {
        const tooltip = document.getElementById(id);
        if (
          tooltip?.getAttribute("data-open") !== "true" ||
          tooltip.getAttribute("data-positioned") !== "true" ||
          getComputedStyle(tooltip).display === "none"
        ) {
          return false;
        }
        const rect = tooltip.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      },
      { timeout: 2_000 },
      tooltipId,
    );

    const openState = await page.$eval(selector, (trigger, id) => {
      const tooltip = document.getElementById(id);
      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip?.getBoundingClientRect();
      return {
        describedBy: trigger.getAttribute("aria-describedby"),
        expanded: trigger.getAttribute("aria-expanded"),
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        triggerRect: {
          left: triggerRect.left,
          right: triggerRect.right,
        },
        tooltipDisplay: tooltip ? getComputedStyle(tooltip).display : "missing",
        tooltipVisibility: tooltip ? getComputedStyle(tooltip).visibility : "missing",
        tooltipRect: tooltipRect
          ? {
              left: tooltipRect.left,
              right: tooltipRect.right,
              width: tooltipRect.width,
            }
          : null,
      };
    }, tooltipId);

    assert.equal(openState.expanded, "true", `${label}: ${tooltipId} non risulta aperto`);
    assert.equal(openState.describedBy, tooltipId, `${label}: descrizione ARIA assente`);
    assert.equal(openState.tooltipDisplay, "block", `${label}: tooltip non visibile`);
    assert.equal(openState.tooltipVisibility, "visible", `${label}: tooltip invisibile`);
    assert.ok(openState.tooltipRect, `${label}: rettangolo tooltip assente`);
    assert.ok(openState.tooltipRect.width > 0, `${label}: tooltip senza larghezza`);
    assert.ok(openState.tooltipRect.left >= -1, `${label}: tooltip ${tooltipId} esce a sinistra`);
    assert.ok(
      openState.tooltipRect.right <= openState.innerWidth + 1,
      `${label}: tooltip ${tooltipId} esce a destra`,
    );
    assert.ok(openState.triggerRect.left >= -1, `${label}: trigger ${tooltipId} esce a sinistra`);
    assert.ok(
      openState.triggerRect.right <= openState.innerWidth + 1,
      `${label}: trigger ${tooltipId} esce a destra`,
    );
    assert.ok(
      openState.bodyScrollWidth <= openState.clientWidth + 1,
      `${label}: overflow mentre ${tooltipId} è aperto`,
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      (id) => document.getElementById(id)?.getAttribute("data-open") === "false",
      { timeout: 2_000 },
      tooltipId,
    );
    const closedState = await page.$eval(selector, (trigger) => ({
      describedBy: trigger.getAttribute("aria-describedby"),
      expanded: trigger.getAttribute("aria-expanded"),
    }));
    assert.equal(closedState.expanded, "false", `${label}: Escape non chiude ${tooltipId}`);
    assert.equal(closedState.describedBy, null, `${label}: descrizione chiusa ancora esposta`);
    await button.dispose();
  }
}

async function assertRegionalMapSelection(page, label) {
  const mapSelector = '[data-region-map="true"]';
  const detailSelector = '[data-region-detail="true"] b';
  await page.waitForSelector(mapSelector, { visible: true });
  const regionPaths = await page.$$(
    `${mapSelector} path[role="button"][aria-label]`,
  );
  assert.equal(regionPaths.length, 20, `${label}: la mappa deve esporre 20 regioni`);

  const lombardia = await page.$(`${mapSelector} path[aria-label^="Lombardia:"]`);
  const veneto = await page.$(`${mapSelector} path[aria-label^="Veneto:"]`);
  assert.ok(lombardia, `${label}: percorso Lombardia assente`);
  assert.ok(veneto, `${label}: percorso Veneto assente`);

  await lombardia.hover();
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(`${selector} path[data-hovered="true"]`)),
    { timeout: 2_000 },
    mapSelector,
  );
  const previewName = await page.$eval(detailSelector, (element) => element.textContent?.trim());
  assert.equal(previewName, "Lombardia", `${label}: hover non aggiorna l’anteprima`);

  const hoveredOutline = await page.$eval(mapSelector, (map) => {
    const outlines = [...map.querySelectorAll('path[aria-hidden="true"]')];
    return {
      outlineCount: outlines.length,
      overlayStroke: outlines.map((outline) => getComputedStyle(outline).stroke),
      overlayPointerEvents: outlines.map((outline) => getComputedStyle(outline).pointerEvents),
    };
  });
  assert.ok(
    hoveredOutline.outlineCount >= 1 && hoveredOutline.outlineCount <= 2,
    `${label}: numero inatteso di layer di contorno (${hoveredOutline.outlineCount})`,
  );
  assert.ok(
    hoveredOutline.overlayStroke.every((stroke) => stroke !== "none"),
    `${label}: contorno overlay non visibile`,
  );
  assert.ok(
    hoveredOutline.overlayPointerEvents.every((value) => value === "none"),
    `${label}: il contorno overlay intercetta il puntatore`,
  );

  await lombardia.click();
  await page.waitForFunction(
    () => document.querySelector('[data-region-detail="true"] b')?.textContent?.trim() === "Lombardia",
    { timeout: 2_000 },
  );
  const fixedName = await page.$eval(detailSelector, (element) => element.textContent?.trim());

  await veneto.hover();
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(`${selector} path[data-hovered="true"]`)),
    { timeout: 2_000 },
    mapSelector,
  );
  const afterHoverName = await page.$eval(detailSelector, (element) => element.textContent?.trim());
  assert.equal(
    afterHoverName,
    fixedName,
    `${label}: l’hover sovrascrive la regione fissata con un clic`,
  );

  await veneto.click();
  await page.waitForFunction(
    () => document.querySelector('[data-region-detail="true"] b')?.textContent?.trim() === "Veneto",
    { timeout: 2_000 },
  );
  const switchedName = await page.$eval(detailSelector, (element) => element.textContent?.trim());
  assert.equal(switchedName, "Veneto", `${label}: il clic non cambia la selezione fissata`);

  await lombardia.dispose();
  await veneto.dispose();
  for (const path of regionPaths) await path.dispose();
}

async function assertTableKeyboardScroll(page, label) {
  await page.waitForSelector(TABLE_REGION, { visible: true });
  const tableState = await page.$eval(TABLE_REGION, (region) => ({
    clientWidth: region.clientWidth,
    hasTable: Boolean(region.querySelector("table")),
    scrollWidth: region.scrollWidth,
    tabIndex: region.tabIndex,
  }));
  assert.equal(tableState.hasTable, true, `${label}: tabella assente`);
  assert.equal(tableState.tabIndex, 0, `${label}: regione tabella non raggiungibile da tastiera`);
  assert.ok(
    tableState.scrollWidth > tableState.clientWidth,
    `${label}: la tabella non espone lo scroll orizzontale atteso`,
  );

  await page.$eval(TABLE_REGION, (region) => region.scrollTo({ left: 0, behavior: "auto" }));
  await page.focus(TABLE_REGION);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.scrollLeft > 0,
    { timeout: 2_000 },
    TABLE_REGION,
  );

  await page.keyboard.press("End");
  await page.waitForFunction(
    (selector) => {
      const region = document.querySelector(selector);
      return region && region.scrollLeft >= region.scrollWidth - region.clientWidth - 1;
    },
    { timeout: 2_000 },
    TABLE_REGION,
  );

  await page.keyboard.press("Home");
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.scrollLeft === 0,
    { timeout: 2_000 },
    TABLE_REGION,
  );
}

async function bodyText(page) {
  return page.$eval("body", (body) => body.innerText);
}

function assertTextMatches(text, pattern, label) {
  assert.ok(pattern.test(text), `${label}: testo atteso ${pattern} assente`);
}

async function activeLevel(page) {
  return page.$eval(ACTIVE_LEVEL, (link) => link.textContent?.trim());
}

async function navigate(page, pathname, label) {
  const response = await page.goto(pageUrl(pathname), {
    timeout: NAVIGATION_TIMEOUT_MS,
    waitUntil: "domcontentloaded",
  });
  assert.ok(response, `${label}: navigazione senza risposta HTTP`);
  assert.equal(response.status(), 200, `${label}: HTTP ${response.status()}`);
  await page.waitForSelector("main h1", { visible: true, timeout: NAVIGATION_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForNetworkIdle({ idleTime: 350, timeout: 10_000 });
}

async function runScenario(browser, { label, pathname, validate, width }) {
  const page = await browser.newPage();
  let thrown;

  try {
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.setCacheEnabled(false);
    await page.setViewport({
      width,
      height: width <= 460 ? 844 : 900,
      deviceScaleFactor: 1,
      hasTouch: width <= 390,
      isMobile: width <= 390,
    });
    const assertNoBrowserErrors = installDiagnostics(page, label);
    await navigate(page, pathname, label);
    await assertResponsiveShell(page, label, width);
    await validate(page);
    await assertNoBrowserErrors();
  } catch (error) {
    thrown = error;
    const screenshot = await saveFailureScreenshot(page, label);
    if (screenshot) {
      console.error(`${label}: screenshot diagnostico ${screenshot}`);
    }
  } finally {
    await page.close().catch(() => {});
  }

  if (thrown) throw thrown;
}

await waitForServer();

const executablePath = chromeExecutable();
let browser;
const completed = [];

try {
  browser = await puppeteer.launch({
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"],
    executablePath,
    headless: true,
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
  });

  for (const width of [320, 390, 768, 1280]) {
    const label = `IRPEF ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/territori/irpef",
      width,
      validate: async (page) => {
        assert.equal(await activeLevel(page), "Regioni", `${label}: tab Regioni non attivo`);
        await assertTableKeyboardScroll(page, label);
      },
    });
    completed.push(label);
  }

  await runScenario(browser, {
    label: "Comuni senza filtro",
    pathname: "/territori/irpef?anno=2024&livello=comune",
    width: 390,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      assert.equal(await page.$(TABLE_REGION), null, "Non deve caricare una tabella comunale senza filtro");
      assert.ok(await page.$('select[name="regione"]'), "Filtro Regione assente");
      assert.ok(await page.$('input[name="provincia"]'), "Filtro Provincia assente");
      assert.ok(await page.$('input[name="q"]'), "Ricerca Comune assente");
      assert.equal(await page.$('[role="alert"]'), null, "Warning inatteso nello stato preparatorio");
      const text = await bodyText(page);
      assertTextMatches(text, /Indica almeno un filtro per caricare i Comuni\./, "Comuni senza filtro");
      assertTextMatches(
        text,
        /Scegli una Regione, una Provincia o inserisci il nome di un Comune\./,
        "Comuni senza filtro",
      );
    },
  });
  completed.push("Comuni senza filtro");

  await runScenario(browser, {
    label: "Ricerca Roma",
    pathname: "/territori/irpef?anno=2024&livello=comune&q=Roma",
    width: 390,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      await assertTableKeyboardScroll(page, "Ricerca Roma");
      const text = await bodyText(page);
      assertTextMatches(text, /Risultati da 1 a 42 su 42\./, "Ricerca Roma");
      assertTextMatches(text, /\bRoma\b/i, "Ricerca Roma");
      assert.equal(await page.$('[role="alert"]'), null, "Warning inatteso nella ricerca Roma");
    },
  });
  completed.push("Ricerca Roma");

  await runScenario(browser, {
    label: "Deep-link Veneto",
    pathname: "/territori/irpef?anno=2024&livello=comune&regione=Veneto",
    width: 768,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      const region = await page.$eval('select[name="regione"]', (select) => ({
        label: select.selectedOptions[0]?.textContent?.trim(),
        value: select.value,
      }));
      assert.deepEqual(region, { label: "Veneto", value: "05" });
      assertTextMatches(await bodyText(page), /Risultati da 1 a 50 su 560\./, "Deep-link Veneto");
      await assertTableKeyboardScroll(page, "Deep-link Veneto");
    },
  });
  completed.push("Deep-link Veneto");

  await runScenario(browser, {
    label: "Balme oscurato",
    pathname: "/territori/irpef?anno=2024&livello=comune&q=Balme",
    width: 390,
    validate: async (page) => {
      assert.equal(await activeLevel(page), "Comuni");
      const rows = await page.$$("tbody tr");
      assert.equal(rows.length, 1, "Balme deve produrre una sola riga");
      const text = await bodyText(page);
      assertTextMatches(text, /\bBalme\b/, "Balme oscurato");
      assertTextMatches(text, /≥/, "Balme oscurato");
      assertTextMatches(text, /1 riga oscurata/, "Balme oscurato");
      assert.ok(await page.$("tbody em"), "Indicatore di oscuramento assente");
      await assertTableKeyboardScroll(page, "Balme oscurato");
    },
  });
  completed.push("Balme oscurato");

  await runScenario(browser, {
    label: "Recovery offset",
    pathname: "/territori/irpef?anno=2024&livello=comune&q=Roma&offset=1000",
    width: 390,
    validate: async (page) => {
      const alertText = await page.$eval('[role="alert"]', (alert) => alert.textContent ?? "");
      assert.match(alertText, /Pagina non disponibile/);
      assert.match(alertText, /La pagina richiesta non esiste\./);
      assert.match(alertText, /Sono mostrati i primi risultati della stessa ricerca\./);
      assertTextMatches(await bodyText(page), /Risultati da 1 a 42 su 42\./, "Recovery offset");
      await assertTableKeyboardScroll(page, "Recovery offset");
    },
  });
  completed.push("Recovery offset");

  for (const width of [390, 1280]) {
    const label = `Geografia Comuni ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/territori?anno=2025",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /I 20 Comuni con più pagamenti per abitante/i, label);
        const firstMunicipality = await page.$eval(
          '[data-municipality-ranking="per-capita"] tbody tr:first-child th',
          (heading) => ({
            name: [...heading.childNodes]
              .find((node) => node.nodeType === Node.TEXT_NODE)
              ?.textContent?.trim(),
            context: [...heading.querySelectorAll("small")].map((item) => item.textContent?.trim()),
          }),
        );
        assert.match(firstMunicipality.name ?? "", /\S/);
        assert.match(firstMunicipality.context[0] ?? "", /^\S.* · \S.*$/);
        assert.match(firstMunicipality.context[1] ?? "", /abitanti$/);
        await assertResponsiveShell(page, label, width);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Parlamento previdenza ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/parlamento",
      width,
      validate: async (page) => {
        const text = await bodyText(page);
        assertTextMatches(text, /Spese previdenziali/, label);
        assertTextMatches(text, /Deputati cessati dal mandato/, label);
        assertTextMatches(text, /Personale in quiescenza/, label);
        assertTextMatches(text, /non equivale ai soli vitalizi/i, label);
        await assertResponsiveShell(page, label, width);
      },
    });
    completed.push(label);
  }

  for (const width of [320, 390, 768, 901, 1024, 1280]) {
    const label = `Tooltip home ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => {
        await assertInfoTooltips(page, label);
      },
    });
    completed.push(label);
  }

  for (const width of [390, 1280]) {
    const label = `Mappa regioni hover/selezione ${width}px`;
    await runScenario(browser, {
      label,
      pathname: "/",
      width,
      validate: async (page) => {
        await assertRegionalMapSelection(page, label);
      },
    });
    completed.push(label);
  }

  for (const pathname of ["/", "/enti", "/partecipazioni", "/controlli", "/metodologia"]) {
    const label = `Shell 320px ${pathname}`;
    await runScenario(browser, {
      label,
      pathname,
      width: 320,
      validate: async () => {},
    });
    completed.push(label);
  }

  console.log(JSON.stringify({
    baseUrl: baseUrl.origin,
    checks: completed,
    ok: true,
  }));
} finally {
  await browser?.close().catch(() => {});
}
