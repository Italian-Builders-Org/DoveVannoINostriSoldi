import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultArtifactsDir, defaultBaseUrl } from "./harness.mjs";

const exactEuro = (amount) => new Intl.NumberFormat("it-IT", {
  style: "currency", currency: "EUR", maximumFractionDigits: 2, useGrouping: "always",
}).format(amount);

export async function inspectHealthHistory(page) {
  const entry = 'main a[href="/spese/sanita?anno=2014"]';
  await page.focus(entry);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/spese/sanita");
  await page.waitForSelector('[data-testid="health-total"]');
  assert.equal(new URL(page.url()).searchParams.get("anno"), "2014");
  assert.equal(await page.$$eval("main h1", (elements) => elements.length), 1);
  const series = await page.evaluate(async () => {
    const response = await fetch("/api/spese/cofog?paese=IT&funzione=GF07");
    if (!response.ok) throw new Error(`Sanità COFOG API: ${response.status}`);
    return response.json();
  });
  assert.equal(series.observations.length, 11);
  assert.ok(series.observations.every((point) => point.geo === "IT" && point.function === "GF07"));

  const hierarchy = await page.evaluate(() => {
    const top = (selector) => document.querySelector(selector).getBoundingClientRect().top;
    const svg = document.querySelector('svg[aria-labelledby="health-chart-title health-chart-desc"]');
    const list = document.querySelector('ol[aria-label="Spesa PA per la sanità per anno"]');
    return {
      width: innerWidth,
      historyFirst: top("#health-history-title") < top("#ssn-accounting-title"),
      linkFirst: top('main header a[href="/spese/sanita/storico"]') < top("#health-history-title"),
      svgVisible: getComputedStyle(svg).display !== "none",
      listVisible: getComputedStyle(list).display !== "none",
      target: document.querySelector("#health-year").getBoundingClientRect().height,
    };
  });
  assert.ok(hierarchy.historyFirst && hierarchy.linkFirst, "History must precede SSN detail tables");
  assert.equal(hierarchy.svgVisible, hierarchy.width > 620);
  assert.equal(hierarchy.listVisible, hierarchy.width <= 620);
  assert.ok(hierarchy.target >= 44);

  await page.focus('[data-testid="health-annual"] summary');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="health-annual"]').open);
  const rows = await page.$$eval('[data-testid="health-annual"] tbody tr', (elements) => elements.map((row) => [...row.cells].map((cell) => cell.textContent)));
  for (const point of series.observations) {
    const row = rows.find((row) => row[0] === String(point.year));
    assert.equal(row?.[1], exactEuro(point.amountCents / 100));
    assert.ok(row?.[2].includes(new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(point.shareOfGdpHundredths / 100)));
  }
  const table = '[data-testid="health-annual"] .table-scroll';
  await page.focus(table);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "region");
  if (await page.$eval(table, (element) => element.scrollWidth > element.clientWidth)) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((selector) => document.querySelector(selector).scrollLeft > 0, {}, table);
  }
  await page.focus("#fonti-sanita-pa > summary");
  await page.keyboard.press("Enter");
  assert.match(await page.$eval("#fonti-sanita-pa", (element) => element.innerText), /non vanno sommati/);
  assert.match(await page.$eval("#fonti-sanita-pa", (element) => element.innerText), /SHA-256/);

  for (const year of [2014, 2020, 2024]) {
    if (year !== 2014) {
      await page.select("#health-year", String(year));
      await page.focus('form[action="/spese/sanita"] button');
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
    }
    assert.equal(new URL(page.url()).searchParams.get("anno"), String(year));
    const expected = series.observations.find((point) => point.year === year);
    const summary = await page.$eval('section[aria-labelledby="health-total-title"]', (element) => element.textContent);
    assert.ok(summary.includes(exactEuro(expected.amountCents / 100)));
    const compact = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(expected.amountCents / 100_000_000_000);
    assert.equal(await page.$eval('[data-testid="health-total"]', (element) => element.textContent), `${compact} mld €`);
    const gdpShare = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(expected.shareOfGdpHundredths / 100);
    assert.ok(summary.includes(`${gdpShare}% del PIL`));
    assert.match(await page.$eval("#health-total-title", (element) => element.textContent), new RegExp(String(year)));
    assert.match(await page.$eval("#ssn-accounting-title", (element) => element.textContent), /2024/);
    assert.match(await page.$eval("#posti-letto", (element) => element.innerText), /1° gennaio 2023/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Sanità ${year}: overflow`);
  }
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(await page.$eval("#health-year", (element) => element.value), "2024");
  const theme = await page.$eval("html", (element) => element.dataset.theme);
  const directory = path.join(defaultArtifactsDir(), "health-history", `${theme}-${hierarchy.width}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "state.json"), JSON.stringify({ ...hierarchy, years: rows, theme }, null, 2));
  const chart = await page.$('section[aria-labelledby="health-history-title"]');
  await chart.screenshot({ path: path.join(directory, "history.png") });

  if ([390, 1280].includes(hierarchy.width)) {
    await page.focus('main header a[href="/spese/sanita/storico"]');
    await page.keyboard.press("Enter");
    // This route can spend up to 50s on OpenBDAP before its verified fallback.
    await page.waitForFunction(() => location.pathname === "/spese/sanita/storico", { timeout: 60_000 });
    await page.waitForSelector("main table", { timeout: 60_000 });
    assert.match(await page.$eval("main h1", (element) => element.textContent), /Serie storica/);
    const years = await page.$$eval("main table tbody tr th", (elements) => elements.map((element) => element.textContent));
    assert.ok(years.includes("2012") && years.includes("2024"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "SSN history: overflow");
  }
  console.log(`PASS Sanità history ${theme} ${hierarchy.width}px: home year, source values, keyboard, scope, reload, layout`);
}

export async function inspectInvalidHealthYears(baseUrl = defaultBaseUrl()) {
  for (const query of ["anno=", "anno=2013", "anno=2025", "anno=2024x", "anno=2024&anno=2023"]) {
    const response = await fetch(new URL(`/spese/sanita?${query}`, baseUrl));
    const html = await response.text();
    assert.ok(response.status === 404 || (response.status === 200 && /name="robots" content="noindex"/.test(html)), `invalid health selection ${query}`);
    assert.doesNotMatch(html, /data-testid="health-total"/);
  }
}
