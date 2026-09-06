import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { createPapersCatalog, validatePublishedPaper } = await import("../src/lib/papers-contract.ts");
const { papers } = await import("../src/lib/papers.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS, LLMS_DISCOVERY_PATHS } = await import("../src/lib/public-discovery.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const fixture = { status: "published", slug: "studio-esempio", title: "Studio di esempio", abstract: "Una domanda verificabile.", authors: ["Autore di esempio"], publishedOn: "2026-09-06", version: "1.0", limitations: "Analisi descrittiva, non causale.", pdfUrl: "https://example.org/studio-v1.pdf", pdfSha256: "a".repeat(64), reproducibilityUrl: "https://example.org/studio/v1" };

test("paper: il catalogo pubblicato conserva lo studio esistente e la discovery canonica", () => {
  const published = papers.listPublished();
  assert.equal(published.length, 1);
  assert.equal(published[0].slug, "dai-fondi-ai-posti");
  assert.equal(published[0].version, "1.3");
  const capsule = JSON.parse(readFileSync(new URL("../src/content/studies/childcare.json", import.meta.url), "utf8"));
  assert.equal(published[0].pdfSha256, capsule.assets["dai-fondi-ai-posti.pdf"].sha256);
  assert.match(published[0].pdfUrl, /\/studi\/dai-fondi-ai-posti\/v1\.3\/dai-fondi-ai-posti\.pdf$/);
  assert.match(published[0].reproducibilityUrl, /\/tree\/[a-f0-9]{40}\/research\//);
  assert.ok(PRIMARY_NAV.some((entry) => entry.href === "/studi"));
  assert.ok(SITE_MAP_GROUPS.some((group) => group.links.some((link) => link.href === "/studi")));
  for (const path of ["/studi", "/studi/dai-fondi-ai-posti"]) {
    assert.ok(PUBLIC_INDEXABLE_PATHS.includes(path));
    assert.ok(LLMS_DISCOVERY_PATHS.includes(path));
  }
  assert.equal(PUBLIC_INDEXABLE_PATHS.includes("/paper"), false);
  assert.ok(searchSiteDocuments("Dai fondi ai posti").some((result) => result.href === published[0].webPath));
  const registry = readFileSync(new URL("../src/content/papers/published/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(registry, /from\s+["'][^"']*(?:drafts|research|generated)/);
});

test("paper: contratti editoriali e provenienza obbligatori", () => {
  assert.equal(validatePublishedPaper(fixture), fixture);
  for (const patch of [{ status: "draft" }, { publishedOn: "2026-02-30" }, { authors: [] }, { limitations: "" }, { pdfSha256: "bad" }, { pdfUrl: "file:///private/draft.pdf" }, { reproducibilityUrl: "http://localhost:3000" }, { version: 0 }, { version: 1 }, { version: "0" }, { version: "1..3" }, { webPath: "/paper/draft" }, { slug: "../draft" }]) {
    assert.throws(() => validatePublishedPaper({ ...fixture, ...patch }), /non valido/);
  }
  assert.throws(() => createPapersCatalog([fixture, fixture]), /duplicato/);
});

test("paper: catalogo ordinato e isolato dalle mutazioni dei chiamanti", () => {
  const original = structuredClone(fixture);
  const catalog = createPapersCatalog([{ ...original, slug: "precedente", publishedOn: "2026-08-01" }, original]);
  original.title = "Modificato";
  assert.deepEqual(catalog.listPublished().map((entry) => entry.slug), ["studio-esempio", "precedente"]);
  const returned = catalog.listPublished();
  returned[0].title = "Modificato";
  assert.equal(catalog.listPublished()[0].title, fixture.title);
});
