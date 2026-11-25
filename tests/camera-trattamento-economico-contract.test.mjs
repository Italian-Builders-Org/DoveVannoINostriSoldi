import assert from "node:assert/strict";
import test from "node:test";
import treatmentJson from "../src/data/generated/camera-trattamento-economico.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { formatEuroFromCents, parseCameraTrattamentoEconomicoSnapshot } = await import(
  "../src/lib/data/camera-trattamento-economico-contract.ts"
);
const { getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");

function clone() {
  return structuredClone(treatmentJson);
}

test("camera treatment snapshot stays valid offline but is not shown on person cards", () => {
  const snapshot = parseCameraTrattamentoEconomicoSnapshot(treatmentJson);
  assert.equal(snapshot.soldi.present, true);
  assert.equal(snapshot.soldi.unit, "EUR-cent");
  assert.equal(snapshot.summary.indemnityGrossMonthlyCents, 1_043_500);
  assert.equal(formatEuroFromCents(1_043_500), "10.435,00 €");
  assert.ok(snapshot.provenance.gap.includes("Senato"));

  const profiles = getRepubblicaProfiles();
  assert.ok(!("economicTreatment" in profiles["dep-302103"]));
  assert.equal(
    Object.values(profiles).every((profile) => !("economicTreatment" in profile)),
    true,
  );
});

test("indemnity history runs from 2005 to the rate in force", () => {
  const snapshot = parseCameraTrattamentoEconomicoSnapshot(treatmentJson);
  const indemnity = snapshot.history.filter((step) => step.componentId === "indennita-parlamentare-lordo");
  assert.deepEqual(
    indemnity.map((step) => [step.fromYear, step.amountCents]),
    [[2005, 1_243_432], [2006, 1_170_364], [2011, 1_128_328], [2012, 1_043_500]],
  );
  assert.equal(snapshot.freeze.confirmedThroughYear, 2026);
});

test("contract rejects a history that does not end at the rate in force", () => {
  const raw = clone();
  const diaria = raw.history.filter((step) => step.componentId === "diaria").at(-1);
  diaria.amountCents += 100;
  diaria.amountEuro = "3.504,11";
  assert.throws(() => parseCameraTrattamentoEconomicoSnapshot(raw), /history/);
});

test("contract rejects history steps out of order", () => {
  const raw = clone();
  const indices = raw.history
    .map((step, index) => (step.componentId === "indennita-parlamentare-lordo" ? index : -1))
    .filter((index) => index >= 0);
  const [a, b] = [indices[1], indices[2]];
  [raw.history[a], raw.history[b]] = [raw.history[b], raw.history[a]];
  assert.throws(() => parseCameraTrattamentoEconomicoSnapshot(raw), /history/);
});

test("withholdings are typed apart from allowances", () => {
  const raw = clone();
  raw.components.find((item) => item.id === "trattenuta-assegno-fine-mandato").grossNet = "allowance";
  assert.throws(() => parseCameraTrattamentoEconomicoSnapshot(raw), /trattenuta/);
});
