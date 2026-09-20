import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import "./helpers/register-ts-alias.mjs";

const { parsePoliticiEurodeputatiItSnapshot } = await import(
  "../src/lib/data/politici-eurodeputati-it-contract.ts"
);
const { buildEurodeputatiPageView, getPoliticiEurodeputatiItSnapshot } = await import(
  "../src/lib/politici-eurodeputati.ts"
);

const snapshotJson = JSON.parse(
  await readFile(new URL("../src/data/generated/politici-eurodeputati-it.json", import.meta.url), "utf8"),
);
const page = await readFile(new URL("../src/app/politici/europa/page.tsx", import.meta.url), "utf8");
const graph = await readFile(new URL("../src/app/politici/repubblica-graph.tsx", import.meta.url), "utf8");

test("lo snapshot ufficiale ha solo eurodeputati IT e resta fail-closed", () => {
  const snapshot = parsePoliticiEurodeputatiItSnapshot(snapshotJson);
  assert.equal(snapshot.datasetId, "politici-eurodeputati-it");
  assert.equal(snapshot.coverage.countryOfRepresentation, "IT");
  assert.equal(snapshot.coverage.memberCount, snapshot.meps.length);
  assert.ok(snapshot.meps.length >= 70 && snapshot.meps.length <= 80);
  assert.equal(snapshot.semantics.soldi.present, false);
  for (const mep of snapshot.meps) {
    assert.equal(mep.countryOfRepresentation, "IT");
    assert.match(mep.officialPage, /^https:\/\/www\.europarl\.europa\.eu\/meps\/it\/\d+$/);
    assert.equal("nationalParty" in mep, false);
  }
  assert.throws(() => parsePoliticiEurodeputatiItSnapshot({
    ...snapshot,
    meps: snapshot.meps.map((mep, index) => index === 0 ? { ...mep, countryOfRepresentation: "FR" } : mep),
  }));
});

test("la vista pagina non mescola i gruppi nazionali e punta alle schede ufficiali", () => {
  const view = buildEurodeputatiPageView(getPoliticiEurodeputatiItSnapshot());
  assert.equal(view.groups.reduce((sum, group) => sum + group.memberCount, 0), view.coverage.memberCount);
  assert.ok(view.caveats.some((caveat) => /non si inferiscono/i.test(caveat)));
  assert.ok(view.caveats.some((caveat) => /separata|non mescola/i.test(caveat)));
  assert.match(page, /Eurodeputati eletti in Italia/);
  assert.match(page, /Non fanno parte dell’atlante Camera\/Senato\/Governo/);
  assert.match(page, /table-scroll/);
  assert.match(graph, /\/politici\/europa/);
  assert.doesNotMatch(graph, /follow-up #566/);
});
