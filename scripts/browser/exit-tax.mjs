// Exit tax study end to end at 390, 768 and 1280 px. Needs the receipt-pinned payload
// (dvns_snapshots or the local ETL output): like /dvns-index it is not part of the CI gates.
import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/studi/exit-tax" });
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
      suite: "exit-tax",
      label: `Exit tax ${width}px`,
      pathname: "/studi/exit-tax",
      width,
      expectedFailure,
      async validate(page) {
        await assertLayout(page, "studio exit tax");
        const main = await page.$eval("main", (el) => el.innerText);
        assert.doesNotMatch(main, /non disponibil/iu, "la pagina mostra lo stato senza dati");
        assert.doesNotMatch(main, /\bNaN\b|\bundefined\b|\bnull\b|n\.d\./u, "valore non formattato o scenario mancante");
        for (const id of ["norma", "chi", "stima", "scenari", "rinvio", "estero", "effetti", "metodo"]) {
          assert.ok(await page.$(`section#${id} h2`), `manca la sezione ${id}`);
        }
        assert.match(main, /6,74 milioni/u, "manca la stima del Governo");
        assert.match(main, /Sono ipotesi,\s+non previsioni/u, "gli scenari non sono dichiarati come ipotesi");

        // Scenario table: every cell follows from the stock above threshold, the 26% rate and the two hypotheses.
        const prose = await page.$eval("#scenari", (el) => el.textContent ?? "");
        const stock = number(prose.match(/restano ([\d.,]+) miliardi/u)[1]);
        const gains = await page.$$eval("#scenari thead th", (ths) => ths.slice(1).map((th) => Number((th.textContent ?? "").match(/al (\d+)%/u)[1])));
        const rows = await page.$$eval("[data-scenario-row]", (trs) => trs.map((tr) => ({
          emigration: Number(tr.getAttribute("data-scenario-row")),
          cells: [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
        })));
        assert.equal(rows.length, 4);
        for (const row of rows) {
          row.cells.forEach((cell, index) => {
            const expected = ((((stock * row.emigration) / 100) * gains[index]) / 100) * 0.26 * 1000;
            assert.ok(Math.abs(number(cell) - expected) <= Math.max(0.3, expected * 0.003), `scenario ${row.emigration}%/${gains[index]}%: ${cell} invece di ${expected.toFixed(1)}`);
          });
        }

        // Emigration chart: one bar per year up to 2025.
        const years = await page.$$eval("[data-year]", (els) => els.map((el) => el.getAttribute("data-year")));
        assert.ok(years.length >= 10 && years.at(-1) === "2025", "serie degli espatri incompleta");

        // Every foreign country cites at least one https source.
        const countries = await page.$$eval("[data-country]", (trs) => trs.map((tr) => ({
          name: tr.getAttribute("data-country"),
          links: [...tr.querySelectorAll("a")].map((a) => a.href),
        })));
        assert.deepEqual(countries.map((c) => c.name), ["Italia", "Francia", "Germania", "Spagna", "Stati Uniti", "Norvegia"]);
        for (const c of countries.slice(1)) {
          assert.ok(c.links.length > 0 && c.links.every((href) => href.startsWith("https://")), `${c.name} senza fonte https`);
        }

        // Keyboard: the amendments panel opens with Enter and shows its rows.
        await page.focus("#norma details summary");
        await page.keyboard.press("Enter");
        assert.equal(await page.$eval("#norma details", (el) => el.open), true, "il pannello degli emendamenti non si apre con la tastiera");
        assert.ok((await page.$$("#norma details tbody tr")).length >= 1, "pannello degli emendamenti vuoto");

        // From a fresh load the skip link takes the first Tab.
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("main h1");
        await page.keyboard.press("Tab");
        const skipShown = await page.evaluate(() => /Salta al contenuto/u.test(document.activeElement?.textContent ?? ""));
        assert.ok(skipShown, "il link per saltare al contenuto non compare con Tab");
      },
    });
  }

  await runScenario(browser, {
    suite: "exit-tax",
    label: "Studi elenca l'exit tax",
    pathname: "/studi",
    width: 1280,
    expectedFailure,
    async validate(page) {
      assert.ok(await page.$('#exit-tax a[href="/studi/exit-tax"]'), "manca la scheda dello studio in /studi");
    },
  });
} finally {
  await closeBrowser(browser);
}
