import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicSitemap } from "../src/lib/public-discovery.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("research catalogue keeps 79 investigation prompts, seven proposals, and official source pointers", async () => {
  const catalogue = JSON.parse(await read("../src/lib/data/rendite-catalogo.json"));
  assert.deepEqual(catalogue.groups.map((group) => group.items.length), [15, 10, 7, 8, 11, 24, 4]);
  const items = catalogue.groups.flatMap((group) => group.items);
  assert.equal(items.length, 79);
  const research = JSON.parse(await read("../research/rendite-inefficienze/stime-contributore.json"));
  assert.deepEqual(Object.keys(research.ranges).sort(), items.map((item) => item.id).sort(), "research estimates must preserve every case without adding public amounts");
  assert.deepEqual(Object.keys(research.proposalRanges).sort(), catalogue.proposals.map((proposal) => proposal.id).sort());
  assert.equal(catalogue.proposals.length, 7);
  assert.equal(catalogue.meta?.kind, "research-catalogue");
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
    assert.ok(Array.isArray(item.sources) && item.sources.length > 0, `missing sources: ${item.id}`);
    for (const source of item.sources) {
      assert.ok(source.label?.trim());
      assert.match(source.url, /^https:\/\//);
      assert.ok(source.holder?.trim());
      assert.match(source.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  const taxi = items.find((item) => item.id === "taxi");
  assert.ok(taxi.evidence?.facts?.length >= 3);
  assert.match(taxi.evidence.sourceUrl, /agcm\.it/);
  assert.match(taxi.evidence.facts.join(" "), /7\.962/);
  const balneari = items.find((item) => item.id === "balneari");
  assert.ok(balneari.evidence?.facts?.length >= 2);
  assert.match(balneari.evidence.facts.join(" "), /AS1973/);
  const aciPra = items.find((item) => item.id === "aci-pra");
  assert.ok(aciPra.evidence?.facts?.length >= 2);
  assert.match(aciPra.evidence.sourceUrl, /normattiva\.it/);
  const cnel = items.find((item) => item.id === "cnel");
  assert.ok(cnel.evidence?.facts?.length >= 1);
  assert.match(cnel.evidence.sourceUrl, /cnel\.it/);
  const withEvidence = items.filter((item) => item.evidence).map((item) => item.id).sort();
  assert.deepEqual(withEvidence, ["aci-pra", "balneari", "cnel", "taxi"]);
  for (const proposal of catalogue.proposals) {
    for (const field of ["title", "action", "limits"]) assert.ok(proposal[field]?.trim(), `${proposal.id}: ${field}`);
    assert.ok(Array.isArray(proposal.sources) && proposal.sources.length > 0, `missing proposal sources: ${proposal.id}`);
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
  assert.match(index, /Cataloghi di ricerca/);
  assert.doesNotMatch(index, /\b[Bb]ozza/);
  assert.doesNotMatch(page, /\b[Bb]ozza/);
  assert.ok(publicSitemap("https://example.org").some((entry) => entry.url === "https://example.org/studi/rendite-inefficienze"));
  assert.ok(page.includes('id={`proposta-${proposal.id}`}'), "proposal anchors must not collide with cases");
  assert.match(page, /Rendite e inefficienze: casi da verificare/);
  assert.match(page, /rendite-catalogo\.json/);
  assert.match(page, /catalogue\.groups\.map/);
  assert.match(page, /group\.items\.map/);
  assert.match(page, /catalogue\.proposals\.map/);
  assert.match(page, /SourcesList/);
  assert.match(page, /EvidenceBlock/);
  assert.match(page, /<h2[^>]*>\{group\.title\}<\/h2>/);
  assert.match(page, /Da verificare/);
  for (const field of ["item.question", "proposal.action", "proposal.limits"]) assert.ok(page.includes(field));
  for (const label of ["Spesa pubblica", "Costi privati", "Costi sistemici"]) assert.ok(page.includes(label));
  assert.match(page, /github\.com\/Italian-Builders-Org\/DoveVannoINostriSoldi\/blob\/main\/research\/rendite-inefficienze\/README\.md/);
  assert.doesNotMatch(page, /use client|useEffect|useState|dangerouslySetInnerHTML|\.reduce\(|formatEuro|Intl\.NumberFormat|force-dynamic|fetch\(/);
  assert.doesNotMatch(page, /\b0\s*(?:€|euro)|\b(?:totale|total)\s*[=:]/i);
});
