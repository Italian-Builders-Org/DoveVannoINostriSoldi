// Needs the receipt-pinned payload (dvns_snapshots or the local ETL output): like the /manovra
// scenario it is not part of the CI gates, where the payload is not available.
import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/parlamento/emendamenti" });
const browser = await launchBrowser();

const number = (text) => Number(text.replace(/[^\d]/gu, ""));

try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      suite: "manovra-emendamenti",
      label: `Emendamenti manovra ${width}px`,
      pathname: "/parlamento/emendamenti",
      width,
      async validate(page) {
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });

        assert.match(await page.$eval("main h1", (el) => el.textContent ?? ""), /Emendamenti alla manovra 2027: 6\.558 proposte/);
        const main = await page.$eval("main", (el) => el.innerText);
        assert.doesNotMatch(main, /non disponibili/i, "la pagina mostra lo stato senza dati");
        assert.doesNotMatch(main, /\bNaN\b|\bundefined\b|\bnull\b|n\.d\./, "valore non formattato");

        // The three outcomes are distinct and add up to the published total.
        const outcomes = await page.$$eval("main [data-outcome-total]", (nodes) =>
          nodes.map((node) => [node.getAttribute("data-outcome-total"), node.querySelector("strong")?.textContent ?? ""]),
        );
        const byOutcome = Object.fromEntries(outcomes.map(([key, text]) => [key, number(text)]));
        assert.equal(byOutcome.inammissibile, 1685);
        assert.equal(byOutcome.parzialmente_inammissibile, 36);
        assert.equal(byOutcome.ammissibile + byOutcome.parzialmente_inammissibile + byOutcome.inammissibile, 6558);

        // Reasons add up to the inadmissible amendments.
        const bars = (title) =>
          page.$$eval(`main ol[aria-label^="${title}"] li[data-bar]`, (nodes) =>
            nodes.map((node) => ({
              key: node.getAttribute("data-bar"),
              value: node.querySelector("strong")?.textContent ?? "",
              text: node.textContent ?? "",
              // The bar is decoration, but it must be drawn: a zero-width track would hide the chart.
              width: node.querySelector("[data-tone]")?.getBoundingClientRect().width ?? 0,
            })),
          );
        const reasons = await bars("Motivo dell'inammissibilità");
        assert.equal(reasons.length, 4);
        assert.equal(reasons.map((row) => number(row.value)).reduce((sum, value) => sum + value, 0), 1685);
        assert.ok(reasons.every((row) => row.width > 0), "barre dei motivi non disegnate");

        // Group bars never exceed the total; the Government has no per-deputy ratio.
        const groups = await bars("Proposte per gruppo");
        assert.ok(groups.length >= 10, "attesi almeno dieci gruppi");
        assert.ok(groups.reduce((sum, group) => sum + number(group.value), 0) <= 6558);
        assert.ok(groups.every((group) => /inammissibili/.test(group.text)));
        assert.doesNotMatch(groups.find((group) => group.key === "governo")?.text ?? "a testa", /a testa/);
        assert.equal((await bars("I dieci articoli")).length, 10);
        assert.ok((await bars("Proposte con un solo Comune")).length > 0);
        assert.equal((await bars("Proposte per spesa dichiarata")).length, 5);

        // Coalitions, signature bands and coverage each add up to what the page declares.
        const coalitions = await bars("Proposte per schieramento");
        assert.deepEqual(coalitions.map((row) => row.key).sort(), ["governo", "maggioranza", "misto", "opposizione"]);
        assert.equal(coalitions.reduce((sum, row) => sum + number(row.value), 0), groups.reduce((sum, group) => sum + number(group.value), 0));
        for (const title of ["Proposte per numero di firme", "Proposte per fondo citato"]) {
          const rows = await bars(title);
          assert.equal(rows.length, 5, title);
          assert.equal(rows.reduce((sum, row) => sum + number(row.value), 0), 6558, title);
        }
        assert.ok((await page.$$("main tr[data-identical]")).length > 0, "mancano i testi identici");
        assert.ok((await page.$$("main tr[data-shared]")).length > 0, "mancano le proposte firmate da più gruppi");

        // Each chart repeats its numbers in a table that opens from the keyboard.
        const summaries = await page.$$("main details.chart-data > summary");
        assert.equal(summaries.length, 8);
        await summaries[0].focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.$eval("main details.chart-data", (el) => el.open), true, "la tabella del grafico non si apre da tastiera");

        // Every single-Comune row links the official page of that amendment and quotes the text.
        const rows = await page.$$eval("main tr[data-amendment]", (nodes) =>
          nodes.map((row) => ({
            id: row.getAttribute("data-amendment"),
            href: row.querySelector("th a")?.getAttribute("href") ?? "",
            municipality: row.querySelector("td")?.textContent ?? "",
          })),
        );
        assert.ok(rows.length > 0, "nessuna proposta con un solo Comune");
        for (const row of rows) {
          const url = new URL(row.href);
          assert.equal(url.hostname, "documenti.camera.it");
          assert.equal(url.searchParams.get("idPropostaEmendativa"), `${row.id}.`);
          assert.equal(url.searchParams.get("contenitorePortante"), "leg.19.eme.ac.3174-bis");
          assert.match(row.municipality, /«.+»/u, `${row.id}: manca la frase di origine`);
        }
        assert.match(main, new RegExp(`Tutte le ${rows.length.toLocaleString("it-IT")} proposte`));

        // Sources: official list, act, deputies open data, ISTAT.
        for (const id of ["camera-emendamenti", "camera-atto", "camera-deputati", "istat-comuni"]) {
          const href = await page.$eval(`main [data-source="${id}"] a`, (el) => el.getAttribute("href"));
          assert.match(href ?? "", /^https:\/\//, `fonte ${id} senza link`);
        }
        assert.equal(await page.$eval('main nav[aria-label="Percorso"] a', (el) => el.getAttribute("href")), "/parlamento");

        // Searchable list: unfiltered it holds every proposal and the page is indexable.
        assert.equal(await page.$eval("main [data-result-total]", (el) => el.getAttribute("data-result-total")), "6558");
        assert.equal((await page.$$("main tr[data-row]")).length, 25);
        assert.equal(await page.$('meta[name="robots"][content*="noindex"]'), null, "la pagina base non deve essere noindex");

        // Keyboard: the long list is a focusable scroll region.
        const region = await page.$('main [role="region"][aria-labelledby="elenco-comuni"]');
        assert.ok(region, "manca la regione scorrevole dell'elenco");
        await region.focus();
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-labelledby")), "elenco-comuni");

        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
          "overflow orizzontale",
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("main h1");
        assert.equal(errors.length, 0, `Console/page errors: ${errors.join(" | ")}`);
      },
    });
    console.log(`PASS manovra-emendamenti ${width}px`);
  }

  const total = (page) => page.$eval("main [data-result-total]", (el) => Number(el.getAttribute("data-result-total")));
  const filtered = [
    // [query string, check on the total, check on every row text]
    ["?esito=materia", (value) => value === 625, /estraneità di materia/],
    ["?esito=copertura", (value) => value === 1060, /compensazione/],
    ["?esito=parzialmente_inammissibile", (value) => value === 36, /In parte inammissibile/],
    ["?q=PESCIA&comune=1", (value) => value >= 3, /Pescia/],
    ["?q=85.0100", (value) => value === 1, /Il Governo/],
    // Unknown values fall back to the full list instead of failing.
    ["?gruppo=inesistente&esito=approvato&pagina=abc", (value) => value === 6558, /./],
    ["?pagina=99999", (value) => value === 6558, /./],
  ];
  for (const [search, expectTotal, rowPattern] of filtered) {
    await runScenario(browser, {
      suite: "manovra-emendamenti",
      label: `Elenco ${search}`,
      pathname: `/parlamento/emendamenti${search}`,
      width: 390,
      async validate(page) {
        const value = await total(page);
        assert.ok(expectTotal(value), `${search}: totale inatteso ${value}`);
        const rows = await page.$$eval("main tr[data-row]", (nodes) => nodes.map((node) => node.textContent ?? ""));
        assert.ok(rows.length > 0 && rows.length <= 25, `${search}: righe ${rows.length}`);
        for (const row of rows) assert.match(row, rowPattern, search);
        assert.ok(await page.$('meta[name="robots"][content*="noindex"]'), `${search}: manca noindex`);
        assert.equal(await page.$eval('link[rel="canonical"]', (el) => new URL(el.href).search), "", "canonical con parametri");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "overflow orizzontale");
      },
    });
    console.log(`PASS elenco ${search}`);
  }

  await runScenario(browser, {
    suite: "manovra-emendamenti",
    label: "Elenco senza risultati e ricerca da tastiera",
    pathname: "/parlamento/emendamenti?q=zzzznessuno",
    width: 1280,
    async validate(page) {
      assert.equal(await total(page), 0);
      assert.match(await page.$eval("main [data-result-total]", (el) => el.textContent ?? ""), /Nessuna proposta corrisponde/);
      assert.equal((await page.$$("main tr[data-row]")).length, 0);
      // Keyboard only: type in the search field and submit with Enter.
      const field = 'main form[role="search"] input[name="q"]';
      await page.$eval(field, (el) => { el.value = ""; el.focus(); });
      await page.keyboard.type("Furfaro");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => location.search.includes("q=Furfaro"), { timeout: 15_000 });
      await page.waitForSelector("main tr[data-row]");
      assert.ok((await total(page)) > 0, "la ricerca per firmatario non trova nulla");
      const names = await page.$$eval("main tr[data-row] td:nth-of-type(1)", (cells) => cells.map((cell) => cell.textContent ?? ""));
      for (const name of names) assert.match(name, /Furfaro/);
      // Next page keeps the filters.
      const next = await page.$('main nav[aria-label="Pagine dell\'elenco"] a[rel="next"]');
      if (next) assert.match((await next.evaluate((el) => el.getAttribute("href"))) ?? "", /q=Furfaro.*pagina=2/);
    },
  });
  console.log("PASS elenco vuoto e tastiera");

  await runScenario(browser, {
    suite: "manovra-emendamenti",
    label: "Manovra collega gli emendamenti",
    pathname: "/manovra",
    width: 1280,
    async validate(page) {
      // /manovra needs its own payload: without it the page shows its "not available" state and has no hero links.
      if (/temporaneamente non disponibili/i.test(await page.$eval("main", (el) => el.innerText))) {
        console.log("NOT RUN manovra link: payload del Bilancio in Breve assente in questo ambiente");
        return;
      }
      assert.ok(await page.$('main a[href="/parlamento/emendamenti"]'), "manca il link agli emendamenti");
      console.log("PASS manovra link");
    },
  });
} finally {
  await closeBrowser(browser);
}
