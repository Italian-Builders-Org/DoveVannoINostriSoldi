import assert from "node:assert/strict";

export async function inspectUniversityResearch(page) {
  assert.equal(await page.$eval("h1", (heading) => heading.textContent), "Università e Ricerca");
  const text = await page.$eval("main", (main) => main.innerText);
  assert.match(text, /non pagamenti effettuati/);
  assert.match(text, /enti non universitari/);
  assert.match(text, /non corretti per l’inflazione/);
  assert.equal(await page.$$eval("main figure li", (rows) => rows.length), 20);
  if (page.viewport().width > 700) {
    const chartTops = await page.$$eval("main figure", (charts) => charts.map((chart) => chart.getBoundingClientRect().top));
    assert.ok(Math.abs(chartTops[0] - chartTops[1]) <= 1, "Le serie affiancate devono allineare gli anni");
  }

  const tableSummary = await page.$(".chart-data > summary");
  await tableSummary.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".chart-data[open] tbody tr");
  const rows = await page.$$eval(".chart-data tbody tr", (rows) => rows.map((row) => row.innerText));
  assert.equal(rows.length, 10);
  assert.match(rows[0], /2017.*7\.936\.106\.705.*2\.761\.236\.019/s);
  assert.match(rows.at(-1), /2026.*11\.432\.211\.698.*4\.254\.614\.396/s);
  const region = await page.$(".chart-data [role=region]");
  await region.focus();
  assert.equal(await region.evaluate((element) => document.activeElement === element), true);

  const limits = await page.$("#fonti details > summary");
  await limits.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#fonti details[open]");
  assert.match(await page.$eval("#fonti details", (details) => details.innerText), /FFO.*PRIN.*PNRR/s);
  assert.ok(await page.$('#fonti a[href^="https://bdap-opendata.rgs.mef.gov.it/"]'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
}
