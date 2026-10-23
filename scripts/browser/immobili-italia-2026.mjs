import assert from "node:assert/strict";

const utilRows = '[aria-label="Utilizzo immobiliare per provincia"] tbody tr';
const tabRows = '[aria-label="Celle tabelle AdE immobili 2026"] tbody tr';

async function paginateSection(page, nextLabel, rowSelector, statusTestId) {
  const first = await page.$$eval(`${rowSelector} td:first-child`, (cells) => cells.map((cell) => cell.textContent));
  assert.ok(first.length > 0);
  const statusBefore = await page.$eval(`[data-testid="${statusTestId}"]`, (node) => node.textContent);
  const matched = Number(statusBefore.match(/su ([0-9.]+)/)?.[1]?.replace(/\./g, "") ?? "0");
  assert.ok(matched > 25);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click(`nav[aria-label="${nextLabel}"] a[href*="cursor="]`),
  ]);
  const second = await page.$$eval(`${rowSelector} td:first-child`, (cells) => cells.map((cell) => cell.textContent));
  assert.notDeepEqual(first, second);
  return matched;
}

export async function inspectImmobiliItalia2026(page) {
  assert.match(await page.$eval("h1", (node) => node.textContent), /Gli immobili in Italia/);
  assert.equal(await page.$eval('[data-testid="ade-imu-2024-mld"]', (node) => node.textContent), "20,98");
  await page.waitForSelector("#prelievo .recharts-line-curve", { visible: true });
  assert.ok((await page.$$("#prelievo .recharts-line-curve")).length >= 2);

  await page.select("#u-cat", "abitazioni");
  await page.$eval("#u-prov", (input) => {
    input.value = "AG";
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('#utilizzo button[type="submit"]'),
  ]);
  assert.match(await page.$eval('[data-testid="utilizzo-status"]', (node) => node.textContent), /AG|16632/);
  const agMatched = await paginateSection(
    page,
    "Paginazione utilizzo provincia",
    utilRows,
    "utilizzo-status",
  );
  const utilApi = await page.evaluate(async () => {
    const response = await fetch("/api/dati/ade-immobili-utilizzo-provincia-2023?q=AG&limit=100");
    if (!response.ok) throw new Error(`API utilizzo ${response.status}`);
    return response.json();
  });
  assert.equal(utilApi.dataset.publicRows, 16632);
  assert.ok(utilApi.rows.length > 0);

  await page.$eval("#t-id", (input) => {
    input.value = "2026_04_01_05";
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('#tabelle button[type="submit"]'),
  ]);
  await paginateSection(page, "Paginazione tabelle AdE", tabRows, "tabelle-status");
  const tabApi = await page.evaluate(async () => {
    const response = await fetch("/api/dati/ade-immobili-tabelle-2026?q=2026_04_01_05&limit=25");
    if (!response.ok) throw new Error(`API tabelle ${response.status}`);
    return response.json();
  });
  assert.equal(tabApi.dataset.publicRows, 3033);
  assert.ok(tabApi.rows.length > 0);

  await page.focus("#fonti details > summary");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#fonti details[open] li", { visible: true });
  const landing = await page.$eval('#fonti a[href="https://www.agenziaentrate.gov.it/portale/gli-immobili-in-italia-2026"]', (node) => node.href);
  assert.equal(landing, "https://www.agenziaentrate.gov.it/portale/gli-immobili-in-italia-2026");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  console.log(`PASS Immobili Italia 2026 ${page.viewport().width}px: IMU, prelievo, ${agMatched} righe AG, tabelle API`);
}
