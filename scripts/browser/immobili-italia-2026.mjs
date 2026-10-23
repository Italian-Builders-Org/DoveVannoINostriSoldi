import assert from "node:assert/strict";

export async function inspectImmobiliItalia2026(page) {
  assert.match(await page.$eval("h1", (node) => node.textContent), /Gli immobili in Italia/);
  assert.equal(await page.$eval('[data-testid="ade-imu-2024-mld"]', (node) => node.textContent), "20,98");
  await page.waitForSelector("#prelievo .recharts-line-curve", { visible: true });
  assert.ok((await page.$$("#prelievo .recharts-line-curve")).length >= 2);

  assert.match(await page.$eval("#stock h2", (node) => node.textContent), /abitazioni/i);
  assert.ok((await page.$$("#stock [role='listitem']")).length >= 4);

  assert.equal((await page.$$('[data-testid="macro-aree"] article')).length, 3);
  assert.match(await page.$eval('[data-testid="macro-aree"]', (node) => node.textContent), /Nord/);
  assert.match(await page.$eval('[data-testid="macro-aree"]', (node) => node.textContent), /Sud/);
  assert.match(await page.$eval('[data-testid="macro-aree"]', (node) => node.textContent), /Pertinenze/);
  assert.match(
    await page.$eval('[data-testid="macro-aree"]', (node) => node.textContent),
    /Non in dichiarazione/,
  );

  assert.match(await page.$eval('[data-testid="valore-regioni"] tbody tr:first-child th', (node) => node.textContent), /Lombardia/);
  assert.ok((await page.$$('[data-testid="valore-regioni"] tbody tr')).length === 20);

  assert.match(await page.$eval('[data-testid="proprietari"]', (node) => node.textContent), /Fino a 10\.000/);
  assert.match(await page.$eval('[data-testid="proprietari"]', (node) => node.textContent), /Dipendente/);
  assert.match(await page.$eval('[data-testid="proprietari"]', (node) => node.textContent), /Fabbricati/);

  const provinceUrl = new URL(page.url());
  provinceUrl.searchParams.set("prov", "AG");
  provinceUrl.hash = "provincia";
  await page.goto(provinceUrl.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="utilizzo-status"] h3', { timeout: 90000 });
  assert.match(await page.$eval('[data-testid="utilizzo-status"] h3', (node) => node.textContent), /AG/);
  assert.ok((await page.$$('[data-testid="utilizzo-status"] [role="listitem"]')).length >= 3);

  const utilApi = await page.evaluate(async () => {
    const response = await fetch("/api/dati/ade-immobili-utilizzo-provincia-2023?q=AG&limit=100");
    if (!response.ok) throw new Error(`API utilizzo ${response.status}`);
    return response.json();
  });
  assert.equal(utilApi.dataset.publicRows, 16632);
  assert.ok(utilApi.rows.length > 0);

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
  const landing = await page.$eval(
    '#fonti a[href="https://www.agenziaentrate.gov.it/portale/gli-immobili-in-italia-2026"]',
    (node) => node.href,
  );
  assert.equal(landing, "https://www.agenziaentrate.gov.it/portale/gli-immobili-in-italia-2026");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  console.log(`PASS Immobili Italia 2026 ${page.viewport().width}px: narrative, aree, VSM, proprietari, AG`);
}
