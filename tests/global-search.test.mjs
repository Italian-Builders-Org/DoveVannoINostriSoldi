import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  normalizeSearchText,
  rankSearchDocuments,
  searchSiteDocuments,
} = await import("../src/lib/global-search.ts");

test("global search folds accents, case and punctuation into stable tokens", () => {
  assert.equal(normalizeSearchText("  Sanità — È già qui!  "), "sanita e gia qui");
  assert.equal(normalizeSearchText("Ministero_dell'Interno"), "ministero dell interno");
});

test("global search matches title words regardless of their order", () => {
  const results = searchSiteDocuments("pubblico debito");
  const debt = results.find((result) => result.href === "/debito");

  assert.ok(debt, "the public-debt page should be discoverable by reordered words");
  assert.equal(debt.match.reason, "title-tokens");
});

test("title matches outrank aliases and descriptions with an explicit reason", () => {
  const documents = [
    {
      id: "description",
      href: "/description",
      title: "Quadro nazionale",
      context: "Pagine",
      type: "pagina",
      aliases: [],
      description: "Pagamenti pubblici spiegati in modo semplice",
    },
    {
      id: "alias",
      href: "/alias",
      title: "Registro",
      context: "Pagine",
      type: "pagina",
      aliases: ["pagamenti pubblici"],
      description: null,
    },
    {
      id: "title",
      href: "/title",
      title: "Pagamenti pubblici",
      context: "Pagine",
      type: "pagina",
      aliases: [],
      description: null,
    },
  ];
  const results = rankSearchDocuments(documents, "pagamenti pubblici");

  assert.deepEqual(results.map((result) => result.id), ["title", "alias", "description"]);
  assert.equal(results[0].match.label, "Titolo esatto");
  assert.equal(results[1].match.label, "Alias o sinonimo");
  assert.equal(results[2].match.label, "Descrizione");
});

test("site search has no duplicate destinations and exposes useful Italian aliases", () => {
  const results = searchSiteDocuments("consulenze");
  const hrefs = results.map((result) => result.href);

  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(results.some((result) => result.href === "/incarichi"));
  assert.ok(results.some((result) => result.href === "/spese/consulenze"));
  assert.ok(searchSiteDocuments("pnrr").some((result) => result.href === "/coesione"));
});
