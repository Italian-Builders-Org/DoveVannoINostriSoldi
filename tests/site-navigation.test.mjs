import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const navigationSource = fs.readFileSync(
  new URL("../src/lib/site-navigation.ts", import.meta.url),
  "utf8",
);
const browserCoreSource = fs.readFileSync(new URL("../scripts/browser/core.mjs", import.meta.url), "utf8");
const layoutSource = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const globalsCss = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const { activeNavSection, isNavChildActive, isNavSectionActive, PRIMARY_NAV } = await import("../src/lib/site-navigation.ts");

test("site navigation exposes coesione asili in primary and footer maps", () => {
  assert.match(navigationSource, /href: "\/coesione\/asili", label: "Asili e prima infanzia"/);
  assert.match(navigationSource, /title: "Fondi e progetti"/);
  assert.match(navigationSource, /FOOTER_SITEMAP_GROUPS/);
  assert.match(navigationSource, /FOOTER_SITEMAP_COLUMNS = 4/);
  assert.match(layoutSource, /SiteFooter/);
  assert.match(layoutSource, /GoogleAnalytics/);
  assert.match(globalsCss, /\.nav-submenu \{/);
  assert.doesNotMatch(globalsCss, /\.subnav-row \{/);
  assert.match(globalsCss, /\.footer-sitemap-columns \{/);
  assert.match(globalsCss, /column-count: 4/);
  assert.match(globalsCss, /break-inside: avoid/);
  assert.doesNotMatch(globalsCss, /\.footer-sitemap-rows \{/);
  assert.doesNotMatch(globalsCss, /var\(--space-5\)/);
});

test("browser copy guard matches limit and offset as whole words", () => {
  assert.match(
    browserCoreSource,
    /assert\.doesNotMatch\(text, \/API struttura\|Dataset UO\|Dataset AOO\|\\blimit\\b\|\\boffset\\b\/i\)/,
  );
});

test("every page offers the rest of its section without the header menu", async () => {
  const [component, layout, css] = await Promise.all([
    readFile(new URL("../src/components/section-nav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/section-nav.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /<SectionNav \/>/);
  assert.match(component, /activeNavSection/);
  assert.match(component, /isNavChildActive/);
  // A section with a single page has nothing to offer and renders nothing.
  assert.match(component, /if \(pages\.length < 2\) return null;/);
  // The current page is a destination already reached, not a link back to here.
  assert.match(component, /aria-current="page"/);
  assert.doesNotMatch(component, /subnav-row|nav\.subnav/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /border-radius\s*:/);
});

test("public legal pages do not expose a personal mailbox", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/supporto/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/site.ts", import.meta.url), "utf8"),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /mailto:/i);
    assert.doesNotMatch(source, /@gmail\.com/i);
  }
  assert.doesNotMatch(files[0], /panel-title">Titolare/i);
  assert.doesNotMatch(files.join("\n"), /\/consulenza/);
  assert.match(files[0], /Google Analytics 4/);
});

test("supporters page lists the current acknowledgements", async () => {
  const [page, supporters, footer, site, globals] = await Promise.all([
    readFile(new URL("../src/app/supporter/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supporters.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/site-footer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/site.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(supporters, /regolo\.ai/);
  assert.match(supporters, /mantoventure\.com/);
  assert.match(supporters, /italianbuilders\.co/);
  assert.match(supporters, /modello GLM/);
  assert.match(supporters, /INDIVIDUAL_SUPPORTERS/);
  assert.match(page, /SITE_SUPPORTERS/);
  assert.match(page, /INDIVIDUAL_SUPPORTERS/);
  assert.match(page, /unità compute acquistate, non importi/);
  assert.match(page, /non è[\s\S]*una verifica dell&apos;identità reale/);
  assert.match(page, /Mostriamo solo[\s\S]*nomi e messaggi pubblici/);
  assert.match(page, /BUY_ME_A_COFFEE_URL/);
  assert.match(page, /supporter\.href \?/);
  assert.match(footer, /href="\/supporter"/);
  assert.match(footer, /BUY_ME_A_COFFEE_URL/);
  assert.match(footer, /Buy me an AI compute/);
  assert.match(footer, /SITE_SUPPORTERS/);
  assert.match(footer, /Supportata da/);
  assert.match(footer, /MANTO_VENTURE\.href/);
  assert.match(supporters, /href: "https:\/\/mantoventure\.com"/);
  assert.match(site, /BUY_ME_A_COFFEE_URL = "https:\/\/www\.buymeacoffee\.com\/dovevannoinostrisoldi"/);
  assert.match(site, /https:\/\/www\.threads\.com\/@dovevannoinostrisoldi/);
  assert.match(site, /https:\/\/www\.facebook\.com\/profile\.php\?id=61593922084084/);
  assert.match(site, /https:\/\/www\.instagram\.com\/dovevannoinostrisoldi\//);
  assert.match(site, /https:\/\/www\.tiktok\.com\/@dovevannoinostrisoldi/);
  assert.match(site, /https:\/\/x\.com\/DVNSoldi/);
  assert.match(footer, /SOCIAL_LINKS/);
  assert.match(footer, /footer-social/);
  assert.match(footer, /Canali/);
  assert.match(globals, /\.footer-support \{/);
  assert.match(globals, /\.footer-support-action \{/);
  assert.match(globals, /\.footer-social \{/);
  assert.match(globals, /\.footer-social \.footer-link \{[\s\S]*?min-height:\s*44px/);
  assert.match(globals, /\.footer-backer \{/);
  assert.doesNotMatch(footer, /cdnjs\.buymeacoffee\.com/);
  assert.match(navigationSource, /href: "\/supporter", label: "Chi ci sostiene"/);
});

test("Google Analytics loads only on the public site hostname", async () => {
  const [analytics, site] = await Promise.all([
    readFile(new URL("../src/components/google-analytics.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/site.ts", import.meta.url), "utf8"),
  ]);
  assert.match(site, /GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-6NKJM5HWR4"/);
  assert.match(analytics, /next\/script/);
  assert.match(analytics, /strategy="afterInteractive"/);
  assert.match(analytics, /PUBLIC_SITE_URL/);
  assert.match(analytics, /window\.location\.hostname ===/);
  assert.match(analytics, /document\.createElement\('script'\)/);
  assert.match(analytics, /document\.head\.appendChild\(analyticsScript\)/);
  assert.doesNotMatch(analytics, /<Script\s+src=/);
  assert.match(analytics, /gtag\('config'/);
});

test("activeNavSection resolves nested routes to the parent menu", () => {
  const coesione = activeNavSection("/coesione/asili");
  assert.equal(coesione?.href, "/coesione");
  assert.ok(coesione?.children?.some((child) => child.href === "/coesione/asili"));

  const enti = activeNavSection("/enti/c_a783");
  assert.equal(enti?.href, "/enti");

  const appalti = activeNavSection("/appalti");
  assert.equal(appalti?.href, "/controlli");
  assert.equal(isNavChildActive("/appalti", "/appalti", appalti.children), true);
  assert.deepEqual(
    appalti?.children?.map((child) => child.label),
    ["Appalti", "Incarichi", "Catalogo dati", "Segnali", "Sintesi", "Esplora relazioni"],
  );

  const sintesi = activeNavSection("/controlli/sintesi");
  assert.equal(sintesi?.href, "/controlli");
  assert.equal(isNavChildActive("/controlli/sintesi", "/controlli/sintesi", sintesi.children), true);

  const catalog = activeNavSection("/dati/vincitori");
  assert.equal(catalog?.href, "/controlli");
  assert.equal(isNavChildActive("/dati/vincitori", "/dati", catalog.children), true);
  assert.equal(isNavChildActive("/dati/vincitori", "/controlli", catalog.children), false);

  const incarichi = activeNavSection("/incarichi");
  assert.equal(incarichi?.href, "/controlli");

  const stato = activeNavSection("/stato");
  assert.equal(stato?.href, "/spese");
  const debito = activeNavSection("/debito");
  assert.equal(debito?.href, "/spese");
  assert.ok(debito?.children?.some((child) => child.href === "/debito"));

  assert.equal(
    isNavChildActive("/coesione/asili", "/coesione/asili", coesione.children),
    true,
  );
  assert.equal(
    isNavChildActive("/coesione/asili", "/coesione", coesione.children),
    false,
  );
});

test("studies and their alias select a single dedicated primary section", () => {
  for (const path of ["/studi", "/studi/dai-fondi-ai-posti", "/paper"]) {
    assert.deepEqual(PRIMARY_NAV.filter((item) => isNavSectionActive(path, item)).map((item) => item.href), ["/studi"]);
  }
});
