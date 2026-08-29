import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EDITORIAL_TOPICS } from "../src/lib/integrated-editorial.ts";
import {
  LLMS_DISCOVERY_PATHS,
  PUBLIC_INDEXABLE_PATHS,
  publicRobots,
  publicSitemap,
} from "../src/lib/public-discovery.ts";
import { PUBLIC_SITE_URL } from "../src/lib/site.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const appRoot = path.join(repositoryRoot, "src", "app");

async function collectStaticPagePaths(directory, segments = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name === "page.tsx") {
      if (!segments.some((segment) => segment.startsWith("["))) {
        paths.push(segments.length === 0 ? "/" : `/${segments.join("/")}`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      paths.push(...await collectStaticPagePaths(path.join(directory, entry.name), [...segments, entry.name]));
    }
  }

  return paths;
}

test("the public discovery catalog is canonical, unique and complete for static pages", async () => {
  assert.equal(PUBLIC_SITE_URL, "https://www.dovevannoinostrisoldi.com");
  assert.equal(new Set(PUBLIC_INDEXABLE_PATHS).size, PUBLIC_INDEXABLE_PATHS.length);

  for (const routePath of PUBLIC_INDEXABLE_PATHS) {
    const url = new URL(routePath, PUBLIC_SITE_URL);
    assert.equal(routePath.startsWith("/"), true);
    assert.equal(routePath.includes("?"), false);
    assert.equal(routePath.includes("#"), false);
    assert.equal(routePath.includes("["), false);
    assert.equal(routePath.includes("]"), false);
    assert.equal(url.origin, PUBLIC_SITE_URL);
    assert.equal(url.pathname, routePath);
  }

  const staticPages = (await collectStaticPagePaths(appRoot)).sort();
  const catalogStaticPages = PUBLIC_INDEXABLE_PATHS
    .filter((routePath) => !EDITORIAL_TOPICS.some(
      (topic) => routePath === `/${topic.section}/${topic.slug}`,
    ))
    .slice()
    .sort();
  assert.deepEqual(catalogStaticPages, staticPages);
});

test("all and only the statically generated editorial topics are in the sitemap catalog", () => {
  const expected = EDITORIAL_TOPICS
    .map((topic) => `/${topic.section}/${topic.slug}`)
    .sort();
  const actual = PUBLIC_INDEXABLE_PATHS
    .filter((routePath) => expected.includes(routePath))
    .slice()
    .sort();
  assert.deepEqual(actual, expected);
});

test("sitemap exposes only canonical HTTPS public pages", () => {
  const sitemap = publicSitemap(PUBLIC_SITE_URL);
  assert.deepEqual(
    sitemap.map((entry) => entry.url),
    PUBLIC_INDEXABLE_PATHS.map((routePath) => new URL(routePath, PUBLIC_SITE_URL).href),
  );
  for (const entry of sitemap) {
    const url = new URL(entry.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.origin, PUBLIC_SITE_URL);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(url.pathname.startsWith("/api/"), false);
  }
});

test("robots permits public pages without blocking Next assets", () => {
  const robots = publicRobots(PUBLIC_SITE_URL);
  assert.deepEqual(robots.rules, {
    userAgent: "*",
    allow: "/",
    disallow: "/api/",
  });
  assert.equal(robots.sitemap, `${PUBLIC_SITE_URL}/sitemap.xml`);
  assert.equal(robots.rules.disallow.includes("/_next/"), false);
});

test("llms discovery paths are indexable and resolve to public pages", async () => {
  for (const routePath of LLMS_DISCOVERY_PATHS) {
    assert.equal(PUBLIC_INDEXABLE_PATHS.includes(routePath), true);
    const pagePath = routePath === "/"
      ? path.join(appRoot, "page.tsx")
      : path.join(appRoot, routePath.slice(1), "page.tsx");
    await access(pagePath, constants.R_OK);
  }
});
