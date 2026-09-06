#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer";

const mode = process.argv[2];
const feature = process.argv[3];
const baseUrl = new URL(process.env.DVNS_BASE_URL ?? "http://127.0.0.1:43173");
const evidenceRoot = resolve(
  process.env.DVNS_VERIFY_EVIDENCE_DIR ?? ".verification-artifacts/dvns-integrated-sources/manual",
);
const viewportMode = process.env.DVNS_VERIFY_VIEWPORT ?? "desktop";
const viewports = {
  desktop: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1 },
};
const viewport = viewports[viewportMode];
const requestTimeoutMs = 10_000;
const browserCloseTimeoutMs = 5_000;

if (!/^https?:$/.test(baseUrl.protocol)) {
  throw new Error("DVNS_BASE_URL deve usare HTTP o HTTPS.");
}
if (!viewport) {
  throw new Error("DVNS_VERIFY_VIEWPORT deve essere desktop oppure mobile.");
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function closeBrowser(browser) {
  let timeout;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timeout durante la chiusura di Chromium.")),
          browserCloseTimeoutMs,
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

async function request(pathname) {
  const response = await fetch(url(pathname), {
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  assert.equal(response.ok, true, `${pathname}: HTTP ${response.status}`);
  return response;
}

async function doctor() {
  const [coverageResponse, datasetResponse, rgsResponse] = await Promise.all([
    request("/fonti/copertura"),
    request("/api/dati/consulenze-legali?limit=1"),
    request("/spese/consulenze"),
  ]);
  const coverageText = await coverageResponse.text();
  const dataset = await datasetResponse.json();
  const rgsText = await rgsResponse.text();
  assert.match(coverageText, /51\.303/);
  assert.match(coverageText, /34\.071/);
  assert.match(coverageText, /13\.829\.154/);
  assert.match(coverageText, /846\.808/);
  assert.equal(dataset.dataset.id, "consulenze-legali");
  assert.equal(dataset.rows.length, 1);
  assert.match(rgsText, /Consulenze e lavoro parasubordinato nei conti RGS/);
  const state = {
    baseUrl: baseUrl.origin,
    checks: {
      coverage: true,
      datasetApi: true,
      rgsConsulting: true,
    },
    observed: {
      datasetId: dataset.dataset.id,
      publicRows: dataset.dataset.publicRows,
      sourceRows: dataset.dataset.sourceRows,
    },
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(resolve(evidenceRoot, "doctor.json"), `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify({ status: "ok", ...state }));
}

async function chromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    (() => {
      try {
        return puppeteer.executablePath();
      } catch {
        return undefined;
      }
    })(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next known browser.
    }
  }
  return undefined;
}

function installDiagnostics(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("requestfailed", (failed) => {
    const failure = failed.failure();
    const requestUrl = failed.url();
    if (!failure || !/^https?:/.test(requestUrl)) return;
    const cancelledNextPrefetch =
      failure.errorText === "net::ERR_ABORTED" &&
      (failed.resourceType() === "fetch" || failed.resourceType() === "other") &&
      new URL(requestUrl).searchParams.has("_rsc");
    if (!cancelledNextPrefetch) {
      errors.push(`requestfailed: ${requestUrl} ${failure.errorText}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === baseUrl.origin) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  return errors;
}

async function pageState(page) {
  return page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    href: location.href,
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    mainVisible: Boolean(document.querySelector("main")?.getBoundingClientRect().height),
    text: document.body.innerText.slice(0, 4_000),
  }));
}

async function assertHealthyPage(page, expectedH1) {
  const state = await pageState(page);
  assert.equal(state.h1, expectedH1);
  assert.equal(state.mainVisible, true);
  assert.ok(state.bodyScrollWidth <= state.clientWidth + 1, "overflow orizzontale globale");
  assert.doesNotMatch(state.text, /\/Users\/|\/Downloads\/|\.tar\.gz/i);
  return state;
}

async function goto(page, pathname, expectedH1) {
  const response = await page.goto(url(pathname), { waitUntil: "networkidle2", timeout: 45_000 });
  assert.ok(response?.ok(), `${pathname}: HTTP ${response?.status()}`);
  return assertHealthyPage(page, expectedH1);
}

async function screenshot(page, directory, name) {
  await page.screenshot({ path: resolve(directory, name), fullPage: true });
}

async function driveCatalog(page, directory) {
  const actions = [];
  actions.push(await goto(page, "/dati", "Tutti i dataset integrati"));
  const priorityLinks = await page.$$eval('a[href^="/dati/"]', (nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("href")))].filter(Boolean),
  );
  assert.ok(priorityLinks.length > 0 && priorityLinks.length < 89, "/dati: attesa solo la vista priorità");
  assert.ok(await page.$('nav[aria-label="Vista del catalogo"]'), "/dati: selettore vista assente");
  await screenshot(page, directory, "catalog.png");

  actions.push(await goto(page, "/dati?vista=tutti", "Tutti i dataset integrati"));
  const links = await page.$$eval('a[href^="/dati/"]', (nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("href")))].filter(Boolean),
  );
  assert.equal(links.length, 89);
  await screenshot(page, directory, "catalog-tutti.png");

  actions.push(await goto(
    page,
    "/dati/consulenze-legali?q=2024&limit=5",
    "Consulenze legali",
  ));
  const renderedRows = await page.$$eval("tbody tr", (rows) => rows.length);
  assert.ok(renderedRows > 0 && renderedRows <= 5);
  await screenshot(page, directory, "consulenze-legali.png");

  const response = await request("/api/dati/consulenze-legali?q=2024&limit=5");
  const api = await response.json();
  assert.equal(api.dataset.id, "consulenze-legali");
  assert.equal(api.limit, 5);
  assert.ok(api.rows.length > 0 && api.rows.length <= 5);
  await writeFile(resolve(directory, "api-response.json"), `${JSON.stringify(api, null, 2)}\n`);
  for (const [suffix, title] of [
    ["vecchiaia", "Indice di vecchiaia"],
    ["dipendenza-anziani", "Indice di dipendenza anziani"],
    ["dipendenza-strutturale", "Indice di dipendenza strutturale"],
  ]) {
    const datasetId = `istat-misura-comune-${suffix}`;
    const query = "q=Mappano&limit=5";
    actions.push(await goto(page, `/dati/${datasetId}?${query}`, `A misura di Comune · ${title}`));
    const municipal = await (await request(`/api/dati/${datasetId}?${query}`)).json();
    assert.equal(municipal.rows.length, 1);
    assert.equal(municipal.rows[0].cells["Codice comune Istat"], "001316");
    assert.equal(municipal.rows[0].cells["2014"], "..");
    const cells = await page.$$eval("tbody tr:first-child td", (nodes) => nodes.map((node) => node.textContent.trim()));
    assert.deepEqual(cells.slice(0, municipal.dataset.headers.length), municipal.dataset.headers.map((header) => municipal.rows[0].cells[header]));
    const text = await page.$eval("main", (node) => node.textContent);
    assert.match(text, /Unità: rapporto per 100/);
    assert.match(text, /statistica sperimentale/);
    await screenshot(page, directory, `${datasetId}.png`);
    await writeFile(resolve(directory, `${datasetId}.json`), `${JSON.stringify(municipal, null, 2)}\n`);
  }
  actions.push(await goto(page, "/dati/mim-scuole-statali-comuni?q=062008&limit=5", "Scuole statali · sedi per Comune"));
  const schools = await (await request("/api/dati/mim-scuole-statali-comuni?q=062008&limit=5")).json();
  assert.equal(schools.rows.length, 1);
  assert.equal(schools.rows[0].cells["Sedi scolastiche statali"], "49");
  const schoolCells = await page.$$eval("tbody tr:first-child td", (nodes) => nodes.map((node) => node.textContent.trim()));
  assert.deepEqual(schoolCells.slice(0, schools.dataset.headers.length), schools.dataset.headers.map((header) => schools.rows[0].cells[header]));
  assert.match(await page.$eval("main", (node) => node.textContent), /IODL 2.0/);
  await screenshot(page, directory, "mim-scuole-statali-comuni.png");
  await writeFile(resolve(directory, "mim-scuole-statali-comuni.json"), `${JSON.stringify(schools, null, 2)}\n`);
  return { actions, datasetLinks: links.length, renderedRows, apiRows: api.rows.length };
}

async function driveSourceLedger(page, directory) {
  const actions = [];
  actions.push(await goto(
    page,
    "/fonti/copertura",
    "Che cosa è stato integrato e contabilizzato",
  ));
  await screenshot(page, directory, "coverage.png");
  actions.push(await goto(
    page,
    "/fonti/catalogo?disposition=quarantined&limit=5",
    "Catalogo completo delle fonti integrate",
  ));
  const withheld = await page.$$eval("tbody tr", (rows) =>
    rows.map((row) => row.textContent?.includes("Valore non pubblicato")),
  );
  assert.equal(withheld.length, 5);
  assert.ok(withheld.every(Boolean));
  await screenshot(page, directory, "quarantine.png");
  const response = await request("/api/fonti/catalogo?disposition=quarantined&limit=5");
  const api = await response.json();
  assert.equal(api.matchedSources, 1_493);
  assert.ok(api.sources.every((source) => source.publicValue === null));
  await writeFile(resolve(directory, "api-response.json"), `${JSON.stringify(api, null, 2)}\n`);
  return { actions, withheldRows: withheld.length, matchedSources: api.matchedSources };
}

async function driveRgs(page, directory) {
  const actions = [];
  actions.push(await goto(
    page,
    "/spese/consulenze",
    "Consulenze e lavoro parasubordinato nei conti RGS",
  ));
  assert.ok(await page.$('[role="region"][aria-label="Righe contabili RGS per consulenze e lavoro parasubordinato"]'));
  await screenshot(page, directory, "consulenze.png");
  actions.push(await goto(
    page,
    "/spese/territoriale",
    "Spesa statale per territorio destinatario",
  ));
  const caption = await page.$eval("table caption", (node) => node.textContent?.trim());
  assert.equal(caption, "Una sola misura e un solo livello territoriale per tabella");
  await screenshot(page, directory, "territoriale.png");
  return { actions, consultingTable: true, territorialCaption: caption };
}

async function driveHubs(page, directory) {
  const routes = [
    ["/appalti/dettaglio", "Appalti, fornitori e rinnovi", "appalti.png"],
    ["/incarichi/dettaglio", "Incarichi, consulenze e personale", "incarichi.png"],
    ["/spese/operative", "Immobili, missioni, eventi e altre spese", "operative.png"],
    ["/spese/capitoli-progetti", "Capitoli contabili e progetti", "capitoli-progetti.png"],
    ["/trasparenza", "Documenti, segnali e verifiche", "trasparenza.png"],
    ["/partecipazioni", "Partecipazioni pubbliche", "partecipazioni.png"],
    ["/spese/sanita", "Sanità: personale e servizi nel Conto Economico", "sanita.png"],
  ];
  const actions = [];
  const links = new Set();
  for (const [pathname, heading, image] of routes) {
    actions.push(await goto(page, pathname, heading));
    const pageLinks = await page.$$eval('a[href^="/dati/"]', (nodes) =>
      nodes.map((node) => node.getAttribute("href")).filter(Boolean),
    );
    assert.ok(pageLinks.length > 0);
    pageLinks.forEach((href) => links.add(href));
    await screenshot(page, directory, image);
    if (pathname === "/spese/sanita") {
      await page.focus("#posti-letto summary");
      await page.keyboard.press("Enter");
      assert.equal(await page.$eval("#posti-letto details", (node) => node.open), true);
      assert.equal(await page.$$eval("#posti-letto tbody tr", (nodes) => nodes.length), 21);
      const section = await page.$("#posti-letto");
      await section.screenshot({ path: resolve(directory, "posti-letto.png") });
      const capacity = await (await request("/api/dati/salute-posti-letto-2023?limit=5")).json();
      assert.equal(capacity.dataset.publicRows, 1_019);
      assert.equal(capacity.dataset.sourceMetadata.referencePeriod, "2023-01-01");
      assert.equal(capacity.dataset.licenseStatus, "verified-open-iodl-2.0");
      await writeFile(resolve(directory, "posti-letto-api.json"), `${JSON.stringify(capacity, null, 2)}\n`);
    }
  }
  assert.equal(links.size, 84);
  actions.push(await goto(page, "/dati?vista=tutti", "Tutti i dataset integrati"));
  for (const suffix of ["vecchiaia", "dipendenza-anziani", "dipendenza-strutturale"]) {
    const href = `/dati/istat-misura-comune-${suffix}`;
    assert.ok(await page.$(`a[href="${href}"]`));
    links.add(href);
  }
  const schoolsHref = "/dati/mim-scuole-statali-comuni";
  assert.ok(await page.$(`a[href="${schoolsHref}"]`));
  links.add(schoolsHref);
  const tedHref = "/dati/ted-avvisi-italia-2026-08";
  assert.ok(await page.$(`a[href="${tedHref}"]`));
  links.add(tedHref);
  await screenshot(page, directory, "contesto-territoriale.png");
  assert.equal(links.size, 89);
  return { actions, uniqueDatasetLinks: links.size };
}

async function driveMcp(page, directory) {
  const state = await goto(page, "/mcp", "Interroga il portale con MCP");
  const integratedDatasetAdvertised = await page.evaluate(() =>
    document.body.innerText.includes("spesa_pa_dettaglio"),
  );
  assert.equal(integratedDatasetAdvertised, true);
  assert.equal(await page.evaluate(() => document.body.innerText.includes("salute_posti_letto")), true);
  await screenshot(page, directory, "mcp.png");
  return { actions: [state], integratedDatasetAdvertised };
}

async function drive() {
  const known = new Set([
    "integrated-data-catalog",
    "source-ledger",
    "rgs-public-pages",
    "thematic-hubs",
    "mcp-access",
  ]);
  if (!known.has(feature)) throw new Error(`Feature non riconosciuta: ${feature}`);
  const featureDirectory = resolve(evidenceRoot, feature);
  const directory = viewportMode === "desktop"
    ? featureDirectory
    : resolve(featureDirectory, viewportMode);
  await mkdir(directory, { recursive: true });
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    executablePath: await chromeExecutable(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = installDiagnostics(page);
    const result = feature === "integrated-data-catalog"
      ? await driveCatalog(page, directory)
      : feature === "source-ledger"
        ? await driveSourceLedger(page, directory)
        : feature === "rgs-public-pages"
          ? await driveRgs(page, directory)
          : feature === "thematic-hubs"
            ? await driveHubs(page, directory)
            : await driveMcp(page, directory);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    assert.deepEqual(errors, [], errors.join("\n"));
    const state = {
      feature,
      baseUrl: baseUrl.origin,
      viewportMode,
      viewport: [viewport.width, viewport.height],
      result,
    };
    await writeFile(resolve(directory, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
    console.log(JSON.stringify({ status: "ok", feature, evidence: directory }));
  } finally {
    await closeBrowser(browser);
  }
}

if (mode === "doctor") {
  await doctor();
} else if (mode === "drive") {
  await drive();
} else {
  throw new Error("Uso: verify.mjs doctor | drive <feature>");
}
