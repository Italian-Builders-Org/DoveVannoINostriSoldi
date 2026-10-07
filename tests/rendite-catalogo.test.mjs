import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicSitemap } from "../src/lib/public-discovery.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("community catalogue keeps 79 investigation prompts and seven bounded proposals, not estimates", async () => {
  const catalogue = JSON.parse(await read("../src/lib/data/rendite-catalogo.json"));
  assert.deepEqual(catalogue.groups.map((group) => group.items.length), [15, 10, 7, 8, 11, 24, 4]);
  const items = catalogue.groups.flatMap((group) => group.items);
  assert.equal(items.length, 79);
  const research = JSON.parse(await read("../research/rendite-inefficienze/stime-contributore.json"));
  assert.deepEqual(Object.keys(research.ranges).sort(), items.map((item) => item.id).sort(), "research estimates must preserve every case without adding public amounts");
  assert.deepEqual(Object.keys(research.proposalRanges).sort(), catalogue.proposals.map((proposal) => proposal.id).sort());
  assert.equal(catalogue.proposals.length, 7);
  const records = [...catalogue.groups, ...items, ...catalogue.proposals];
  for (const collection of [catalogue.groups, items, catalogue.proposals]) {
    assert.equal(new Set(collection.map((record) => record.id)).size, collection.length);
  }
  const anchors = [...catalogue.groups.map((group) => group.id), ...items.map((item) => item.id), ...catalogue.proposals.map((proposal) => `proposta-${proposal.id}`)];
  assert.equal(new Set(anchors).size, anchors.length);
  for (const record of records) assert.match(record.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  for (const group of catalogue.groups) {
    for (const field of ["title", "description"]) assert.ok(group[field]?.trim(), field);
  }
  for (const item of items) {
    assert.ok(item.name?.trim());
    assert.ok(item.question?.trim(), `missing question: ${item.id}`);
  }
  for (const proposal of catalogue.proposals) {
    for (const field of ["title", "action", "limits"]) assert.ok(proposal[field]?.trim(), `${proposal.id}: ${field}`);
  }
  function noMonetaryFields(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /amount|estimate|euro|eur$|money|monetar|importo|costo|cost$|total|risparmio|budget/i);
      noMonetaryFields(child);
    }
  }
  noMonetaryFields(catalogue);

  const page = await read("../src/app/studi/rendite-inefficienze/page.tsx");
  const index = await read("../src/app/studi/page.tsx");
  assert.match(index, /href="\/studi\/rendite-inefficienze"/);
  assert.match(index, /Bozze della comunità/);
  assert.ok(publicSitemap("https://example.org").some((entry) => entry.url === "https://example.org/studi/rendite-inefficienze"));
  assert.ok(page.includes('id={`proposta-${proposal.id}`}'), "proposal anchors must not collide with cases");
  assert.match(page, /Rendite e inefficienze: casi da verificare/);
  assert.match(page, /rendite-catalogo\.json/);
  assert.match(page, /catalogue\.groups\.map/);
  assert.match(page, /group\.items\.map/);
  assert.match(page, /catalogue\.proposals\.map/);
  assert.match(page, /<h2[^>]*>\{group\.title\}<\/h2>/);
  assert.match(page, /<summary>\{item\.name\} · Da verificare<\/summary>/);
  assert.match(page, /Stato del gruppo: <strong>Da verificare<\/strong>/);
  for (const field of ["item.question", "proposal.action", "proposal.limits"]) assert.ok(page.includes(field));
  assert.match(page, /non è uno studio validato da DVNS/);
  for (const label of ["Spesa pubblica", "Costi privati", "Costi sistemici"]) assert.ok(page.includes(label));
  assert.match(page, /senza verifica istituzionale/);
  assert.match(page, /github\.com\/Italian-Builders-Org\/DoveVannoINostriSoldi\/blob\/main\/research\/rendite-inefficienze\/README\.md/);
  assert.doesNotMatch(page, /use client|useEffect|useState|dangerouslySetInnerHTML|\.reduce\(|formatEuro|Intl\.NumberFormat|force-dynamic|fetch\(/);
  assert.doesNotMatch(page, /\b0\s*(?:€|euro)|\b(?:totale|total)\s*[=:]/i);
});
