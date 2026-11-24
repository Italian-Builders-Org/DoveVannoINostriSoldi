import assert from "node:assert/strict";

/** Allineato a navigation.mjs: OpenBDAP può impiegare fino a ~50s prima del fallback. */
export const SSN_STORICO_READY_TIMEOUT_MS = 75_000;

export const SSN_STORICO_CHART_TIMEOUT_MS = 45_000;

function storicoReadyPredicate() {
  if (location.pathname !== "/spese/sanita/storico") return false;
  const title = document.querySelector("main h1")?.textContent ?? "";
  if (!/Serie storica/.test(title)) return false;
  const years = [...document.querySelectorAll("main table tbody tr th")].map(
    (cell) => cell.textContent?.trim(),
  );
  if (years.includes("2012") && years.includes("2024")) return true;
  return Boolean(document.querySelector("main [role='alert']"));
}

export async function waitForSsnHistoryStoricoPage(page, { timeout = SSN_STORICO_READY_TIMEOUT_MS } = {}) {
  await page.waitForFunction(storicoReadyPredicate, { timeout, polling: 250 });
}

export async function assertSsnHistoryStoricoContent(page) {
  const alert = await page.$("main [role='alert']");
  if (alert) {
    const message = await page.evaluate((element) => element.textContent?.trim(), alert);
    assert.fail(`Serie storica sanità non disponibile: ${message ?? "errore sconosciuto"}`);
  }
  assert.match(await page.$eval("main h1", (element) => element.textContent), /Serie storica/);
  const years = await page.$$eval("main table tbody tr th", (elements) =>
    elements.map((element) => element.textContent?.trim()),
  );
  assert.ok(years.includes("2012") && years.includes("2024"), `Anni storico incompleti: ${years.join(", ")}`);
}

export async function waitForSsnHistoryStoricoCharts(page, minimumCharts, { timeout = SSN_STORICO_CHART_TIMEOUT_MS } = {}) {
  await waitForSsnHistoryStoricoPage(page);
  await assertSsnHistoryStoricoContent(page);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[class*="panelCard"] .chart, main .recharts-wrapper')) {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    }
  });
  await page.waitForFunction((minimum) => {
    const wrappers = [...document.querySelectorAll(".recharts-wrapper")];
    const withSvg = wrappers.filter((wrapper) => wrapper.querySelector("svg"));
    if (withSvg.length < minimum) return false;
    return withSvg.every((wrapper) => {
      const box = wrapper.getBoundingClientRect();
      return box.width > 2 && box.height > 2;
    });
  }, { timeout, polling: 250 }, minimumCharts);
}