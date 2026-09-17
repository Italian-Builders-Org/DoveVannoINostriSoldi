import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { getGdpView } = await import("../src/lib/gdp.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

test("GDP page wires the Eurostat hub under Economia without government attribution", () => {
  const page = readFileSync("src/app/pil/page.tsx", "utf8");
  const docs = readFileSync("docs/DATA_SOURCES.md", "utf8");
  assert.match(page, /getGdpView\(\)/);
  assert.match(page, /data-testid="gdp-yoy"/);
  assert.match(page, /Pagella governi/);
  assert.match(page, /senza voto/);
  assert.match(page, /SEC 2010/);
  assert.doesNotMatch(page, /merito del governo|colpa del governo|assegna un voto/i);
  assert.match(docs, /PIL e conti nazionali · Eurostat/);
  const economy = PRIMARY_NAV.find((section) => section.href === "/economia");
  assert.ok(economy?.children?.some((entry) => entry.href === "/pil"));
  assert.ok(SITE_MAP_GROUPS.some((group) => group.title === "Economia" && group.links.some((entry) => entry.href === "/pil")));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/pil"));
  for (const query of ["pil", "prodotto interno lordo", "conti nazionali"]) {
    assert.ok(searchSiteDocuments(query).some((result) => result.href === "/pil"), query);
  }
});

test("GDP view exposes latest quarter, annual series and peer comparison", () => {
  const view = getGdpView();
  assert.equal(view.latestQuarter.period, "2026-Q2");
  assert.ok(view.latestQuarter.nominalMillionEuro > 0);
  assert.ok(view.annual.some((row) => row.period === "2025"));
  assert.deepEqual(
    view.peers.map((peer) => peer.geo).sort(),
    ["DE", "ES", "FR", "IT"],
  );
  assert.equal(view.components.length, 4);
});
