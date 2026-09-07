import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { navigate } from "./harness.mjs";

export async function inspectAnacCpv(page) {
  const base = new URL(page.url());
  const width = page.viewport().width;
  const directory = "artifacts/browser/anac-cpv";
  await mkdir(directory, { recursive: true });
  const select = await page.$("#anac-cpv");
  assert.ok(select, "Verified classification must be available");
  assert.ok((await select.boundingBox()).height >= 44);
  await select.focus();
  assert.equal(await select.evaluate((node) => document.activeElement === node), true);
  await page.select("#anac-cpv", "85300000");
  const submit = await page.$('section[aria-labelledby="cpv-filter-title"] button[type="submit"]');
  assert.ok((await submit.boundingBox()).height >= 44);
  await submit.focus();
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
  assert.equal(new URL(page.url()).searchParams.get("cpv"), "85300000");
  assert.match(await page.$eval("#cpv-scope", (node) => node.innerText), /141 procedure su/);
  const summary = await page.$eval('section[aria-labelledby="summary-title"]', (node) => node.innerText);
  assert.match(summary, /Aggiudicazioni\s+114/i);
  assert.match(summary, /12\.082\.249,58/);
  assert.match(summary, /Operatori economici identificati\s+62/i);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: `${directory}/filtered-${width}.png`, fullPage: true });

  const localLinks = await page.$$eval('main a[href*="/appalti?"]', (nodes) => nodes.filter((node) => node.textContent.trim() !== "Rimuovi filtro").map((node) => node.href));
  for (const link of localLinks) assert.equal(new URL(link).searchParams.get("cpv"), "85300000", link);
  const concentration = [...new Set(localLinks.filter((link) => new URL(link).searchParams.get("view") === "concentration"))];
  assert.equal(concentration.length, 6);
  for (const url of concentration) {
    await navigate(page, { waitUntil: "networkidle0", url, readySelector: "#concentration-detail-title" });
    assert.match(await page.$eval("#cpv-scope", (node) => node.innerText), /141 procedure su/);
    assert.ok(await page.$("tbody tr"));
    const links = await page.$$eval('main a[href*="view=operator"], nav[aria-label="Paginazione"] a', (nodes) => nodes.map((node) => node.href));
    for (const link of links) assert.equal(new URL(link).searchParams.get("cpv"), "85300000");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  const procedures = new URL("/enti/c_h501/appalti?view=procedures&cpv=85300000", base);
  await navigate(page, { waitUntil: "networkidle0", url: procedures.href });
  const codes = await page.$$eval("tbody tr", (rows) => rows.map((row) => row.children[2].innerText));
  assert.equal(codes.length, 25);
  assert.ok(codes.every((code) => /^85300000(?:-[0-9])?$/.test(code)));
  await page.screenshot({ path: `${directory}/procedures-${width}.png`, fullPage: true });
  const next = await page.$eval('nav[aria-label="Paginazione"] a', (node) => node.href);
  assert.equal(new URL(next).searchParams.get("cpv"), "85300000");
  await navigate(page, { waitUntil: "networkidle0", url: next });
  assert.match(await page.$eval('nav[aria-label="Paginazione"]', (node) => node.innerText), /Pagina 2 di/);
  procedures.searchParams.set("pageSize", "50");
  await navigate(page, { waitUntil: "networkidle0", url: procedures.href });
  assert.equal(await page.$$eval("tbody tr", (rows) => rows.length), 50);
  for (const value of ["unclassified", "12345678"]) {
    const url = new URL(`/enti/c_h501/appalti?cpv=${value}`, base);
    await navigate(page, { waitUntil: "networkidle0", url: url.href });
    assert.match(await page.$eval("main", (node) => node.innerText), /Nessuna procedura per questo CPV/i);
    assert.match(await page.$eval("#cpv-scope", (node) => node.innerText), /0 procedure su/);
    assert.equal(await page.$eval("#anac-cpv", (node) => node.value), value);
  }
  const reset = await page.$$eval("main a", (nodes) => nodes.find((node) => node.textContent.trim() === "Rimuovi filtro").href);
  await navigate(page, { waitUntil: "networkidle0", url: reset });
  assert.equal(await page.$eval("#anac-cpv", (node) => node.value), "");
  if (width === 1280) {
    for (const query of ["cpv=85300000&cpv=45233141", "cpv=123", "cpv=00000000"]) {
      const response = await fetch(new URL(`/enti/c_h501/appalti?${query}`, base));
      assert.equal(response.status, 404);
      await response.arrayBuffer();
    }
  }
}
