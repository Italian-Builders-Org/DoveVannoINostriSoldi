import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { TED_DATASET, getTedNoticePage, parseTedNotice } = await import("../src/lib/ted-notices.ts");
const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { relatedReadingForDataset } = await import("../src/lib/integrated-catalog-views.ts");

test("every committed TED notice can be rendered without inventing missing cells", async () => {
  const numbers = new Set();
  for (let offset = 0; offset < 2825; offset += 100) {
    const page = await selectIntegratedDataset({ datasetId: TED_DATASET, offset, limit: 100 });
    for (const row of page.rows) {
      assert.equal(row.redactions.length, 0);
      numbers.add(parseTedNotice(row).number);
    }
  }
  assert.equal(numbers.size, 2825);
});

test("TED page, public API and MCP expose the same original notice and provenance", async () => {
  const page = await getTedNoticePage({ q: "533445-2026" });
  assert.equal(page.dataset.publicRows, 2825);
  assert.equal(page.dataset.sourceMetadata.publicationDate, null);
  assert.equal(page.dataset.sourceMetadata.acquisitionDate, "2026-09-06");
  assert.equal(page.dataset.licenseStatus, "verified-open-eu-reuse");
  assert.match(page.dataset.reuseNote, /2011\/833/);
  assert.equal(page.notices.length, 1);
  assert.equal(page.notices[0].date, "2026-08-03");
  assert.equal(page.notices[0].form, "result");
  assert.deepEqual(page.notices[0].cpvs, ["33190000"]);
  assert.equal(page.notices[0].url, "https://ted.europa.eu/it/notice/-/detail/533445-2026");
  const response = await GET(new Request(`http://localhost/api/dati/${TED_DATASET}?q=533445-2026&limit=25`), {
    params: Promise.resolve({ dataset: TED_DATASET }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, page.rows);
  const mcp = await queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: TED_DATASET, query: "533445-2026", limit: 25 });
  assert.deepEqual(mcp.rows, page.rows);
  assert.deepEqual(mcp.dataset.sourceMetadata, page.dataset.sourceMetadata);
});

test("TED pagination keeps notices disjoint, preserves search and rejects bad cursors", async () => {
  const first = await getTedNoticePage();
  assert.equal(first.notices.length, 25);
  assert.ok(first.pagination.nextCursor);
  const second = await getTedNoticePage({ cursor: first.pagination.nextCursor });
  assert.equal(second.notices.length, 25);
  assert.equal(new Set([...first.notices, ...second.notices].map((row) => row.number)).size, 50);
  assert.ok(first.notices[0].date >= second.notices[0].date);
  await assert.rejects(getTedNoticePage({ cursor: "invalid" }));
  await assert.rejects(getTedNoticePage({ q: "x".repeat(201) }));
  await assert.rejects(getTedNoticePage({ q: ["one", "two"] }));
  await assert.rejects(getTedNoticePage({ q: "trasporto", cursor: first.pagination.nextCursor }));
  const empty = await getTedNoticePage({ q: "nessunavvisotedcorrisponde123" });
  assert.equal(empty.notices.length, 0);
  assert.equal(empty.pagination.exhausted, true);
});

test("TED multinational scope and source languages remain visible", async () => {
  const page = await getTedNoticePage({ q: "548051-2026" });
  assert.deepEqual(page.notices[0].countries, ["SWE", "ITA"]);
  assert.equal(page.notices[0].buyerLanguage, "eng");
  assert.equal(page.notices[0].buyers.length, 2);
  const row = structuredClone(page.rows[0]);
  for (const [field, value] of [
    ["Paesi committenti", '["DEU"]'], ["Codici CPV", '["ABC"]'],
    ["URL avviso", "https://example.com/notice"], ["Data pubblicazione", "2026-09-01"],
    ["Committenti", "null"], ["Tipo avviso", "unexpected"],
  ]) {
    assert.throws(() => parseTedNotice({ ...row, cells: { ...row.cells, [field]: value } }));
  }
  assert.throws(() => parseTedNotice({ ...row, sourceUrls: [] }));
});

test("TED is discoverable without capturing municipality queries", async () => {
  const result = await searchSiteDocuments("avvisi ted");
  assert.ok(result.some((item) => item.href === "/appalti/ted"));
  assert.deepEqual(relatedReadingForDataset({ id: TED_DATASET, domain: "procurement" }), {
    href: "/appalti/ted", label: "Avvisi TED con committenti in Italia",
  });
});
