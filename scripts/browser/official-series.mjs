import assert from "node:assert/strict";
import cofog from "../../src/data/generated/eurostat-cofog-2014-2024.data.json" with { type: "json" };
import scorecard from "../../src/data/generated/government-scorecard-page.json" with { type: "json" };

async function assertShell(page) {
  const state = await page.evaluate(() => ({
    viewport: innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    headings: document.querySelectorAll("main h1").length,
  }));
  assert.equal(state.headings, 1);
  assert.ok(state.root <= state.viewport + 1 && state.body <= state.viewport + 1, JSON.stringify(state));
}

async function submit(page, ids) {
  for (let index = 0; index < 4; index++) await page.select(`#serie-${index + 1}`, ids[index] ?? "");
  await page.focus('main button[type="submit"]');
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.keyboard.press("Enter")]);
  assert.deepEqual(new URL(page.url()).searchParams.getAll("serie").filter(Boolean), ids);
  await assertShell(page);
}

/** Exercise the actual SSR form, semantic rejection and accessible data view. */
export async function inspectOfficialSeries(page) {
  await page.waitForSelector('main a[href="/esplora/serie"]');
  await page.focus('main a[href="/esplora/serie"]');
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-testid="series-comparison"]');
  await assertShell(page);
  assert.match(await page.$eval("main h1", (element) => element.textContent), /Confronta serie ufficiali/);
  assert.equal(await page.$$eval('[data-testid="series-source"]', (elements) => elements.length), 2);
  assert.equal(await page.$$eval('[data-testid="series-chart"] polyline', (elements) => elements.length) >= 2, true);
  const rows = await page.$$eval('[data-testid="series-table"] tbody tr', (elements) => elements.map((row) => ({
    period: row.cells[0].textContent,
    values: [...row.querySelectorAll("[data-value]")].map((element) => Number(element.dataset.value)),
  })));
  assert.equal(rows.length, 11);
  for (const row of rows) {
    assert.deepEqual(row.values, ["GF02", "GF03"].map((code) => cofog.observations.find((point) => point.geo === "IT" && point.function === code && point.year === Number(row.period)).amountCents / 100_000_000));
  }
  const region = '[role="region"][aria-label="Valori delle serie a confronto"]';
  await page.focus(region);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Valori delle serie a confronto");

  const ids = ["hicp-IT", "hicp-FR", "hicp-DE", "hicp-ES"];
  await submit(page, ids);
  await page.waitForSelector('[data-testid="series-comparison"]');
  assert.equal(await page.$$eval('[data-testid="series-source"]', (elements) => elements.length), 4);
  const inflation = scorecard.series.find((series) => series.indicator_id === "inflation");
  const actual = await page.$$eval('[data-testid="series-table"] tbody tr', (elements) => elements.map((row) => ({
    period: row.cells[0].textContent,
    values: [...row.querySelectorAll("[data-value]")].map((element) => Number(element.dataset.value)),
  })));
  assert.equal(actual.length, 356);
  for (const row of actual) assert.deepEqual(row.values, ["IT", "FR", "DE", "ES"].map((geo) => inflation.geographies.find((entry) => entry.geography === geo).points.find((point) => point.period === row.period)?.value));
  assert.match(await page.$eval('[data-testid="series-table"] tbody tr:last-child', (element) => element.textContent), /Stimato dalla fonte/);
  const sources = await page.$$eval('[data-testid="series-source"]', (elements) => elements.map((element) => ({
    text: element.textContent,
    url: element.querySelector('a[href*="databrowser"]').href,
  })));
  for (const source of sources) {
    assert.match(source.text, /Eurostat/);
    assert.match(source.text, /1997-01 al 2026-08/);
    assert.match(source.text, /% rispetto allo stesso mese/);
    assert.match(source.url, /prc_hicp_minr/);
  }
  const disclosure = '[data-testid="series-source"] details';
  await page.focus(`${disclosure} summary`);
  await page.keyboard.press("Enter");
  assert.equal(await page.$eval(disclosure, (element) => element.open), true);
  const hash = scorecard.sources.find((source) => source.id === "eurostat:prc_hicp_minr").raw_sha256;
  assert.equal(await page.$eval(`${disclosure} code`, (element) => element.textContent), hash);

  await submit(page, ["hicp-IT", "cofog-GF02-MIO_EUR"]);
  await page.waitForSelector('[data-testid="series-warning"]');
  assert.match(await page.$eval('[data-testid="series-warning"]', (element) => element.textContent), /unités?|unità|frequenza/i);
  assert.equal(await page.$('[data-testid="series-chart"]'), null);
  assert.equal(await page.$('[data-testid="series-table"]'), null);
  assert.equal(await page.$$eval('[data-testid="series-source"]', (elements) => elements.length), 2);

  // One viewport covers URL tampering; every viewport above drives the form.
  if (page.viewport().width === 390) {
    for (const query of [
      "serie=unknown&serie=hicp-IT",
      "serie=hicp-IT&serie=hicp-IT",
      "serie=hicp-IT",
      "serie=hicp-IT&serie=hicp-FR&serie=hicp-DE&serie=hicp-ES&serie=cofog-GF02-MIO_EUR",
    ]) {
      await page.goto(new URL(`/esplora/serie?${query}`, page.url()).href, { waitUntil: "networkidle2" });
      await page.waitForSelector('[data-testid="series-warning"]');
      assert.equal(await page.$('[data-testid="series-chart"]'), null);
      await assertShell(page);
    }
    await submit(page, ["cofog-GF02-PC_GDP", "cofog-GF03-PC_GDP"]);
    await page.reload({ waitUntil: "networkidle2" });
    assert.equal(await page.$eval("#serie-1", (element) => element.value), "cofog-GF02-PC_GDP");
    assert.match(await page.$eval('[data-testid="series-comparison"]', (element) => element.textContent), /% del PIL/);
    await assertShell(page);
  }
}
