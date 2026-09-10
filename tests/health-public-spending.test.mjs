import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { buildHealthHistory, getHealthPublicSpendingView, parseHealthYear } = await import("../src/lib/health-public-spending.ts");
const { queryEurostatCofog, eurostatCofogMetadata } = await import("../src/lib/eurostat-cofog-snapshot.ts");
const { buildHomeItalyFunnel } = await import("../src/lib/home-italy-funnel.ts");

test("health history reconciles every year with the canonical GF07 source and home", () => {
  const view = getHealthPublicSpendingView();
  assert.deepEqual(view.history, queryEurostatCofog({ geo: "IT", function: "GF07" }).observations);
  assert.deepEqual(view.metadata.semantics, eurostatCofogMetadata.semantics);
  assert.equal(view.selected.year, 2024);
  assert.equal(view.history.length, 11);
  for (const point of view.history) {
    const selected = getHealthPublicSpendingView(point.year).selected;
    const home = buildHomeItalyFunnel(point.year).pa.slices.find((row) => row.id === "GF07");
    assert.equal(home.amountEuro, selected.amountCents / 100);
    assert.equal(home.href, `/spese/sanita?anno=${point.year}`);
  }
  assert.equal(view.history[0].amountCents, 11526100000000);
  assert.equal(view.selected.amountCents, 14607500000000);
});

test("health preserves published zeros and source flags", () => {
  const input = structuredClone(queryEurostatCofog({ geo: "IT", function: "GF07" }));
  input.observations[0].amountCents = 0;
  input.observations[0].shareOfGdpHundredths = 0;
  input.observations[1].flag = "b";
  input.observations.at(-1).flag = "p";
  const history = buildHealthHistory(input);
  assert.equal(history[0].amountCents, 0);
  assert.equal(history[0].shareOfGdpHundredths, 0);
  assert.equal(history[1].flag, "b");
  assert.equal(history.at(-1).flag, "p");
});

test("health rejects gaps, duplicate years and foreign function or geography", () => {
  for (const mutate of [
    (input) => input.observations.pop(),
    (input) => { input.observations[1] = { ...input.observations[0] }; },
    (input) => { input.observations[0].geo = "FR"; },
    (input) => { input.observations[0].function = "GF02"; },
  ]) {
    const input = structuredClone(queryEurostatCofog({ geo: "IT", function: "GF07" }));
    mutate(input);
    assert.throws(() => buildHealthHistory(input), /incompleta o inattesa/);
  }
});

test("health rejects ambiguous and unavailable year selections", () => {
  assert.equal(parseHealthYear(undefined), 2024);
  assert.equal(parseHealthYear("2014"), 2014);
  for (const value of ["", "2013", "2025", "2024x", "2024.0", " 2024", ["2024"], ["2014", "2024"]]) {
    assert.equal(parseHealthYear(value), null);
  }
  for (const year of [2013, 2025, NaN, 2024.5]) {
    assert.throws(() => getHealthPublicSpendingView(year), /anno COFOG non disponibile/);
  }
});
