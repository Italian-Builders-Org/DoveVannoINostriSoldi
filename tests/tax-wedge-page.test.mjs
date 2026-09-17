import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const page = await readFile(new URL("../src/app/cuneo-fiscale/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/app/cuneo-fiscale/cuneo-fiscale.module.css", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/DATA_SOURCES.md", import.meta.url), "utf8");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

test("cuneo fiscale page states OECD profile, composition and non-goals", () => {
  assert.match(page, /Cuneo fiscale sul lavoro/);
  assert.match(page, /Taxing Wages/);
  assert.match(page, /data-testid="tax-wedge-rate"/);
  assert.match(page, /data-testid="tax-wedge-components"/);
  assert.match(page, /data-testid="tax-wedge-comparison"/);
  assert.match(page, /Non è la busta paga/);
  assert.match(page, /IRPEF territoriale/);
  assert.match(page, /denominatori diversi/);
  assert.doesNotMatch(page, /—|–/);
  assert.match(css, /\.heroRate/);
  assert.match(docs, /Cuneo fiscale · OECD Taxing Wages/);
});

test("navigation, sitemap and search expose the tax wedge page", () => {
  const economy = PRIMARY_NAV.find((section) => section.href === "/economia");
  assert.ok(economy?.children?.some((entry) => entry.href === "/cuneo-fiscale"));
  assert.equal(economy?.icon, "economy");
  assert.ok(!PRIMARY_NAV.find((section) => section.href === "/spese")?.children?.some((entry) => entry.href === "/cuneo-fiscale"));
  assert.ok(SITE_MAP_GROUPS.some((group) => group.title === "Economia" && group.links.some((entry) => entry.href === "/cuneo-fiscale")));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/cuneo-fiscale"));
  for (const query of ["cuneo fiscale", "tax wedge", "taxing wages", "oecd"]) {
    assert.ok(searchSiteDocuments(query).some((result) => result.href === "/cuneo-fiscale"), query);
  }
});
