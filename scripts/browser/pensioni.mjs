import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeBrowser,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  runScenario,
  waitForServer,
} from "./harness.mjs";

async function inspectPensions(page) {
  assert.match(await page.$eval("h1", (heading) => heading.textContent ?? ""), /Pensioni e pensionati/);
  const text = await page.$eval("main", (main) => main.innerText);
  assert.match(text, /16\.305\.880/);
  assert.match(text, /23\.015\.011/);
  assert.match(text, /Casellario continua dopo ISTAT/i);
  assert.match(text, /Osservatorio INPS/i);
  assert.match(text, /21\.257\.999/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

  const tableText = await page.$eval(
    'section[aria-labelledby="casellario-progress-title"] table',
    (table) => table.innerText,
  );
  assert.match(tableText, /2024/);
  assert.match(tableText, /2023/);
  assert.match(tableText, /2022/);
  assert.match(tableText, /Osservatorio INPS/);
  assert.match(tableText, /ISTAT/);

  const region = await page.$('section[aria-labelledby="casellario-progress-title"] [role="region"]');
  assert.ok(region, "regione scorrevole della tabella Casellario");
  await region.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "region");

  const api = await page.evaluate(async () => {
    const response = await fetch("/api/spese/pensioni?anno=2022");
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(api.status, 200);
  assert.equal(api.payload.inpsCasellarioSistema.stock.pensionerCount, 16_305_880);
  assert.equal(api.payload.inpsCasellarioSistema.series.observations.length, 2);

  const directory = path.join(defaultArtifactsDir(), "pensioni", `${page.viewport().width}px`);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, "casellario-pr.png"), fullPage: false });
  await page.screenshot({ path: path.join(directory, "casellario.png"), fullPage: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await waitForServer(defaultBaseUrl());
  const browser = await launchBrowser();
  try {
    for (const width of [1280, 390]) {
      await runScenario(browser, {
        label: `pensioni ${width}px`,
        pathname: "/spese/pensioni",
        width,
        validate: inspectPensions,
        suite: "pensioni",
      });
      console.log(`PASS pensioni ${width}px`);
    }
  } finally {
    await closeBrowser(browser);
  }
}
