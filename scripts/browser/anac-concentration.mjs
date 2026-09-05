import assert from "node:assert/strict";
import { navigate } from "./harness.mjs";

export async function inspectAnacConcentration(page) {
  const links = await page.$$eval('a[href*="view=concentration"]', (nodes) => [...new Set(nodes.map((node) => node.href))]);
  assert.equal(links.length, 6, "Top 1, Top 10 and HHI must link to both count and value cohorts");
  for (const url of links) {
    await navigate(page, { url, readySelector: "#concentration-detail-title" });
    const text = await page.$eval("main", (node) => node.innerText);
    assert.match(text, /Peso della selezione/);
    assert.match(text, /denominatore completo/);
    assert.match(text, /non indicano illecito/);
    assert.match(text, /Relazioni selezionate/i);
    const region = await page.$('[role="region"][aria-label="Aggiudicazioni ANAC"]');
    await region.focus();
    assert.equal(await region.evaluate((node) => document.activeElement === node), true);
    assert.ok(await page.$('tbody a[href*="dettaglio_cig"]'));
    const values = await page.$$eval("tbody tr", (rows) => rows.map((row) => row.innerText));
    assert.ok(values.length > 0 && values.length <= 25);
    if (new URL(url).searchParams.get("metric") === "value") {
      assert.ok(values.every((row) => /aggiudicatario singolo.*importo positivo/.test(row)), "Value cohort excludes unallocated and non-positive amounts");
      assert.match(text, /Importi esatti in euro/);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, url);
    const summary = await page.$("main details > summary");
    if (summary) {
      assert.ok((await summary.boundingBox()).height >= 44);
      await summary.focus();
      await page.keyboard.press("Enter");
      assert.equal(await summary.evaluate((node) => node.parentElement.open), true);
      assert.ok(await page.$('main details[open] a[href*="view=operator"]'));
    }
    const params = new URL(url).searchParams;
    const paginationLinks = await page.$$eval('nav[aria-label="Paginazione"] a', (nodes) => nodes.map((node) => node.href));
    for (const link of paginationLinks) {
      const next = new URL(link).searchParams;
      assert.equal(next.get("view"), "concentration");
      assert.equal(next.get("metric"), params.get("metric"));
      assert.equal(next.get("selection"), params.get("selection"));
    }
  }
  // Exercise server navigation, including pagination and page-size changes.
  const url = new URL(links.find((link) => link.includes("selection=all") && link.includes("metric=count")));
  url.searchParams.set("page", "999999");
  await navigate(page, { url: url.href, readySelector: "#concentration-detail-title" });
  const pager = await page.$eval('nav[aria-label="Paginazione"]', (node) => node.innerText);
  const match = pager.match(/Pagina (\d+) di (\d+)/);
  assert.equal(match[1], match[2], "An out-of-range page clamps inside the filtered cohort");
  const sizeLink = await page.$('a[href*="view=concentration"][href*="pageSize=50"]');
  const largerUrl = await sizeLink.evaluate((node) => node.href);
  assert.equal(new URL(largerUrl).searchParams.get("selection"), "all");
  await navigate(page, { url: largerUrl, readySelector: "#concentration-detail-title" });
  assert.equal(await page.$$eval("tbody tr", (rows) => rows.length), 50);
  if (page.viewport().width === 1280) {
    for (const query of ["metric=invalid&selection=all", "metric=value&selection=top1&selection=all", "metric=count&selection=all&operator=op-000001", "metric=count&selection=all&cpv=123"]) {
      const response = await fetch(new URL(`/enti/c_h501/appalti?view=concentration&${query}`, url));
      assert.equal(response.status, 404, query);
      await response.arrayBuffer();
    }
  }
}
