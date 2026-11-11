import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { sitePageHref } = await import("../src/lib/site-page-href.ts");

test("navigation from previews and the main site keeps paths, filters and fragments on the current origin", () => {
  for (const host of ["localhost", "127.0.0.1", "dvns-nuovo-stile.vercel.app", "dvns.chatgpt.site", "www.dovevannoinostrisoldi.com", "dovevannoinostrisoldi.com"]) {
    for (const path of ["/", "/supporto", "/enti/c_h501/appalti?view=operators#risultati", "/#esplora"]) {
      assert.equal(sitePageHref(path, host), path);
    }
  }
});

test("standalone atlas subdomains and the no-JavaScript fallback can still return to the main site", () => {
  for (const host of [null, "comuni.dovevannoinostrisoldi.com", "politici.dovevannoinostrisoldi.com"]) {
    assert.equal(sitePageHref("/", host), "https://www.dovevannoinostrisoldi.com/");
    assert.equal(sitePageHref("/parlamento?anno=2025#atti", host), "https://www.dovevannoinostrisoldi.com/parlamento?anno=2025#atti");
  }
});

test("absolute source URLs and fragments are not rewritten as site pages", () => {
  for (const href of ["https://www.istat.it/", "//www.istat.it/", "#fonti"]) {
    assert.equal(sitePageHref(href, null), href);
  }
});
