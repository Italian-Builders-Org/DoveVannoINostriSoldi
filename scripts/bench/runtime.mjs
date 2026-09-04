import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import "../../tests/helpers/register-ts-alias.mjs";
const { searchGlobalLocalFallback, searchSiteDocuments } = await import("../../src/lib/global-search.ts");
const format = await import("../../src/lib/format.ts");
const { getEducationAtlasView } = await import("../../src/lib/education-atlas.ts");
const { getRegionGeography } = await import("../../src/lib/municipality-geography.ts");
const { getMunicipalitySearchEntities } = await import("../../src/lib/siope-municipality-detail.ts");

const queries = [
  "Milano", "Bologna", "Jes", "Sanità", "pubblico debito",
  "città di Milano", "comune san giovanni", "zzzzzzzz",
];
const dates = ["2026-08-20", "2024-02-29", "2025-12-31T23:30:00Z", null, "invalid"];
const values = [0, -0, 1250.5, 999999, 1000000, -2356789, 72940000000];
const cases = {
  "global-local-search": () => queries.map((query) => searchGlobalLocalFallback({ query })),
  "site-search": () => queries.map((query) => searchSiteDocuments(query)),
  "formatting": () => values.map((value) => [
    format.compactEuro(value), format.compactEuroLike(value, 1e9),
    format.billions(value), format.percent(value),
  ]).concat(dates.map((date) => [format.longDate(date), format.shortDate(date)])),
  "education-view": () => [getEducationAtlasView(), getEducationAtlasView({ region: "03", pathway: "LICEI" })],
  "region-geography": () => Array.from({ length: 22 }, (_, index) =>
    getRegionGeography(2025, String(index + 1).padStart(2, "0"))),
  "municipal-identities": () => getMunicipalitySearchEntities(),
};

console.log(JSON.stringify({
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  root: process.cwd(),
  queries,
  entities: getMunicipalitySearchEntities().length,
}));

for (const [name, run] of Object.entries(cases)) {
  const digest = createHash("sha256").update(JSON.stringify(run())).digest("hex");
  for (let warmup = 0; warmup < 3; warmup++) run();
  const samples = [];
  for (let sample = 0; sample < 7; sample++) {
    let count = 0;
    const start = performance.now();
    let result;
    do {
      result = run();
      count++;
    } while (performance.now() - start < 150);
    const elapsed = performance.now() - start;
    if (result === undefined) throw new Error(`Missing benchmark output: ${name}`);
    samples.push(elapsed / count);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({
    name, medianMs: samples[3], minMs: samples[0], maxMs: samples.at(-1), digest,
  }));
}
