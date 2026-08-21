import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../src/data/generated/parliament-overview.json" with { type: "json" };
import { assertParliamentSnapshot } from "../src/lib/data/parliament-contract.ts";

test("Parliament snapshot keeps accounts, budgets and official provenance separate", () => {
  const parsed = assertParliamentSnapshot(snapshot);
  const camera = parsed.chambers.find((chamber) => chamber.id === "camera");

  assert.equal(camera.structuredStatus, "structured-summary");
  assert.ok(camera.statements.some((statement) => statement.kind === "account"));
  assert.ok(camera.statements.some((statement) => statement.kind === "budget"));
  assert.ok(
    parsed.chambers.every((chamber) =>
      chamber.statements.every(
        (statement) => statement.values || statement.categories || statement.highlights,
      ),
    ),
  );
  assert.match(parsed.methodology.comparability, /non vengono sommati/i);

  const account = camera.statements.find((statement) => statement.kind === "account");
  const pensions = account.categories.find((category) => category.id === "pensions");
  assert.equal(pensions.paid, 418.22631632);
  assert.equal(
    pensions.components.reduce((total, component) => total + component.paid, 0),
    pensions.paid,
  );
  assert.doesNotMatch(pensions.label, /vitalizi/i);
  assert.match(pensions.caveat, /non equivale ai soli vitalizi/i);
});

test("Parliament snapshot rejects unofficial and document-only entries", () => {
  const unofficial = structuredClone(snapshot);
  unofficial.chambers[0].statements[0].documentUrl = "https://example.com/bilancio.pdf";
  assert.throws(() => assertParliamentSnapshot(unofficial), /ufficiale/);

  const documentOnly = structuredClone(snapshot);
  delete documentOnly.chambers[0].statements[0].values;
  delete documentOnly.chambers[0].statements[0].categories;
  assert.throws(() => assertParliamentSnapshot(documentOnly), /valori strutturati/);

  const sourceOnly = structuredClone(snapshot);
  sourceOnly.chambers[0].structuredStatus = "source-documents-only";
  assert.throws(() => assertParliamentSnapshot(sourceOnly), /soltanto dati strutturati/);

  const emptyValues = structuredClone(snapshot);
  emptyValues.chambers[0].statements[0].values = {};
  emptyValues.chambers[0].statements[0].categories = [];
  assert.throws(() => assertParliamentSnapshot(emptyValues), /valori strutturati/);

  const brokenPensionBreakdown = structuredClone(snapshot);
  brokenPensionBreakdown.chambers[0].statements[0].categories
    .find((category) => category.id === "pensions").components[0].paid += 1;
  assert.throws(
    () => assertParliamentSnapshot(brokenPensionBreakdown),
    /componenti non riconciliate/,
  );

  const mislabeledPensions = structuredClone(snapshot);
  mislabeledPensions.chambers[0].statements[0].categories
    .find((category) => category.id === "pensions").label = "Vitalizi";
  assert.throws(
    () => assertParliamentSnapshot(mislabeledPensions),
    /non può essere rinominato vitalizi/,
  );
});
