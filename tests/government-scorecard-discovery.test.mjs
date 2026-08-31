import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LLMS_DISCOVERY_PATHS,
  PUBLIC_INDEXABLE_PATHS,
  publicSitemap,
} from "../src/lib/public-discovery.ts";
import {
  PRIMARY_NAV,
  SITE_MAP_GROUPS,
  activeNavSection,
  isNavChildActive,
} from "../src/lib/site-navigation.ts";
import { PUBLIC_SITE_URL } from "../src/lib/site.ts";

const institutionsPage = new URL("../src/app/istituzioni/page.tsx", import.meta.url);
const llmsPath = new URL("../public/llms.txt", import.meta.url);
const sitemapPath = new URL("../src/app/sitemap.ts", import.meta.url);
const scorecardPath = new URL("../src/data/generated/government-scorecard.json", import.meta.url);

function governmentDetailPaths(scorecard) {
  return scorecard.governments.map((government) => `/governi/${government.id}`);
}

test("government scorecard is discoverable inside the institutions taxonomy", async () => {
  assert.equal(PUBLIC_INDEXABLE_PATHS.includes("/governi"), true);
  assert.equal(PUBLIC_INDEXABLE_PATHS.includes("/governi/confronta"), true);
  assert.equal(LLMS_DISCOVERY_PATHS.includes("/governi"), true);

  const scorecard = JSON.parse(await readFile(scorecardPath, "utf8"));
  const governmentPaths = governmentDetailPaths(scorecard);
  const sitemapUrls = new Set(publicSitemap(PUBLIC_SITE_URL, governmentPaths).map((entry) => entry.url));
  assert.equal(sitemapUrls.has(`${PUBLIC_SITE_URL}/governi`), true);
  assert.equal(sitemapUrls.has(`${PUBLIC_SITE_URL}/governi/confronta`), true);
  assert.ok(governmentPaths.includes("/governi/meloni-i"));
  for (const path of governmentPaths) {
    assert.equal(sitemapUrls.has(`${PUBLIC_SITE_URL}${path}`), true);
  }

  const institutions = PRIMARY_NAV.find((item) => item.href === "/istituzioni");
  assert.ok(institutions);
  assert.equal(PRIMARY_NAV.some((item) => item.href === "/governi"), false);
  assert.deepEqual(
    institutions.children?.find((child) => child.href === "/governi"),
    { href: "/governi", label: "Pagella dei governi" },
  );
  assert.equal(activeNavSection("/governi/confronta")?.href, "/istituzioni");
  assert.equal(
    isNavChildActive(
      "/governi/confronta",
      "/governi",
      institutions.children ?? [],
    ),
    true,
  );

  const institutionsMap = SITE_MAP_GROUPS.find((group) => group.title === "Istituzioni");
  assert.ok(institutionsMap?.links.some((link) => link.href === "/governi"));

  const [page, llms] = await Promise.all([
    readFile(institutionsPage, "utf8"),
    readFile(llmsPath, "utf8"),
  ]);
  assert.match(page, /href: "\/governi"/);
  assert.match(
    llms,
    /\[Pagella economica dei governi\]\(https:\/\/www\.dovevannoinostrisoldi\.com\/governi\)/,
  );
});

test("every published government has a dedicated page and is wired into the sitemap", async () => {
  const [scorecard, sitemapSource] = await Promise.all([
    readFile(scorecardPath, "utf8").then((text) => JSON.parse(text)),
    readFile(sitemapPath, "utf8"),
  ]);
  const governmentPaths = governmentDetailPaths(scorecard);
  assert.ok(governmentPaths.length >= 17);
  assert.equal(new Set(governmentPaths).size, governmentPaths.length);
  assert.ok(governmentPaths.includes("/governi/meloni-i"));
  assert.match(sitemapSource, /getGovernmentScorecardPublicPaths/);
  assert.match(sitemapSource, /\.\.\.getGovernmentScorecardPublicPaths\(\)/);
});
