import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  normalizeSearchText,
  rankSearchDocuments,
  rankEntitySearchResults,
  searchSiteDocuments,
} = await import("../src/lib/global-search.ts");

function document(overrides = {}) {
  return {
    id: "page:jesolo",
    href: "/jesolo",
    title: "Jesolo",
    context: "Pagine",
    type: "pagina",
    aliases: [],
    description: null,
    ...overrides,
  };
}

function entity(overrides = {}) {
  return {
    codiceIpa: "c_c388",
    denominazione: "COMUNE DI JESOLO",
    codiceFiscale: null,
    tipologia: "Comune",
    codiceCategoria: null,
    codiceNatura: null,
    codiceAteco: null,
    inLiquidazione: null,
    codiceMiur: null,
    codiceIstat: null,
    acronimo: null,
    responsabile: { nome: null, cognome: null, titolo: null },
    sede: {
      codiceComuneIstat: null,
      codiceCatastaleComune: null,
      cap: null,
      indirizzo: null,
    },
    email: [],
    sitoIstituzionale: null,
    social: { facebook: null, linkedin: null, twitter: null, youtube: null },
    dataAggiornamento: null,
    ...overrides,
  };
}

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

test("global search accepts incomplete tokens and the Jes prefix", () => {
  const results = rankSearchDocuments(
    [
      document({ id: "page:jesolo", href: "/jesolo", title: "Jesolo" }),
      document({
        id: "page:payments",
        href: "/pagamenti",
        title: "Pagamenti dei Comuni",
      }),
    ],
    "Jes",
  );

  assert.equal(results[0].href, "/jesolo");
  assert.equal(results[0].match.reason, "title-prefix");

  const incompleteTokens = rankSearchDocuments(
    [document({ id: "page:payments", href: "/pagamenti", title: "Pagamenti dei Comuni" })],
    "pag comun",
  );
  assert.equal(incompleteTokens[0].href, "/pagamenti");
  assert.equal(incompleteTokens[0].match.reason, "title-tokens");
});

test("global search folds accents while matching reordered incomplete tokens", () => {
  const results = rankSearchDocuments(
    [
      document({
        id: "page:venezia",
        href: "/venezia",
        title: "Città Metropolitana di Venezia",
      }),
    ],
    "metropolitana venezia",
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].href, "/venezia");
  assert.equal(results[0].match.reason, "title-tokens");
});

test("light title typos are opt-in and labeled without broadening short queries", () => {
  const typo = rankSearchDocuments([document()], "Jesola");
  assert.equal(typo.length, 1);
  assert.equal(typo[0].match.reason, "title-fuzzy");

  const shortTypo = rankSearchDocuments([document()], "Jez");
  assert.equal(shortTypo.length, 0);
});

test("entity ranking returns Jesolo for a prefix, is accent-aware and deterministic", () => {
  const entities = [
    entity({ codiceIpa: "c_c388", denominazione: "COMUNE DI JESOLO" }),
    entity({ codiceIpa: "c_e388", denominazione: "COMUNE DI JESI" }),
    entity({
      codiceIpa: "c_v001",
      denominazione: "CITTÀ METROPOLITANA DI VENEZIA",
    }),
  ];

  const first = rankEntitySearchResults(entities, "Jes");
  const second = rankEntitySearchResults([...entities].reverse(), "Jes");
  assert.deepEqual(first.map((result) => result.title), ["COMUNE DI JESI", "COMUNE DI JESOLO"]);
  assert.deepEqual(
    second.map((result) => result.title),
    first.map((result) => result.title),
  );
  assert.ok(first.some((result) => result.title === "COMUNE DI JESOLO"));

  const accented = rankEntitySearchResults(entities, "citta metropolitana venezia");
  assert.equal(accented.length, 1);
  assert.equal(accented[0].title, "CITTÀ METROPOLITANA DI VENEZIA");
});

test("ranking removes duplicate destinations for pages and entities", () => {
  const pageResults = rankSearchDocuments(
    [
      document({ id: "page:first", href: "/same", title: "Jesolo" }),
      document({ id: "page:second", href: "/same", title: "Jesolo" }),
    ],
    "jes",
  );
  assert.equal(pageResults.length, 1);
  assert.equal(new Set(pageResults.map((result) => result.href)).size, 1);

  const entityResults = rankEntitySearchResults(
    [entity(), entity({ codiceIpa: "c_c388", denominazione: "Comune di Jesolo" })],
    "jes",
  );
  assert.equal(entityResults.length, 1);
  assert.equal(new Set(entityResults.map((result) => result.href)).size, 1);
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

test("municipal snapshot search finds major cities by keyword", async () => {
  const { searchGlobal } = await import("../src/lib/global-search.ts");
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    fetchCalls.push(String(input));
    return new Response("blocked", { status: 500 });
  };

  try {
    const milano = await searchGlobal({ query: "milano", limit: 8 });
    assert.equal(milano.entitiesAvailable, false);
    assert.ok(
      milano.groups.some((group) =>
        group.results.some((result) => normalizeSearchText(result.title).includes("milano")),
      ),
      "Milano should be discoverable from the committed municipal snapshot",
    );

    const bologna = await searchGlobal({ query: "bologna", limit: 8 });
    assert.ok(
      bologna.groups.some((group) =>
        group.results.some((result) => normalizeSearchText(result.title).includes("bologna")),
      ),
      "Bologna should be discoverable from the committed municipal snapshot",
    );
    assert.ok(fetchCalls.length >= 4, "IPA SQL plus full-text fallback per query");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
