import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  offsetFromPage,
  pageCountFromTotal,
  pageFromOffset,
  paginationWindow,
} = await import("../src/lib/pagination.ts");

const { INTEGRATED_DOMAIN_LABELS, integratedDomainLabel } = await import(
  "../src/lib/integrated-domains.ts"
);

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("page arithmetic round-trips between offset and page number", () => {
  assert.equal(pageFromOffset(0, 50), 1);
  assert.equal(pageFromOffset(50, 50), 2);
  assert.equal(pageFromOffset(159_450, 50), 3_190);
  assert.equal(offsetFromPage(1, 50), 0);
  assert.equal(offsetFromPage(3_190, 50), 159_450);
  for (const page of [1, 2, 17, 640, 3_190]) {
    assert.equal(pageFromOffset(offsetFromPage(page, 50), 50), page);
  }
});

test("page arithmetic refuses to invent a page from unusable input", () => {
  assert.equal(pageCountFromTotal(0, 50), 0);
  assert.equal(pageCountFromTotal(120, 0), 0);
  assert.equal(pageCountFromTotal(Number.NaN, 50), 0);
  assert.equal(pageFromOffset(-10, 50), 1);
  assert.equal(offsetFromPage(0, 50), 0);
  assert.equal(offsetFromPage(-4, 50), 0);
});

test("a partial last page still counts as a page", () => {
  assert.equal(pageCountFromTotal(159_493, 50), 3_190);
  assert.equal(pageCountFromTotal(50, 50), 1);
  assert.equal(pageCountFromTotal(51, 50), 2);
});

test("the window keeps both ends of the list reachable", () => {
  assert.deepEqual(paginationWindow(1, 1), []);
  assert.deepEqual(paginationWindow(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(paginationWindow(1, 3_190), [1, 2, 3, "gap", 3_190]);
  assert.deepEqual(paginationWindow(3_190, 3_190), [1, "gap", 3_188, 3_189, 3_190]);
  assert.deepEqual(
    paginationWindow(1_600, 3_190),
    [1, "gap", 1_598, 1_599, 1_600, 1_601, 1_602, "gap", 3_190],
  );
});

test("a gap never stands in for a single page", () => {
  // Page 4 of 8 leaves exactly page 7 between the window and the last anchor:
  // eliding one number to draw an ellipsis the same width helps nobody, so the
  // number is drawn instead.
  assert.deepEqual(paginationWindow(4, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(paginationWindow(5, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(paginationWindow(8, 20), [1, "gap", 6, 7, 8, 9, 10, "gap", 20]);
  for (const steps of [paginationWindow(4, 8), paginationWindow(5, 9), paginationWindow(6, 11)]) {
    const numbers = steps.filter((step) => step !== "gap");
    for (let index = 0; index < steps.length; index += 1) {
      if (steps[index] !== "gap") continue;
      assert.ok(
        steps[index + 1] - steps[index - 1] > 2,
        `un salto copre una sola pagina: ${JSON.stringify(steps)}`,
      );
    }
    assert.equal(new Set(numbers).size, numbers.length, "pagina ripetuta nella finestra");
  }
});

test("the window clamps a page number outside the list", () => {
  assert.deepEqual(paginationWindow(0, 5), paginationWindow(1, 5));
  assert.deepEqual(paginationWindow(99, 5), paginationWindow(5, 5));
});

test("every paginated public view uses the one shared control", async () => {
  const pages = [
    "../src/app/dati/[dataset]/page.tsx",
    "../src/app/fonti/catalogo/page.tsx",
    "../src/app/spese/consulenze/page.tsx",
    "../src/app/spese/territoriale/page.tsx",
    "../src/app/territori/confronto/page.tsx",
  ];
  for (const path of pages) {
    const content = await source(path);
    assert.match(content, /import Pagination from "@\/components\/pagination"/, path);
    assert.match(content, /<Pagination\b/, path);
    assert.doesNotMatch(content, /Pagina precedente<\/Link>|← Pagina precedente/, path);
  }
});

test("the pagination control names its pages and keeps its targets tappable", async () => {
  const [component, css] = await Promise.all([
    source("../src/components/pagination.tsx"),
    source("../src/components/pagination.module.css"),
  ]);
  assert.match(component, /aria-label=\{`Pagina \$\{integer\(step\)\}`\}/);
  assert.match(component, /aria-current=\{step === current \? "page" : undefined\}/);
  assert.match(component, /rel="prev"/);
  assert.match(component, /rel="next"/);
  assert.match(component, /if \(pageCount <= 1\) return null;/);
  assert.match(css, /min-width: 44px;\s*\n\s*min-height: 44px;/);
  assert.doesNotMatch(css, /border-radius\s*:/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i);
});

test("the dataset views paginate by a readable page number", async () => {
  for (const path of [
    "../src/app/dati/[dataset]/page.tsx",
    "../src/app/fonti/catalogo/page.tsx",
    "../src/app/spese/territoriale/page.tsx",
  ]) {
    const content = await source(path);
    assert.match(content, /search\.pagina|params\.pagina|pageParam: "pagina"/, path);
    assert.match(content, /offsetFromPage/, path);
  }
});

test("integrated domains carry an Italian label for every domain in the catalogue", async () => {
  const catalog = JSON.parse(
    await readFile(new URL("../src/data/generated/integrated/catalog.json", import.meta.url), "utf8"),
  );
  const domains = new Set(catalog.datasets.map((dataset) => dataset.domain));
  for (const domain of domains) {
    assert.ok(
      Object.hasOwn(INTEGRATED_DOMAIN_LABELS, domain),
      `dominio senza etichetta italiana: ${domain}`,
    );
    assert.doesNotMatch(integratedDomainLabel(domain), /^[a-z-]+$/, domain);
  }
});
