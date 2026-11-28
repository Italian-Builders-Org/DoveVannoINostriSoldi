import assert from "node:assert/strict";
import {
  waitForSsnHistoryStoricoCharts,
} from "./ssn-storico-ready.mjs";

// Covers snapshot-backed Recharts through public callers. State spending,
// administrations and datasets reuse SpendingBarChart, exercised with the
// committed vincitori dataset so a live OpenBDAP outage cannot fail this gate.
// /enti draws its IPA type distribution as an HTML bar list, not Recharts:
// inspectRegistryTypeList below covers it.
export const RECHARTS_ROUTES = [
  ["/debito", 1], ["/spese/sanita/storico", 2], ["/coesione", 1],
  ["/istruzione", 1], ["/studi/2026-08", 2], ["/dati/vincitori", 1],
  ["/spese/sanita", 1], ["/palazzo-chigi", 1], ["/ministeri", 1],
  ["/regioni", 1], ["/spese/legge-di-bilancio", 2],
];

export async function inspectRecharts(page, minimumCharts, { pathname = null } = {}) {
  if (pathname === "/spese/sanita/storico" && minimumCharts >= 2) {
    await waitForSsnHistoryStoricoCharts(page, minimumCharts);
  } else {
    // Some callers (notably /enti) still hit a live registry. When that budget
    // expires the panel stays empty on purpose — do not treat it as a chart bug.
    await page.waitForFunction((minimum) => {
      if (document.querySelectorAll(".recharts-wrapper svg").length >= minimum) return true;
      return /Distribuzione non disponibile dalla fonte IPA|non è disponibile ora/i.test(
        document.body?.innerText ?? "",
      );
    }, { timeout: 45_000 }, minimumCharts);
  }

  const charts = await page.$$(".recharts-wrapper");
  if (charts.length < minimumCharts) {
    assert.ok(
      await page.evaluate(() => /Distribuzione non disponibile dalla fonte IPA|non è disponibile ora/i.test(document.body?.innerText ?? "")),
      `attesi almeno ${minimumCharts} grafici Recharts`,
    );
    return;
  }
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

// /enti: the live IPA registry either fills the type list (every row a label,
// a figure and a bar no wider than its track) or the page says the
// distribution is unavailable. An empty panel with neither is the bug.
export async function inspectRegistryTypeList(page) {
  const list = 'ol[aria-label="Enti del registro IPA per tipologia"]';
  await page.waitForFunction((selector) => document.querySelector(selector)
    || /non è disponibile ora/i.test(document.body?.innerText ?? ""), { timeout: 45_000 }, list);
  if (!(await page.$(list))) return;
  const rows = await page.$$eval(`${list} > li`, (items) => items.map((item) => {
    const track = item.querySelector("i")?.getBoundingClientRect();
    const bar = item.querySelector("i > b")?.getBoundingClientRect();
    return {
      label: item.querySelector("span")?.textContent?.trim() ?? "",
      value: item.querySelector("strong")?.textContent?.trim() ?? "",
      fits: Boolean(track && bar && bar.width <= track.width + 1),
    };
  }));
  assert.ok(rows.length >= 1, "/enti: lista delle tipologie IPA vuota");
  for (const row of rows) {
    assert.ok(row.label, "/enti: tipologia senza nome");
    assert.match(row.value, /^\d{1,3}(\.\d{3})*$/, `/enti: ${row.label} senza cifra`);
    assert.ok(row.fits, `/enti: la barra di ${row.label} esce dalla traccia`);
  }
}
