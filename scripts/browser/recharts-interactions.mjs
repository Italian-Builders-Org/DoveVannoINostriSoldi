import assert from "node:assert/strict";

// Covers snapshot-backed Recharts through public callers. State spending,
// administrations and datasets reuse SpendingBarChart, exercised with the
// committed vincitori dataset so a live OpenBDAP outage cannot fail this gate.
export const RECHARTS_ROUTES = [
  ["/debito", 1], ["/spese/sanita/storico", 2], ["/coesione", 1],
  ["/istruzione", 1], ["/report/2026-08", 2], ["/dati/vincitori", 1], ["/enti", 1],
  ["/spese/sanita", 1], ["/palazzo-chigi", 1], ["/ministeri", 1],
  ["/regioni", 1], ["/spese/legge-di-bilancio", 2],
];

export async function inspectRecharts(page, minimumCharts) {
  await page.waitForFunction((minimum) => document.querySelectorAll('.recharts-wrapper svg').length >= minimum, {}, minimumCharts);
  const charts = await page.$$(".recharts-wrapper");
  for (const [index, chart] of charts.entries()) {
    await chart.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    const targets = await chart.evaluate((element) => {
      const bars = [...element.querySelectorAll(".recharts-bar-rectangle path")];
      const tiles = [...element.querySelectorAll(".recharts-treemap-depth-1 rect")];
      const marks = bars.length ? bars : tiles;
      if (marks.length) return marks.map((mark) => {
        const box = mark.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 + scrollY, width: box.width, height: box.height };
      }).filter((box) => box.width > 2 && box.height > 2).slice(0, 3);
      const grid = element.querySelector(".recharts-cartesian-grid");
      if (!grid) return [];
      const box = grid.getBoundingClientRect();
      return [0.15, 0.5, 0.85].map((ratio) => ({ x: box.x + box.width * ratio, y: box.y + box.height / 2 + scrollY }));
    });
    assert.ok(targets.length >= 2, `grafico ${index}: almeno due punti da controllare`);
    const texts = [];
    for (const target of targets) {
      // Tall rankings exceed the viewport. Bring each mark below the sticky
      // header before sending actual input, instead of hovering the header.
      const position = await page.evaluate((point) => {
        window.scrollTo({ top: point.y - innerHeight / 2, behavior: "instant" });
        return { x: point.x, y: point.y - scrollY };
      }, target);
      if ((await page.viewport()).hasTouch) await page.touchscreen.tap(position.x, position.y);
      else await page.mouse.move(position.x, position.y);
      await page.waitForFunction((element) => {
        const tooltip = element.querySelector(".recharts-tooltip-wrapper");
        return tooltip && getComputedStyle(tooltip).visibility === "visible" && tooltip.textContent.length > 0;
      }, {}, chart);
      texts.push(await chart.evaluate((element) => element.querySelector(".recharts-tooltip-wrapper").textContent));
    }
    assert.ok(new Set(texts).size >= 2, `grafico ${index}: il contenuto non segue il punto selezionato`);
  }
}
