import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../src/data/generated/parliament-overview.json" with { type: "json" };
import { assertParliamentSnapshot } from "../src/lib/data/parliament-contract.ts";

test("Parliament snapshot keeps accounts, budgets and official provenance separate", () => {
  const parsed = assertParliamentSnapshot(snapshot);
  const camera = parsed.chambers.find((chamber) => chamber.id === "camera");
  const quirinale = parsed.chambers.find((chamber) => chamber.id === "quirinale");

  assert.equal(camera.structuredStatus, "structured-summary");
  assert.ok(camera.statements.filter((statement) => statement.kind === "account").length >= 6);
  assert.ok(camera.statements.some((statement) => statement.kind === "budget"));
  assert.ok(quirinale, "quirinale atteso nello snapshot");
  assert.ok(
    quirinale.statements.some((statement) =>
      statement.title.toLocaleLowerCase("it-IT").includes("serie della dotazione"),
    ),
  );
  assert.ok(
    parsed.chambers.every((chamber) =>
      chamber.statements.every(
        (statement) => statement.values || statement.categories || statement.highlights,
      ),
    ),
  );
  assert.match(parsed.methodology.comparability, /non vengono sommati/i);

  const account = camera.statements.find(
    (statement) => statement.kind === "account" && statement.year === 2025,
  );
  const pensions = account.categories.find((category) => category.id === "pensions");
  assert.equal(pensions.paid, 418.22631632);
  assert.equal(
    pensions.components.reduce((total, component) => total + component.paid, 0),
    pensions.paid,
  );
  assert.doesNotMatch(pensions.label, /vitalizi/i);
  assert.match(pensions.caveat, /non equivale ai soli vitalizi/i);

  const goods = account.categories.find((category) => category.id === "goods-services");
  assert.ok(Math.abs(goods.paid - 61.4846849) < 1e-9);
  assert.equal(
    Number(goods.components.reduce((total, component) => total + component.paid, 0).toFixed(8)),
    goods.paid,
  );
  assert.ok(goods.components.some((component) => component.id === "cap-1045"));
  assert.ok(goods.components.some((component) => component.id === "other-chapters"));
  assert.match(goods.caveat, /Altri capitoli/i);

  for (const category of account.categories) {
    assert.ok(category.caveat, `${category.id}: nota semantica attesa`);
    if (!category.components?.length) continue;
    const componentTotal = category.components.reduce((total, component) => total + component.paid, 0);
    assert.ok(
      Math.abs(componentTotal - category.paid) <= 0.000001,
      `${category.id}: componenti non riconciliate`,
    );
  }
  assert.ok(account.categories.filter((category) => category.components?.length).length >= 7);

  const account2024 = camera.statements.find(
    (statement) => statement.kind === "account" && statement.year === 2024,
  );
  assert.equal(account2024.values.effectivePayments, 843.2);
  assert.equal(account2024.values.totalCommitments, 1263.8);
  assert.ok(account2024.categories?.length >= 8, "2024: dettaglio per categoria atteso");
  const categorySum2024 = account2024.categories.reduce((total, item) => total + item.paid, 0);
  assert.ok(
    Math.abs(categorySum2024 - account2024.values.effectivePayments) <=
      (account2024.categoryReconciliationTolerance ?? 0),
  );

  const account2023 = camera.statements.find(
    (statement) => statement.kind === "account" && statement.year === 2023,
  );
  assert.ok(account2023.categories?.length >= 8, "2023: dettaglio per categoria atteso");

  const account2020 = camera.statements.find(
    (statement) => statement.kind === "account" && statement.year === 2020,
  );
  assert.ok(!account2020.categories, "2020-2022: solo totali finché il layout PDF verticale non è riconciliato");
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
  brokenPensionBreakdown.chambers[0].statements
    .find((statement) => statement.kind === "account" && statement.year === 2025)
    .categories.find((category) => category.id === "pensions").components[0].paid += 1;
  assert.throws(
    () => assertParliamentSnapshot(brokenPensionBreakdown),
    /componenti non riconciliate/,
  );

  const mislabeledPensions = structuredClone(snapshot);
  mislabeledPensions.chambers[0].statements
    .find((statement) => statement.kind === "account" && statement.year === 2025)
    .categories.find((category) => category.id === "pensions").label = "Vitalizi";
  assert.throws(
    () => assertParliamentSnapshot(mislabeledPensions),
    /non può essere rinominato vitalizi/,
  );
});
