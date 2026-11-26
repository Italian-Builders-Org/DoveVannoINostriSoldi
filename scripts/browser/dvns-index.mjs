// DVNS Index end to end at 390, 768 and 1280 px. Needs the receipt-pinned payload
// (dvns_snapshots or the local ETL output): like /manovra it is not part of the CI gates.
import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/dvns-index" });
const browser = await launchBrowser();
// This environment blocks the analytics host: that request failure is not the page's.
const expectedFailure = (failure) => /googletagmanager|ERR_TUNNEL_CONNECTION_FAILED/u.test(failure)
  // The test asks for a dot that does not exist on purpose: that 404 is the expected answer.
  || /\/api\/dvns-index\/punto\?colonna=999/u.test(failure);
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
      suite: "dvns-index",
      label: `DVNS Index Bologna ${width}px`,
      pathname: "/dvns-index?comune=037006",
      width,
      expectedFailure,
      async validate(page) {
        await assertLayout(page, "scheda Bologna");
        const main = await page.$eval("main", (el) => el.innerText);
        assert.doesNotMatch(main, /non disponibil/iu, "la pagina mostra lo stato senza dati");
        assert.doesNotMatch(main, /\bNaN\b|\bundefined\b|\bnull\b/u, "valore non formattato");

        // Title below the site header, wordmark large.
        const hero = await page.$eval("#dvns-index-title", (el) => ({ top: el.getBoundingClientRect().top + window.scrollY, size: parseFloat(getComputedStyle(el).fontSize) }));
        const headerBottom = await page.$eval(".site-header", (el) => el.getBoundingClientRect().bottom);
        assert.ok(hero.top >= headerBottom, "il titolo finisce sotto la barra del sito");
        assert.ok(hero.size >= 60, `wordmark troppo piccolo: ${hero.size}px`);

        // The card explains the score: four pillars whose points add up to it.
        const score = Number(await page.$eval("[data-score]", (el) => el.getAttribute("data-score")));
        assert.equal(score, 86.2);
        assert.equal((await page.$$("[data-pillar-card]")).length, 4);
        const formula = await page.$eval("#scheda h3 + p + div + p", (el) => el.textContent ?? "");
        const parts = [...formula.matchAll(/(\d+,\d)\s+[a-z]/gu)].map((match) => number(match[1]));
        assert.equal(parts.length, 4, `formula: ${formula}`);
        assert.ok(Math.abs(parts.reduce((sum, value) => sum + value, 0) - score) <= 0.2, `i pilastri non sommano al punteggio: ${formula}`);
        assert.match(main, /1° su 35/u, "posizione tra le città simili");
        assert.ok(await page.$('#scheda a[href^="/comuni?ente="]'), "manca il link alla scheda del Comune");
        assert.ok(await page.$('#scheda a[href="/dvns-index/metodo"]'), "manca il link al metodo dalla scheda");
        // The ranking is the main action at the top; the method sits next to it and in the callout.
        const primary = await page.$eval('[data-ranking-link="hero"]', (el) => ({ href: el.getAttribute("href"), background: getComputedStyle(el).backgroundColor, left: el.getBoundingClientRect().left }));
        assert.equal(primary.href, "#classifica");
        assert.equal(primary.background, "rgb(216, 247, 74)", "il pulsante della classifica deve essere quello evidenziato");
        assert.ok(primary.left < (await page.$eval('[data-method-link="hero"]', (el) => el.getBoundingClientRect().left)) || width <= 390, "la classifica va a sinistra del metodo");
        const methodTop = await page.$eval('[data-method-link="hero"]', (el) => ({ href: el.getAttribute("href"), visible: el.getBoundingClientRect().bottom <= window.innerHeight * 1.6 && el.getBoundingClientRect().width > 0 }));
        assert.equal(methodTop.href, "/dvns-index/metodo");
        assert.ok(methodTop.visible, "il pulsante del metodo non è ben visibile in alto");
        assert.equal(await page.$eval('[data-method-link="callout"]', (el) => el.getAttribute("href")), "/dvns-index/metodo");

        // The searched Comune is labelled on the chart.
        assert.equal(await page.$eval('[data-highlight="true"] text', (el) => el.textContent), "Bologna");

        // Tapping a dot opens its Comuni below the axis, hides the label, closes back.
        const dot = await page.$('[data-dot="30-4"]');
        await dot.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await dot.click();
        await page.waitForSelector("[data-dot-popover] ol li", { timeout: 15000 });
        const panel = await page.$eval("[data-dot-popover]", (el) => {
          const box = el.getBoundingClientRect();
          const axis = el.previousElementSibling?.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, axisBottom: axis?.bottom ?? 0, rows: el.querySelectorAll("li").length, title: el.querySelector("strong")?.textContent ?? "" };
        });
        assert.ok(panel.rows >= 1 && panel.rows <= 10, `righe nel punto: ${panel.rows}`);
        assert.ok(panel.left >= 0 && panel.right <= width + 1, "l'elenco esce dallo schermo");
        assert.ok(panel.top >= panel.axisBottom, "l'elenco copre l'asse del grafico");
        assert.match(panel.title, /\d+ Comuni con punteggio/u);
        assert.equal(await page.$('[data-highlight="true"]'), null, "l'etichetta del Comune cercato resta con un altro punto aperto");
        await assertLayout(page, "punto aperto");
        await page.click("[data-dot-popover] button");
        assert.equal(await page.$("[data-dot-popover]"), null);
        assert.ok(await page.$('[data-highlight="true"]'), "l'etichetta non torna dopo la chiusura");

        // Ranking: 50 consecutive rows, each linking to its explanation.
        const ranks = await page.$$eval("[data-ranking-row] td:first-child", (cells) => cells.map((cell) => cell.textContent ?? ""));
        assert.equal(ranks.length, 50);
        assert.deepEqual(ranks.map(number), Array.from({ length: 50 }, (_, index) => index + 1));

        // Keyboard, from a fresh load: the skip link appears on the first Tab.
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("#dvns-index-title");
        await page.keyboard.press("Tab");
        const skipShown = await page.evaluate(() => {
          const el = document.activeElement;
          return /Salta al contenuto/u.test(el?.textContent ?? "") && el.getBoundingClientRect().top >= 0;
        });
        assert.ok(skipShown, "il link per saltare al contenuto non compare con Tab");
        assert.equal(await page.$eval('label[for="dvns-index-q"]', (el) => el.textContent), "Cerca il tuo Comune");
      },
    });

    await runScenario(browser, {
      suite: "dvns-index",
      label: `DVNS Index ricerca e filtri ${width}px`,
      pathname: "/dvns-index",
      width,
      expectedFailure,
      async validate(page) {
        await assertLayout(page, "pagina base");
        assert.equal(await page.$('[data-highlight="true"]'), null);
        assert.equal(await page.$('meta[name="robots"][content*="noindex"]'), null, "la pagina base non deve essere noindex");
        await page.type("#dvns-index-q", "Gubbio");
        await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.keyboard.press("Enter")]);
        await page.waitForSelector("#scheda-title");
        assert.equal(await page.$eval("#scheda-title", (el) => el.textContent), "Gubbio");
        assert.match(await page.$eval("#scheda", (el) => el.innerText), /60° su 314/u);
        await assertLayout(page, "scheda Gubbio");

        await page.goto(`${baseUrl}/dvns-index?regione=08&fascia=A`, { waitUntil: "domcontentloaded" });
        const rows = await page.$$eval("[data-ranking-row]", (items) => items.map((row) => row.textContent ?? ""));
        assert.ok(rows.length > 0 && rows.length <= 50);
        assert.ok(rows.every((row) => /Emilia-Romagna/u.test(row) && /A$/u.test(row.trim())), "filtro regione o fascia non applicato");
        assert.ok(await page.$('meta[name="robots"][content*="noindex"]'), "le viste filtrate devono essere noindex");
        await assertLayout(page, "classifica filtrata");

        const missing = await page.evaluate(async () => (await fetch("/api/dvns-index/punto?colonna=999&riga=0")).status);
        assert.equal(missing, 404);
      },
    });

    await runScenario(browser, {
      suite: "dvns-index",
      label: `DVNS Index metodo ${width}px`,
      pathname: "/dvns-index/metodo",
      width,
      expectedFailure,
      async validate(page) {
        await assertLayout(page, "metodo");
        const headings = await page.$$eval("main h2", (items) => items.map((item) => item.textContent));
        for (const title of ["In breve", "I dati", "I quattro pilastri", "Il confronto tra Comuni simili", "Punteggio, fasce e solidità", "Un esempio completo: Bologna", "Cosa l'indice non dice", "Come verificarlo"]) {
          assert.ok(headings.includes(title), `manca la sezione "${title}"`);
        }
        // The worked example adds up: four pillar points equal the published score.
        const cells = await page.$$eval("#esempio ~ div table tbody tr td:last-child, section[aria-labelledby=esempio] tbody td:last-child", (items) => items.map((item) => item.textContent ?? ""));
        const total = await page.$eval("section[aria-labelledby=esempio] tfoot strong", (el) => el.textContent ?? "");
        assert.equal(cells.length, 4);
        assert.ok(Math.abs(cells.map(number).reduce((sum, value) => sum + value, 0) - number(total)) <= 0.2, "l'esempio non somma al punteggio");
        assert.doesNotMatch(await page.$eval("main", (el) => el.innerText), /\bNaN\b|\bundefined\b|n\.d\./u);
      },
    });

    await runScenario(browser, {
      suite: "dvns-index",
      label: `DVNS Index banner e badge ${width}px`,
      pathname: "/",
      width,
      expectedFailure,
      async validate(page) {
        assert.equal(await page.$eval("[data-dvns-index-launch]", (el) => el.getAttribute("href")), "/dvns-index");
        await assertLayout(page, "home");
        await page.goto(`${baseUrl}/comuni?ente=c_a944`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-dvns-index-badge]");
        const badge = await page.$eval("[data-dvns-index-badge]", (el) => ({ href: el.getAttribute("href"), text: el.textContent ?? "" }));
        assert.equal(badge.href, "/dvns-index?comune=037006#scheda");
        assert.match(badge.text, /86,2.*19° su 5\.421.*fascia A/u);
        const colors = await page.$eval("[data-dvns-index-badge]", (el) => [...el.querySelectorAll("span, strong")].map((node) => getComputedStyle(node).color));
        assert.ok(colors.every((color) => color !== "rgb(13, 14, 16)"), "testo del badge invisibile sul fondo scuro");
      },
    });
  }
} finally {
  await closeBrowser(browser);
}
