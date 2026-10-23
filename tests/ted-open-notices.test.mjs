import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const {
  TED_OPEN_DATASET,
  getTedOpenNoticePage,
  parseTedOpenNotice,
  isTedOpenDeadlineStillValid,
} = await import("../src/lib/ted-open-notices.ts");

test("open status requires a published deadline on or after today", () => {
  assert.equal(isTedOpenDeadlineStillValid("2026-12-01"), true);
  assert.equal(isTedOpenDeadlineStillValid("2020-01-01"), false);
});

test("TED open notices expose nature, deadline and official URL", async () => {
  const page = await getTedOpenNoticePage({ q: "674254-2026", includeExpired: "1" });
  assert.equal(page.dataset.publicRows, 1707);
  assert.equal(page.notices.length, 1);
  assert.equal(page.notices[0].nature, "Forniture");
  assert.match(page.notices[0].deadline, /^2026-/);
  assert.equal(page.notices[0].url, "https://ted.europa.eu/it/notice/-/detail/674254-2026");
  const parsed = parseTedOpenNotice(page.rows[0]);
  assert.equal(parsed.number, page.notices[0].number);
});

test("tipo filter keeps only the requested nature", async () => {
  const servizi = await getTedOpenNoticePage({ tipo: "servizi", includeExpired: "1" });
  assert.ok(servizi.notices.length > 0);
  assert.ok(servizi.notices.every((row) => row.nature === "Servizi"));
  if (servizi.matchedRows <= 25) assert.equal(servizi.notices.length, servizi.matchedRows);
  else assert.equal(servizi.notices.length, 25);
  await assert.rejects(getTedOpenNoticePage({ tipo: "invalido" }));
});

test("tipo filter scans the full dataset before paginating", async () => {
  const firstChunk = await selectIntegratedDataset({ datasetId: TED_OPEN_DATASET, limit: 25 });
  const fornitureBeyondFirstChunk = firstChunk.rows
    .map((row) => parseTedOpenNotice(row))
    .every((notice) => notice.nature !== "Forniture");
  const forniturePage = await getTedOpenNoticePage({ tipo: "forniture", includeExpired: "1" });
  assert.ok(forniturePage.matchedRows > 0);
  assert.ok(forniturePage.notices.every((notice) => notice.nature === "Forniture"));
  if (fornitureBeyondFirstChunk) {
    assert.ok(forniturePage.notices.length > 0, "expected Forniture on page 1 after full-dataset filter");
  }
  if (forniturePage.matchedRows > 25) {
    assert.equal(forniturePage.notices.length, 25);
    const secondPage = await getTedOpenNoticePage({
      tipo: "forniture",
      includeExpired: "1",
      cursor: forniturePage.pagination.nextCursor,
    });
    assert.ok(secondPage.notices.length > 0);
    assert.equal(secondPage.matchedRows, forniturePage.matchedRows);
    assert.ok(secondPage.notices.every((notice) => notice.nature === "Forniture"));
  }
});

test("open-only filter uses the full dataset before paginating", async () => {
  const openPage = await getTedOpenNoticePage({});
  assert.ok(openPage.matchedRows > 0);
  assert.ok(openPage.notices.every((notice) => notice.stillOpen));
  if (openPage.matchedRows <= 25) assert.equal(openPage.notices.length, openPage.matchedRows);
  else assert.equal(openPage.notices.length, 25);
});
