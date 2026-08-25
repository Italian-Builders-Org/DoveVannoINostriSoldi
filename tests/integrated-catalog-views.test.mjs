import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  activeCatalogConstraintCount,
  catalogQueryHref,
  catalogViewHref,
  groupPriorityDatasets,
  isPriorityDataset,
  matchesCatalogFilters,
  matchesCatalogSearch,
  parseCatalogQuery,
  parseCatalogSearch,
  parseCatalogView,
  relatedReadingForDataset,
} = await import("../src/lib/integrated-catalog-views.ts");

test("catalog views default to priority and keep unknown values fail-closed", () => {
  assert.equal(parseCatalogView(undefined), "priorita");
  assert.equal(parseCatalogView("ambito"), "ambito");
  assert.equal(parseCatalogView("tutti"), "tutti");
  assert.equal(parseCatalogView(["tutti", "ambito"]), "tutti");
  assert.equal(parseCatalogView("altro"), "priorita");
  assert.equal(catalogViewHref("priorita"), "/dati");
  assert.equal(catalogViewHref("tutti"), "/dati?vista=tutti");
});

test("catalog filters compose into stable query strings", () => {
  const query = parseCatalogQuery({
    vista: "ambito",
    evidenza: "missing-data",
    pubblicazione: "catalog-only",
    riuso: "non-dichiarato",
  });
  assert.deepEqual(query, {
    view: "ambito",
    filters: {
      evidence: "missing-data",
      publication: "catalog-only",
      undeclaredReuse: true,
    },
    q: null,
  });
  assert.equal(
    catalogQueryHref(query),
    "/dati?vista=ambito&evidenza=missing-data&pubblicazione=catalog-only&riuso=non-dichiarato",
  );
  assert.equal(
    parseCatalogQuery({ evidenza: "altro", pubblicazione: "xyz", riuso: "si" }).filters.evidence,
    null,
  );
  assert.equal(
    matchesCatalogFilters(
      {
        id: "x",
        domain: "procurement",
        evidenceLabel: "missing-data",
        licenseStatus: "not-declared",
        publication: "catalog-only",
      },
      query.filters,
    ),
    true,
  );
  assert.equal(
    matchesCatalogFilters(
      {
        id: "y",
        domain: "procurement",
        evidenceLabel: "documented-fact",
        licenseStatus: "not-declared",
        publication: "catalog-only",
      },
      query.filters,
    ),
    false,
  );
});

test("catalog search parses cerca, preserves it in hrefs, and matches title/ambito/teaser", () => {
  assert.equal(parseCatalogSearch("  Acme   Spa  "), "Acme Spa");
  assert.equal(parseCatalogSearch("   "), null);
  assert.equal(parseCatalogSearch("x".repeat(100)).length, 80);

  const withSearch = parseCatalogQuery({
    vista: "tutti",
    cerca: "vincitori",
  });
  assert.equal(withSearch.q, "vincitori");
  assert.equal(
    catalogQueryHref(withSearch),
    "/dati?vista=tutti&cerca=vincitori",
  );
  assert.equal(
    catalogViewHref("ambito", withSearch.filters, withSearch.q),
    "/dati?vista=ambito&cerca=vincitori",
  );
  assert.equal(parseCatalogQuery({ q: "alias" }).q, "alias");
  assert.equal(activeCatalogConstraintCount(withSearch), 1);
  assert.equal(
    activeCatalogConstraintCount({
      ...withSearch,
      filters: { ...withSearch.filters, evidence: "missing-data" },
    }),
    2,
  );

  const dataset = {
    id: "vincitori",
    domain: "procurement",
    evidenceLabel: "documented-fact",
    licenseStatus: "open",
    publication: "rows",
    title: "Fornitori per settore e importo",
    authority: "ANAC",
  };
  assert.equal(matchesCatalogSearch(dataset, "fornitori"), true);
  assert.equal(matchesCatalogSearch(dataset, "appalti", { domainLabel: "Appalti" }), true);
  assert.equal(
    matchesCatalogSearch(dataset, "acme", { teaserLine: "Acme S.p.A. · 1,2 mln €" }),
    true,
  );
  assert.equal(matchesCatalogSearch(dataset, "inesistente"), false);
  assert.equal(matchesCatalogSearch(dataset, ""), true);
});

test("priority groups use existing evidence labels without inventing medians", async () => {
  const catalog = JSON.parse(
    await readFile(new URL("../src/data/generated/integrated/catalog.json", import.meta.url), "utf8"),
  );
  const hot = catalog.datasets.filter(isPriorityDataset);
  assert.equal(hot.length, 27);
  assert.ok(hot.every((dataset) => dataset.evidenceLabel !== "documented-fact"));
  const groups = groupPriorityDatasets(hot);
  assert.deepEqual(
    groups.map((group) => group.evidenceLabel),
    ["needs-explanation", "missing-data"],
  );
  assert.equal(
    groups.reduce((sum, group) => sum + group.datasets.length, 0),
    27,
  );
  assert.equal(
    relatedReadingForDataset({ id: "benchmark-consulenze", domain: "benchmarks" }).href,
    "/confronti/catalogo",
  );
  assert.equal(
    relatedReadingForDataset({ id: "segnalazioni", domain: "evidence" }).href,
    "/controlli/segnalazioni",
  );
  assert.equal(
    relatedReadingForDataset({ id: "fuori-consip", domain: "procurement" }).href,
    "/appalti/consip-da-confrontare",
  );
});

test("priority catalog puts readable numbers before coverage gaps", async () => {
  const catalog = JSON.parse(
    await readFile(new URL("../src/data/generated/integrated/catalog.json", import.meta.url), "utf8"),
  );
  const { partitionPriorityCatalog, hasReadableNumbers } = await import(
    "../src/lib/integrated-catalog-views.ts"
  );
  const split = partitionPriorityCatalog(
    catalog.datasets.map((dataset) => ({
      ...dataset,
      queryable: dataset.publication === "rows" || dataset.publication === "source-index",
      headers: dataset.headers,
      publicRows: dataset.publicRows,
    })),
    { evidence: null, publication: null, undeclaredReuse: false },
  );
  assert.ok(split.readable.length > 0);
  assert.ok(split.readable.every((dataset) => hasReadableNumbers(dataset)));
  assert.ok(split.readable.some((dataset) => dataset.id === "vincitori"));
  assert.ok(split.missing.every((dataset) => !hasReadableNumbers(dataset)));
  assert.ok(split.missing.some((dataset) => dataset.id === "benchmark-consulenze"));
});

test("dati page wires views, filters and reading links without median inventing", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/app/dati/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dati/dati.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /parseCatalogQuery/);
  assert.match(page, /matchesCatalogFilters/);
  assert.match(page, /matchesCatalogSearch/);
  assert.match(page, /partitionPriorityCatalog/);
  assert.match(page, /filterBar/);
  assert.match(page, /searchBar/);
  assert.match(page, /name="cerca"/);
  assert.match(page, /readableVisible/);
  assert.match(page, /missingVisible/);
  assert.match(page, /Da controllare/);
  assert.match(page, /Numeri da leggere/);
  assert.match(page, /Cosa manca ancora/);
  assert.match(page, /cardTeaser|Primo destinatario|loadDatasetInsightTeasers/);
  assert.match(page, /Solo non dichiarato/);
  assert.match(page, /relatedReadingForDataset/);
  assert.match(page, /href="\/controlli"/);
  assert.match(page, /href="\/confronti"/);
  assert.doesNotMatch(page, /mediana di mercato sul catalogo/i);
  assert.match(css, /\.filterBar \{/);
  assert.match(css, /\.searchBar \{/);
  assert.match(css, /\.filterGroup a\[aria-current="page"\]/);
});

test("home and controlli expose the recipients CTA into /dati", async () => {
  const [home, controlli] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/controlli/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /Vedi chi ha ricevuto di più/);
  assert.match(home, /href="\/dati"/);
  assert.match(controlli, /Vedi chi ha ricevuto di più/);
  assert.match(controlli, /href="\/dati"/);
  assert.match(controlli, /href="\/appalti\/fornitori"/);
});
