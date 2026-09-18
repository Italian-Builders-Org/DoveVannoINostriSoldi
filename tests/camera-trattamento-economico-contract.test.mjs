import assert from "node:assert/strict";
import test from "node:test";
import treatmentJson from "../src/data/generated/camera-trattamento-economico.json" with { type: "json" };
import "./helpers/register-ts-alias.mjs";

const { formatEuroFromCents, parseCameraTrattamentoEconomicoSnapshot } = await import(
  "../src/lib/data/camera-trattamento-economico-contract.ts"
);
const { getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");

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
