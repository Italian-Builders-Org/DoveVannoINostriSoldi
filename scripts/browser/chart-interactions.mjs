import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario } from "./harness.mjs";
import { inspectRecharts, RECHARTS_ROUTES } from "./recharts-interactions.mjs";

const baseUrl = defaultBaseUrl();
const chronology = JSON.parse(readFileSync(new URL("../etl/specs/government-scorecard-chronology.json", import.meta.url), "utf8"));

export async function inspectGovernmentChart(page, card) {
  const svg = await card.$('svg[tabindex="0"]');
  if (!svg) return;
  const id = await card.evaluate((element) => element.dataset.slideId);
  const read = () => card.evaluate((element) => ({
    id: element.dataset.slideId,
    period: element.querySelector('[role="status"] strong').textContent,
    summaries: [...element.querySelectorAll('[data-series-summary]')].map((summary) => ({
      period: summary.querySelector('[data-selected-period]')?.textContent,
      value: summary.querySelector('[data-selected-value]')?.textContent,
      change: summary.querySelector('[data-selected-change]')?.textContent,
    })),
    periods: [...element.querySelectorAll('thead th')].slice(1, -1).map((cell) => cell.textContent),
    rows: [...element.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent)),
  }));
  await svg.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
  });
  for (const key of ["Home", "ArrowRight", "End", "ArrowLeft"]) {
    const previous = await read();
    const currentIndex = previous.periods.indexOf(previous.period);
    const expectedIndex = key === "Home" ? 0 : key === "End" ? previous.periods.length - 1
      : Math.max(0, Math.min(previous.periods.length - 1, currentIndex + (key === "ArrowRight" ? 1 : -1)));
    await page.keyboard.press(key);
    await page.waitForFunction((element, expectedPeriod) =>
      element.querySelector('[role="status"] strong')?.textContent === expectedPeriod,
    { timeout: 3_000 }, card, previous.periods[expectedIndex]);
    const state = await read();
    assert.equal(state.id, id, `${id}: i tasti del grafico cambiano indicatore`);
    assert.equal(state.summaries.length, 4, `${id}: riepiloghi della selezione assenti`);
    const index = state.periods.indexOf(state.period);
    assert.ok(index >= 0);
    if (key === "Home") assert.equal(index, 0);
    if (key === "End") assert.equal(index, state.periods.length - 1);
    for (const [countryIndex, summary] of state.summaries.entries()) {
      const observations = state.rows[countryIndex].slice(0, -1).filter((value) => value !== "Non disponibile");
      if (observations.length === 0) {
        assert.equal(summary.value, undefined);
        continue;
      }
      assert.ok(summary.period.includes(state.period), `${id}: riepilogo fermo su un altro periodo`);
      assert.equal(summary.value, state.rows[countryIndex][index], `${id}: valore diverso dalla tabella`);
      const number = (value) => Number(value.split(" · ")[0].replaceAll(".", "").replace(",", "."));
      const first = observations[0];
      if (summary.value !== "Non disponibile" && observations.length >= 2) {
        const tolerance = (await card.evaluate((element) => element.textContent.includes("Valori: Euro"))) ? 1 : 0.02;
        assert.ok(Math.abs(number(summary.change) - (number(summary.value) - number(first))) <= tolerance,
          `${id}: variazione incoerente con il valore selezionato`);
      } else assert.equal(summary.change, "Non disponibile");
    }
  }
  // Real pointer coordinates in the SVG viewBox, including its responsive transform.
  const target = await svg.evaluate((element) => {
    const point = element.createSVGPoint();
    point.x = 62;
    point.y = 120;
    const screen = point.matrixTransform(element.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  if ((await page.viewport()).hasTouch) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.move(target.x, target.y);
  await page.waitForFunction((slideId) => {
    const element = document.querySelector(`[data-slide-id="${slideId}"]`);
    return element.querySelector('[role="status"] strong').textContent === element.querySelector('thead th:nth-child(2)').textContent;
  }, {}, id);
  const pointerState = await read();
  assert.ok(pointerState.summaries.every((summary) => summary.period === undefined || summary.period.includes(pointerState.period)), `${id}: puntatore e riepilogo non sincronizzati`);
}

const browser = await launchBrowser();
try {
  const scenarios = [390, 768, 1280].map((width) => ({ width, id: "berlusconi-iv" }));
  for (const government of chronology.governments) {
    if (government.id !== "berlusconi-iv") scenarios.push({ width: 1280, id: government.id });
  }
  for (const { width, id } of scenarios) {
    await runScenario(browser, {
      suite: "chart-interactions", label: `government-chart-${id}-${width}`, pathname: `/governi/${id}`, width, baseUrl, waitUntil: "networkidle2",
      validate: async (page) => {
        await page.waitForSelector('[data-slide-id]');
        await inspectGovernmentChart(page, await page.$('[data-slide-id]'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent === "Vista elenco").click());
        await page.waitForSelector('[data-view="list"]');
        for (const scope of ["Mandato", "Serie completa"]) {
          await page.evaluate((text) => [...document.querySelectorAll('button')].find((button) => button.textContent === text).click(), scope);
          for (const card of await page.$$('[data-slide-id]')) await inspectGovernmentChart(page, card);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "overflow della pagina");
      },
    });
    console.log(`PASS government chart interactions ${id} ${width}px`);
  }
  for (const width of [390, 768, 1280]) {
    for (const [pathname, minimumCharts] of RECHARTS_ROUTES) {
      await runScenario(browser, {
        suite: "chart-interactions", label: `chart-${pathname}-${width}`, pathname, width, baseUrl,
        validate: (page) => inspectRecharts(page, minimumCharts),
      });
      console.log(`PASS chart interactions ${pathname} ${width}px`);
    }
  }
} finally { await closeBrowser(browser); }
