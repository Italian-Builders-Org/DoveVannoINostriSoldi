// Wealth tax study end to end at 390, 768 and 1280 px. Needs the receipt-pinned payload
// (dvns_snapshots or the local ETL output): like /studi/exit-tax it is not part of the CI gates.
import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/studi/patrimoniale" });
const browser = await launchBrowser();
// This environment blocks the analytics host: that request failure is not the page's.
const expectedFailure = (failure) => /googletagmanager|ERR_TUNNEL_CONNECTION_FAILED/u.test(failure);
const number = (text) => Number(text.replace(/\./gu, "").replace(",", ".").replace(/[^\d.]/gu, ""));

/** Layout checks that a full-page screenshot can hide: run at the top and while scrolling. */
async function assertLayout(page, where) {
  for (const fraction of [0, 0.35, 0.7, 1]) {
    await page.evaluate((f) => window.scrollTo({ top: (document.documentElement.scrollHeight - window.innerHeight) * f, behavior: "instant" }), fraction);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const state = await page.evaluate(() => {
      const skip = [...document.querySelectorAll("a")].find((a) => /Salta al contenuto/u.test(a.textContent ?? ""));
      const header = document.querySelector(".site-header")?.getBoundingClientRect();
      // Visible elements whose box leaves the viewport sideways, outside the scrollable tables.
      const escaping = [...document.querySelectorAll("main *")].filter((el) => {
        if (el.closest(".table-scroll")) return false;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return box.right > window.innerWidth + 1 || box.left < -1;
      }).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`).slice(0, 5);
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        skipVisible: skip ? skip.getBoundingClientRect().bottom > 0 && document.activeElement !== skip : false,
        headerTop: header ? Math.round(header.top) : null,
        escaping,
      };
    });
    assert.ok(state.overflow <= 1, `${where} ${fraction}: overflow orizzontale di ${state.overflow}px`);
    assert.equal(state.skipVisible, false, `${where} ${fraction}: link "Salta al contenuto" visibile senza focus`);
    assert.equal(state.headerTop, 0, `${where} ${fraction}: barra del sito non ferma in alto`);
    assert.deepEqual(state.escaping, [], `${where} ${fraction}: elementi fuori dallo schermo`);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}

try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      suite: "patrimoniale",
      label: `Patrimoniale ${width}px`,
      pathname: "/studi/patrimoniale",
      width,
      expectedFailure,
      async validate(page) {
        await assertLayout(page, "studio patrimoniale");
        const main = await page.$eval("main", (el) => el.innerText);
        assert.doesNotMatch(main, /non disponibil/iu, "la pagina mostra lo stato senza dati");
        assert.doesNotMatch(main, /\bNaN\b|\bundefined\b|\bnull\b|n\.d\.|Infinity/u, "valore non formattato o scenario mancante");
        for (const id of ["esistenti", "distribuzione", "chi", "proposte", "scenari", "effetti", "estero", "metodo"]) {
          assert.ok(await page.$(`section#${id} h2`), `manca la sezione ${id}`);
        }
        assert.match(main, /Sono ipotesi,\s+non previsioni/u, "gli scenari non sono dichiarati come ipotesi");
        assert.match(main, /41\.012/u, "manca l'emendamento AVS");

        // Bands: six, covering every household once.
        const bands = await page.$$eval("[data-band]", (els) => els.map((el) => el.getAttribute("data-band")));
        assert.deepEqual(bands, ["Q1", "Q2", "Q3", "Q4", "D9", "D10"]);

        // Flat scenarios: revenue grows with the rate (in proportion) and falls with the threshold.
        const grid = await page.$$eval("[data-scenario-row]", (trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => Number(td.getAttribute("data-revenue")))));
        assert.equal(grid.length, 3);
        for (const row of grid) {
          assert.ok(Math.abs(row[1] / row[0] - 2) < 0.01 && Math.abs(row[2] / row[1] - 2) < 0.01, `il gettito non è proporzionale all'aliquota: ${row}`);
        }
        for (let i = 1; i < grid.length; i += 1) assert.ok(grid[i][0] < grid[i - 1][0], "il gettito non scende alzando la soglia");

        // Variants: every reduction of the base lowers the revenue.
        const variants = await page.$$eval("[data-variant-row]", (trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
        for (const row of variants.map((cells) => cells.map(number))) assert.ok(row[0] > row[1] && row[1] > row[2], `varianti non decrescenti: ${row}`);

        // Households above each threshold: the first level is checked, the top one extrapolated.
        const levels = await page.$$eval("[data-level]", (trs) => trs.map((tr) => tr.innerText));
        assert.equal(levels.length, 4);
        assert.match(levels.at(-1), /estrapolato/u);
        assert.doesNotMatch(levels[0], /estrapolato/u);
        assert.match(levels[1], /estrapolato/u, "le soglie oltre il 5% più ricco vanno segnate come estrapolate");

        // OECD ranking from the highest share, with Italy; four systems compared; https sources.
        const oecd = await page.$$eval("[data-oecd]", (trs) => trs.map((tr) => tr.getAttribute("data-oecd")));
        assert.ok(oecd.includes("ITA") && oecd.includes("CHE") && oecd[0] === "LUX", `classifica OCSE inattesa: ${oecd}`);
        assert.deepEqual(await page.$$eval("[data-country]", (trs) => trs.map((tr) => tr.getAttribute("data-country"))), ["Svizzera", "Norvegia", "Spagna", "Francia"]);
        const links = await page.$$eval("#metodo a", (as) => as.map((a) => a.href));
        assert.ok(links.length >= 10 && links.every((href) => href.startsWith("https://")), "fonti non https");

        // Keyboard: the regional table opens with Enter.
        await page.focus("#chi details summary");
        await page.keyboard.press("Enter");
        assert.equal(await page.$eval("#chi details", (el) => el.open), true, "il pannello delle regioni non si apre con la tastiera");
        assert.equal((await page.$$("[data-region]")).length, 20);

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("main h1");
        await page.keyboard.press("Tab");
        const skipShown = await page.evaluate(() => /Salta al contenuto/u.test(document.activeElement?.textContent ?? ""));
        assert.ok(skipShown, "il link per saltare al contenuto non compare con Tab");
      },
    });
  }

  await runScenario(browser, {
    suite: "patrimoniale",
    label: "Studi elenca la patrimoniale",
    pathname: "/studi",
    width: 1280,
    expectedFailure,
    async validate(page) {
      assert.ok(await page.$('#patrimoniale a[href="/studi/patrimoniale"]'), "manca la scheda dello studio in /studi");
    },
  });
} finally {
  await closeBrowser(browser);
}
