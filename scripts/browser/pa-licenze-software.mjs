// Needs the receipt-pinned payload (dvns_snapshots or the local ETL output): like the /manovra
// scenario it is not part of the CI gates, where the payload is not available.
import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/appalti/licenze-software" });
const browser = await launchBrowser();

/** "292,5 mln €" or "647.860 €" back to euro, at the precision shown. */
function euro(text) {
  const value = Number(text.replace(/[^\d,]/gu, "").replace(",", "."));
  if (/mld/u.test(text)) return value * 1e9;
  if (/mln/u.test(text)) return value * 1e6;
  return value;
}

try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      suite: "pa-licenze-software",
      label: `Licenze software PA ${width}px`,
      pathname: "/appalti/licenze-software",
      width,
      async validate(page) {
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });

        const h1 = await page.$eval("main h1", (el) => el.textContent ?? "");
        assert.match(h1, /^Licenze software della PA: [\d,]+ mln € ordinati nel 2025 sulle convenzioni Consip$/u);
        const main = await page.$eval("main", (el) => el.innerText);
        assert.doesNotMatch(main, /non disponibili/i, "la pagina mostra lo stato senza dati");
        assert.doesNotMatch(main, /\bNaN\b|\bundefined\b|\bnull\b|n\.d\./u, "valore non formattato");
        assert.doesNotMatch(main, /\b1 (ordini|aggiudicazioni|enti)\b/u, "plurale sbagliato");

        const bars = (title) =>
          page.$$eval(`main ol[aria-label^="${title}"] li[data-bar]`, (nodes) =>
            nodes.map((node) => ({
              key: node.getAttribute("data-bar"),
              value: node.querySelector("strong")?.textContent ?? "",
              text: node.textContent ?? "",
              width: node.querySelector("[data-tone]")?.getBoundingClientRect().width ?? 0,
            })),
          );

        // Vendors of the reference year add up to the headline, within the rounding of the labels.
        const vendors = await bars("Importo ordinato per produttore");
        assert.ok(vendors.length >= 10, "attesi almeno dieci produttori");
        assert.equal(vendors[0].key, "Microsoft");
        const headline = euro(h1.match(/([\d,]+ mln €)/u)[1]);
        const sum = vendors.reduce((total, row) => total + euro(row.value), 0);
        assert.ok(Math.abs(sum - headline) / headline < 0.01, `produttori ${sum} contro titolo ${headline}`);
        assert.ok(vendors.slice(0, 5).every((row) => row.width > 0), "barre non disegnate");
        assert.ok(vendors.some((row) => row.key === "Red Hat" && /open source/u.test(row.text)), "Red Hat non marcato open source");

        // Administration types: ten named plus the rest, still adding up to the headline.
        const types = await bars("Importo ordinato per tipo di amministrazione");
        assert.ok(types.length <= 11);
        const typesSum = types.reduce((total, row) => total + euro(row.value), 0);
        assert.ok(Math.abs(typesSum - headline) / headline < 0.01, `tipologie ${typesSum} contro titolo ${headline}`);

        // Year table: the partial year says so.
        const years = await page.$$eval("main tr[data-year]", (nodes) => nodes.map((row) => row.textContent ?? ""));
        assert.equal(years.length, 3);
        assert.match(years[2], /2026 \(fino al \d{2}\/\d{2}\/2026\)/u);

        // ANAC: every large award links its CIG on the ANAC portal and its entity page.
        const awards = await page.$$eval("main tr[data-cig]", (nodes) =>
          nodes.map((row) => ({
            cig: row.getAttribute("data-cig"),
            href: row.querySelector("th a")?.getAttribute("href") ?? "",
            entity: row.querySelector("td a")?.getAttribute("href") ?? "",
          })),
        );
        assert.equal(awards.length, 10);
        for (const award of awards) {
          const url = new URL(award.href);
          assert.equal(url.hostname, "dati.anticorruzione.it");
          assert.equal(url.searchParams.get("cig"), award.cig);
          assert.match(award.entity, /^\/enti\/[^/]+\/appalti$/u);
        }
        assert.match(main, /non va sommata a quelle Consip/u);
        assert.match(main, /Nessuna stima di risparmio/u);

        // Every chart repeats its numbers in a table that opens from the keyboard.
        const summaries = await page.$$("main details.chart-data > summary");
        assert.equal(summaries.length, 8);
        await summaries[0].focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.$eval("main details.chart-data", (el) => el.open), true, "la tabella del grafico non si apre da tastiera");

        assert.equal(await page.$eval('main nav[aria-label="Percorso"] a', (el) => el.getAttribute("href")), "/appalti");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `overflow orizzontale di ${overflow}px`);
        assert.deepEqual(errors.filter((text) => !/googletagmanager|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED/u.test(text)), []);
      },
    });
  }
} finally {
  await closeBrowser(browser);
}
