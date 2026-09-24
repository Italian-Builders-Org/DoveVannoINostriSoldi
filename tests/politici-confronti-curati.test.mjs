import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getThemeVoteHistory, parseCuratedComparisonCatalog } = await import("../src/lib/politici-voti-tema.ts");
const { GET: getThemeHistory } = await import("../src/app/api/politici/voti-tema/route.ts");
const catalog = JSON.parse(readFileSync(new URL("../src/data/politici-confronti-curati.json", import.meta.url), "utf8"));

test("a documented personal position reaches the same act and recorded final vote", async () => {
  const history = getThemeVoteHistory({ themeId: "sicurezza", chamber: "camera" });
  const comparison = history.comparisons.find((item) => item.id === "gianassi-ddl-sicurezza-2024");

  assert.equal(comparison.subject.kind, "person");
  assert.equal(comparison.subject.id, "dep-308880");
  assert.equal(comparison.subject.label, "Federico Gianassi");
  assert.equal(comparison.position.date, "2024-09-10");
  assert.equal(comparison.actId, "ac19_1660");
  assert.equal(comparison.voteId, "vs19_349_113");
  assert.equal(comparison.voteState, "C");
  assert.ok(history.events.some((event) => event.voteId === comparison.voteId));
  assert.equal(new URL(comparison.position.sourceUrl).hostname, "www.deputatipd.it");
  assert.equal(new URL(comparison.voteSourceUrl).hostname, "documenti.camera.it");
  assert.equal("verdict" in comparison || "score" in comparison, false);
  const response = await getThemeHistory(new Request("http://localhost/api/politici/voti-tema?tema=sicurezza&ramo=camera"));
  assert.equal(response.status, 200);
  const published = await response.json();
  assert.equal(published.comparisons[0].id, comparison.id);
  assert.equal(published.comparisons[0].voteState, "C");
  assert.deepEqual(getThemeVoteHistory({ themeId: "lavoro", chamber: "camera" }).comparisons, []);
  assert.deepEqual(getThemeVoteHistory({ themeId: "sicurezza", chamber: "senato" }).comparisons, []);
});

test("catalog rejects incomplete, unresolved and untrusted comparisons", () => {
  for (const mutate of [
    (record) => { delete record.position.date; },
    (record) => { record.position.date = "2024-13-40"; },
    (record) => { record.actId = "ac19_missing"; },
    (record) => { record.voteId = "vs19_missing"; },
    (record) => { record.subject.id = "dep-missing"; },
    (record) => { record.subject.kind = "group"; },
    (record) => { record.position.sourceUrl = "https://example.org/claim"; },
    (record) => { record.position.sourceUrl = "http://www.deputatipd.it/claim"; },
    (record) => { record.voteSourceUrl = "https://example.org/vote"; },
    (record) => { record.verdict = "coerente"; },
  ]) {
    const invalid = structuredClone(catalog);
    mutate(invalid.comparisons[0]);
    assert.throws(() => parseCuratedComparisonCatalog(invalid));
  }
  const duplicate = structuredClone(catalog);
  duplicate.comparisons.push(structuredClone(duplicate.comparisons[0]));
  assert.throws(() => parseCuratedComparisonCatalog(duplicate));
  duplicate.comparisons[1].id = "same-source-different-id";
  assert.throws(() => parseCuratedComparisonCatalog(duplicate));
});
