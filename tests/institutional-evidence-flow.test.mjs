import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const routes = ["istituzioni", "parlamento", "palazzo-chigi", "ministeri", "regioni"];
const pages = Object.fromEntries(
  routes.map((route) => [
    route,
    fs.readFileSync(new URL(`../src/app/${route}/page.tsx`, import.meta.url), "utf8"),
  ]),
);

function stageIndex(page, stage) {
  return page.indexOf(`data-evidence-stage="${stage}"`);
}

test("institutional routes lead with scope and leave source panels last", () => {
  for (const [route, page] of Object.entries(pages)) {
    const scope = stageIndex(page, "scope");
    const source = stageIndex(page, "source");
    assert.ok(scope >= 0, `${route}: scope marker missing`);
    assert.ok(source > scope, `${route}: source panel must follow scope`);

    for (const stage of ["kpi", "visual", "detail"]) {
      const index = stageIndex(page, stage);
      if (index >= 0) {
        assert.ok(index > scope, `${route}: ${stage} must follow scope`);
        assert.ok(index < source, `${route}: ${stage} must precede sources`);
      }
    }
  }
});

test("data routes expose period, perimeter, unit and a complete final provenance panel", () => {
  const expectedScope = {
    parlamento: /Camera · consuntivi e bilanci verificati · milioni di euro/,
    "palazzo-chigi": /Rendiconto PCM 2024 · sola Presidenza del Consiglio · euro/,
    ministeri: /Consuntivo RGS 2025 · 15 Ministeri · competenza · euro/,
    regioni: /Consuntivi Istat 2024 · 22 amministrazioni · impegni · euro/,
  };

  for (const [route, pattern] of Object.entries(expectedScope)) {
    assert.match(pages[route], pattern, `${route}: incomplete visible scope`);
    assert.match(
      pages[route],
      /Font[ei], metodo, licenza, copertura e limiti/,
      `${route}: incomplete final provenance heading`,
    );
  }
});

test("Parliament remains metadata-only where numbers are unverified", () => {
  assert.match(pages.parlamento, /Solo metadati/);
  assert.match(pages.parlamento, /Numeri del PDF non verificati/);
  assert.doesNotMatch(pages.parlamento, /Quota del totale|style: "percent"/);
});
