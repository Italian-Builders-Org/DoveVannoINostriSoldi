import assert from "node:assert/strict";
import test from "node:test";
import cameraFixture from "./fixtures/institutional/camera-dossier.json" with { type: "json" };
import senateFixture from "./fixtures/institutional/senato-dossier.json" with { type: "json" };
import {
  assertInstitutionalDossier,
  compareInstitutionalFacts,
} from "../src/lib/data/institutional-contract.ts";

test("institutional dossiers preserve verified facts and honest metadata-only coverage", () => {
  const camera = assertInstitutionalDossier(cameraFixture);
  const senate = assertInstitutionalDossier(senateFixture);

  assert.equal(camera.facts[0].quantity.value, 94_362_520_000);
  assert.equal(camera.facts[0].frame.measure, "payment");
  assert.equal(senate.coverage.kind, "metadata-only");
  assert.deepEqual(senate.facts, []);
});

test("metadata-only and not-integrated dossiers cannot publish numeric facts", () => {
  assert.throws(
    () => assertInstitutionalDossier({ ...senateFixture, facts: cameraFixture.facts }),
    /vietati con copertura metadata-only/,
  );
});

test("facts only compare when period, unit and accounting frame coincide", () => {
  const fact = assertInstitutionalDossier(cameraFixture).facts[0];
  assert.deepEqual(compareInstitutionalFacts(fact, structuredClone(fact)), { ok: true });
  assert.deepEqual(
    compareInstitutionalFacts(fact, { ...fact, frame: { ...fact.frame, basis: "competence" } }),
    { ok: false, reason: "Il perimetro o la base contabile non coincidono." },
  );
  assert.deepEqual(
    compareInstitutionalFacts(fact, { ...fact, period: { kind: "financial-year", year: 2024 } }),
    { ok: false, reason: "I periodi di riferimento sono diversi." },
  );
});

test("dossiers fail closed on unsafe amounts and broken evidence references", () => {
  assert.throws(
    () => assertInstitutionalDossier({
      ...cameraFixture,
      facts: [{ ...cameraFixture.facts[0], quantity: { value: Number.MAX_SAFE_INTEGER + 1, unit: "euro-cents" } }],
    }),
    /intero sicuro atteso/,
  );
  assert.throws(
    () => assertInstitutionalDossier({
      ...cameraFixture,
      facts: [{ ...cameraFixture.facts[0], evidenceId: "missing" }],
    }),
    /riferimento a fonte inesistente/,
  );
});
