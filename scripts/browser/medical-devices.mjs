import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeBrowser,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  runScenario,
  waitForServer,
} from "./harness.mjs";

async function inspectMedicalDevices(page) {
  assert.equal(await page.$eval("h1", (heading) => heading.textContent), "Spesa per dispositivi medici");
  const text = await page.$eval("main", (main) => main.innerText);
  assert.match(text, /PROFEMUR PRESERVE/);
  assert.match(text, /Aggregati della spesa rilevata/i);
  assert.match(text, /Non sono prezzi unitari né pagamenti al fabbricante/i);
  assert.ok(await page.$('main a[href="/spese/sanita/dispositivi/1/1175175"]'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

  const api = await page.evaluate(async () => {
    const response = await fetch("/api/spese/sanita/dispositivi?vista=ricerca&q=1175175&tipo=1");
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(api.status, 200);
  assert.equal(api.payload.hits[0].number, "1175175");
  assert.equal(api.payload.hits[0].type, "1");

  const directory = path.join(defaultArtifactsDir(), "medical-devices", `${page.viewport().width}px`);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, "ricerca-pr.png"), fullPage: false });
  await page.screenshot({ path: path.join(directory, "ricerca.png"), fullPage: true });

  const detailLink = await page.$('main a[href="/spese/sanita/dispositivi/1/1175175"]');
  await detailLink.focus();
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.keyboard.press("Enter")]);
  assert.equal(new URL(page.url()).pathname, "/spese/sanita/dispositivi/1/1175175");
  assert.equal(await page.$eval("h1", (heading) => heading.textContent), "PROFEMUR PRESERVE");
  await page.evaluate(() => window.scrollTo(0, 0));
  const detailText = await page.$eval("main", (main) => main.innerText);
  assert.match(detailText, /Anagrafica BD\/RDM/i);
  assert.match(detailText, /Righe della fonte/i);
  assert.match(detailText, /Non riporta prezzi unitari/i);
  await page.screenshot({ path: path.join(directory, "scheda-pr.png"), fullPage: false });
  const tableRegion = await page.$('[role="region"][aria-label^="Righe di spesa"]');
  await tableRegion.focus();
  assert.equal(await tableRegion.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: path.join(directory, "scheda.png"), fullPage: true });
}

async function inspectEmptyMedicalDevices(page) {
  assert.equal(await page.$eval("h1", (heading) => heading.textContent), "Spesa per dispositivi medici");
  const mainText = await page.$eval("main", (main) => main.innerText);
  assert.doesNotMatch(mainText, /La ricerca parte solo dopo aver inserito un termine/i);
  assert.equal(await page.$eval('section[aria-labelledby="ricerca-title"] button[type="submit"]', (button) => button.classList.contains("btn-primary")), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

  const directory = path.join(defaultArtifactsDir(), "medical-devices", `${page.viewport().width}px`);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, "ricerca-vuota-pr.png"), fullPage: false });
}

async function inspectDependentFilters(page) {
  for (const [year, region, company] of [
    ["annoRicerca", "regione", "azienda"],
    ["anno", "regioneAggregati", "aziendaAggregati"],
  ]) {
    await page.select(`select[name="${year}"]`, "2018");
    await page.waitForFunction((name) => document.querySelector(`select[name="${name}"] option[value="030"]`), {}, region);
    await page.select(`select[name="${region}"]`, "030");
    await page.select(`select[name="${company}"]`, "030715");
    await page.select(`select[name="${region}"]`, "010");
    assert.equal(await page.$eval(`select[name="${company}"]`, (select) => select.value), "");
    await page.select(`select[name="${region}"]`, "030");
    await page.select(`select[name="${company}"]`, "030715");
    await page.select(`select[name="${year}"]`, "2021");
    assert.equal(await page.$eval(`select[name="${region}"]`, (select) => select.value), "");
    assert.equal(await page.$eval(`select[name="${company}"]`, (select) => select.value), "");
    assert.equal(await page.$eval(`select[name="${company}"]`, (select) => select.disabled), true);
    assert.ok(await page.$(`select[name="${region}"] option[value="10"]`));
  }
  await page.select('select[name="regioneAggregati"]', "10");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('#aggregati button[type="submit"]'),
  ]);
  assert.equal(await page.$eval("#aggregati thead th", (cell) => cell.textContent), "Aziende sanitarie");
  assert.equal(await page.$('#aggregati [role="alert"]'), null);
  assert.match(await page.$eval('section[aria-labelledby="ricerca-title"]', (section) => section.innerText), /Totali nazionali per anno/);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await waitForServer(defaultBaseUrl());
  const browser = await launchBrowser();
  try {
    for (const width of [390, 1280]) {
      await runScenario(browser, {
        label: `Dispositivi medici vuoto ${width}px`,
        pathname: "/spese/sanita/dispositivi",
        width,
        validate: inspectEmptyMedicalDevices,
        suite: "medical-devices",
      });
      console.log(`PASS dispositivi medici vuoto ${width}px`);
    }
    for (const width of [390, 768, 1280]) {
      await runScenario(browser, {
        label: `Dispositivi medici ${width}px`,
        pathname: "/spese/sanita/dispositivi?q=1175175&tipo=1",
        width,
        validate: inspectMedicalDevices,
        suite: "medical-devices",
      });
      console.log(`PASS dispositivi medici ${width}px`);
    }
    await runScenario(browser, {
      label: "Dispositivi medici filtri dipendenti",
      pathname: "/spese/sanita/dispositivi?q=1175175&tipo=1",
      width: 1280,
      validate: inspectDependentFilters,
      suite: "medical-devices",
    });
    console.log("PASS dispositivi medici filtri dipendenti");
  } finally {
    await closeBrowser(browser);
  }
}
