import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { incomeIndicatorsFromDataset, INEQUALITY_DATASET_ID } = await import("../src/lib/inequality-page.ts");

function fixture() {
  return {
    dataset: { id: INEQUALITY_DATASET_ID, headers: ["Indicatore", "Anno rilevazione", "Anno redditi", "Valore", "Unità", "Stato", "URL fonte"], sourceMetadata: { checkedAt: "2026-09-12" } },
    pagination: { nextCursor: null, exhausted: true },
    rows: ["gini", "s80s20"].flatMap((key) => Array.from({ length: 12 }, (_, index) => ({
      cells: Object.fromEntries(["Indicatore", "Anno rilevazione", "Anno redditi", "Valore", "Unità", "Stato", "URL fonte"].map((header, column) => [header, [key, String(2014 + index), String(2013 + index), key === "gini" ? "31.0" : "5.13", key === "gini" ? "scala da 0 a 100" : "rapporto", "",
        `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${key === "gini" ? "ilc_di12" : "ilc_di11"}?geo=IT`][column]])),
    }))),
  };
}

test("survey and income years remain distinct, series sort chronologically and retain precision", () => {
  const input = fixture();
  input.rows.reverse();
  const [gini, ratio] = incomeIndicatorsFromDataset(input);
  assert.deepEqual(gini.points.at(-1), { surveyYear: 2025, incomeYear: 2024, value: 31, status: null, note: null });
  assert.equal(ratio.points.at(-1).value, 5.13);
  assert.equal(gini.points[0].incomeYear, 2013);
  assert.notEqual(gini.scaleLabel, ratio.scaleLabel);
});

test("zero, missing latest observation and a source break keep separate meanings", () => {
  const input = fixture();
  input.rows[0].cells["Valore"] = "0";
  input.rows[1].cells["Stato"] = "b";
  input.rows[11].cells["Valore"] = "";
  const [gini] = incomeIndicatorsFromDataset(input);
  assert.equal(gini.points[0].value, 0);
  assert.equal(gini.points[1].note, "Interruzione della serie");
  assert.equal(gini.points.at(-1).value, null);
  assert.equal(gini.points.at(-1).incomeYear, 2024);
  assert.equal(gini.points.at(-1).note, "Dato non disponibile");
});

test("incomplete corpus, duplicates, shifted periods and changed units fail closed", () => {
  for (const change of [
    (input) => { input.pagination.nextCursor = "next"; },
    (input) => { input.rows.pop(); },
    (input) => { input.rows[1] = structuredClone(input.rows[0]); },
    (input) => { input.rows[0].cells["Anno redditi"] = "2014"; },
    (input) => { input.rows[0].cells["Unità"] = "percentuale"; },
    (input) => { input.rows[0].cells["Valore"] = "101"; },
    (input) => { input.rows[0].cells["Valore"] = " "; },
    (input) => { input.rows[0].cells["Stato"] = "unknown"; },
    (input) => { input.rows[0].cells["URL fonte"] = "https://example.com/data"; },
  ]) {
    const input = fixture();
    change(input);
    assert.throws(() => incomeIndicatorsFromDataset(input), /Disuguaglianza:/);
  }
});

test("the public page reads the committed corpus values and source metadata", async () => {
  const { buildInequalityPageView } = await import("../src/lib/inequality-page.ts");
  const indicators = await buildInequalityPageView();
  assert.deepEqual(indicators.map((item) => item.points.at(-1).value), [31, 5.13]);
  assert.ok(indicators.every((item) => item.points.at(-1).incomeYear === 2024));
  assert.ok(indicators.every((item) => item.checkedAt === "2026-09-12"));
});
