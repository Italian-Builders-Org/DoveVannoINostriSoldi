import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { publicSitemap } from "../src/lib/public-discovery.ts";
import { PUBLIC_SITE_URL } from "../src/lib/site.ts";

const [{ getGovernmentScorecardPublicPaths }, { getMunicipalityEntityPublicPaths }, { default: sitemap }] =
  await Promise.all([
    import("../src/lib/government-scorecard-governments.ts"),
    import("../src/lib/siope-municipality-detail.ts"),
    import("../src/app/sitemap.ts"),
  ]);

const sitemapPath = new URL("../src/app/sitemap.ts", import.meta.url);
const entityPagePath = new URL("../src/app/enti/[codice]/page.tsx", import.meta.url);
const entityProcurementPagePath = new URL("../src/app/enti/[codice]/appalti/page.tsx", import.meta.url);
const detailSnapshotPaths = [
  new URL("../src/data/generated/siope-municipal-detail-2024.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal-detail-2025.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal-detail.json", import.meta.url),
];

const IPA_CODE_COLUMN = 1;

async function committedMunicipalityPaths() {
  const codes = new Set();
  for (const snapshotPath of detailSnapshotPaths) {
    const artifact = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.equal(artifact.scope, "municipality-detail");
    assert.equal(artifact.columns[IPA_CODE_COLUMN], "codiceIpa");
    const perArtifact = new Set();
    for (const row of artifact.municipalities) {
      const code = row[IPA_CODE_COLUMN];
      if (code === null) continue;
      assert.equal(typeof code, "string");
      assert.equal(perArtifact.has(code), false, `Codice IPA duplicato nello snapshot: ${code}`);
      perArtifact.add(code);
      codes.add(code);
    }
    assert.equal(perArtifact.size, artifact.coverage.withIpaIdentifier);
  }
  return [...codes]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((code) => `/enti/${encodeURIComponent(code)}`);
}

test("municipal profile pages stay enumerable but are excluded from crawler discovery during containment", async () => {
  const municipalityPaths = await committedMunicipalityPaths();
  const generatedMunicipalityPaths = getMunicipalityEntityPublicPaths();

  // The committed snapshots cover at least the 7.892 municipalities with an
  // unambiguous Codice IPA documented in docs/MUNICIPALITY_PROFILE.md.
  assert.ok(municipalityPaths.length >= 7892);
  assert.equal(new Set(municipalityPaths).size, municipalityPaths.length);
  assert.ok(municipalityPaths.includes("/enti/c_l736"));
  assert.deepEqual(generatedMunicipalityPaths, municipalityPaths);

  const sitemapUrls = new Set(sitemap().map((entry) => entry.url));
  for (const path of municipalityPaths) {
    const url = new URL(path, PUBLIC_SITE_URL);
    // Codice IPA values are URL-safe as committed: the canonical URL must not
    // re-encode or otherwise alter the path.
    assert.equal(url.pathname, path);
    assert.equal(url.origin, PUBLIC_SITE_URL);
    assert.equal(sitemapUrls.has(url.href), false);
  }

  const expectedSitemap = publicSitemap(PUBLIC_SITE_URL, getGovernmentScorecardPublicPaths());
  assert.deepEqual(sitemap(), expectedSitemap);

  const sitemapSource = await readFile(sitemapPath, "utf8");
  assert.doesNotMatch(sitemapSource, /getMunicipalityEntityPublicPaths/);

  for (const pagePath of [entityPagePath, entityProcurementPagePath]) {
    const pageSource = await readFile(pagePath, "utf8");
    assert.match(pageSource, /robots:\s*entityRobots/);
    assert.match(pageSource, /index:\s*false,\s*follow:\s*false/);
  }
});
