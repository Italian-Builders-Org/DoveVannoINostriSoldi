import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const {
  getGovernmentScorecardPublicPaths,
  GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS,
} = await import("../src/lib/government-scorecard-governments.ts");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the public route is the only government scorecard surface", () => {
  const index = read("../src/app/governi/page.tsx");
  const detail = read("../src/app/governi/[id]/page.tsx");
  const comparison = read("../src/app/governi/confronta/page.tsx");
  const comparisonClient = read("../src/app/governi/confronta/government-comparison.tsx");
  const archive = read("../src/app/governi/_components/government-archive-and-comparison.tsx");
  assert.match(index, /getCurrentGovernmentScorecardV6Id/);
  assert.match(detail, /generateStaticParams/);
  assert.match(detail, /dynamicParams = false/);
  assert.match(comparison, /getGovernmentScorecardV6View/);
  assert.match(archive, /action="\/governi\/confronta"/);
  assert.doesNotMatch(index + detail + comparison + archive, /pagella-governi-v6|GOVERNMENT_SCORECARD_V6_PREVIEW/);
  assert.doesNotMatch(comparisonClient, /punt[oi] osservat|valori osservati|periodi osservati/i);
  assert.match(comparisonClient, /dati pubblicati/i);
});

test("all chronological detail pages have canonical public paths", () => {
  assert.deepEqual(
    getGovernmentScorecardPublicPaths(),
    GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.map((id) => `/governi/${id}`),
  );
  assert.equal(new Set(getGovernmentScorecardPublicPaths()).size, 17);
});

test("sitemap and navigation reference the public government section", () => {
  const sitemap = read("../src/app/sitemap.ts");
  const navigation = read("../src/lib/site-navigation.ts");
  const footer = read("../src/components/site-footer.tsx");
  assert.match(sitemap, /getGovernmentScorecardPublicPaths/);
  assert.match(navigation + footer, /\/governi/);
  assert.doesNotMatch(sitemap + navigation + footer, /\/interno\/pagella-governi-v6/);
});
