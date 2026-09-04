import assert from "node:assert/strict";
import fs from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const navigationSource = fs.readFileSync(
  new URL("../src/lib/site-navigation.ts", import.meta.url),
  "utf8",
);
const navigationComponentSource = fs.readFileSync(
  new URL("../src/components/navigation.tsx", import.meta.url),
  "utf8",
);
const layoutSource = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const globalsCss = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const {
  activeNavSection,
  isNavChildActive,
  DASHBOARD_NAV,
  PRIMARY_NAV,
} = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { EDITORIAL_TOPICS } = await import("../src/lib/integrated-editorial.ts");
const { isEventTargetWithin } = await import("../src/lib/navigation-boundary.ts");

async function pageRoutes(relativePath = "") {
  const entries = await readdir(
    new URL(`../src/app/${relativePath}`, import.meta.url),
    { withFileTypes: true },
  );
  const routes = [];
  for (const entry of entries) {
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      routes.push(...await pageRoutes(childPath));
    } else if (entry.name === "page.tsx") {
      routes.push(relativePath ? `/${relativePath}` : "/");
    }
  }
  return routes;
}

function routePatternMatches(pathname, routePattern) {
  const pathSegments = pathname.split("/").filter(Boolean);
  const routeSegments = routePattern.split("/").filter(Boolean);
  return pathSegments.length === routeSegments.length
    && routeSegments.every((segment, index) => (
      segment.startsWith("[") && segment.endsWith("]")
        ? pathSegments[index].length > 0
        : segment === pathSegments[index]
    ));
}

test("site navigation exposes coesione asili without a duplicate global footer", () => {
  assert.match(navigationSource, /href: "\/coesione\/asili", label: "Asili e prima infanzia"/);
  assert.match(navigationSource, /title: "Fondi e progetti"/);
  assert.doesNotMatch(navigationSource, /FOOTER_SITEMAP_GROUPS|FOOTER_SITEMAP_COLUMNS/);
  assert.doesNotMatch(layoutSource, /SiteFooter|latestTerritorialCheckLabel/);
  assert.match(layoutSource, /GoogleAnalytics/);
  assert.match(globalsCss, /\.nav-submenu \{/);
  assert.doesNotMatch(globalsCss, /\.subnav-row \{/);
  assert.doesNotMatch(globalsCss, /\.site-footer|\.footer-sitemap|\.footer-support/);
  assert.doesNotMatch(globalsCss, /var\(--space-5\)/);
});

test("dashboard navigation keeps flyout panels and no duplicate subnav bar", async () => {
  const navigationComponent = await readFile(
    new URL("../src/components/navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(navigationComponent, /nav-submenu/);
  assert.doesNotMatch(navigationComponent, /subnav-row|nav\.subnav/);
});

test("sidebar keeps the DVNS mark and exposes a real supporter route", async () => {
  const navigationComponent = await readFile(
    new URL("../src/components/navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(navigationComponent, /src="\/brand\/dvns-mark-transparent\.svg"/);
  assert.doesNotMatch(navigationComponent, /dvns-lv-mark\.svg/);
  assert.match(navigationComponent, /className="sidebar-support"/);
  assert.match(navigationComponent, /href="\/supporter"/);
  assert.match(navigationComponent, /Sostieni il progetto/);
  assert.match(globalsCss, /\.sidebar-support \{/);
});

test("sidebar restores compact project metadata and legal contact links", () => {
  assert.match(navigationComponentSource, /<footer className="sidebar-meta"/);
  assert.match(navigationComponentSource, /<nav aria-label="Informazioni del sito">/);
  for (const href of ["/supporter", "/metodologia", "/privacy", "/termini", "/supporto"]) {
    assert.match(navigationComponentSource, new RegExp(`href="${href}"[\\s\\S]*?onClick=\\{closeNavigation\\}`));
  }
  assert.match(globalsCss, /\.sidebar-meta \{/);
  assert.match(globalsCss, /\.sidebar-meta ul \{/);
  assert.match(globalsCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(globalsCss, /\.sidebar-meta \{[\s\S]*?margin-top: auto;/);
  assert.match(globalsCss, /@media \(min-width: 901px\) and \(max-width: 1100px\),[\s\S]*?\(min-width: 901px\) and \(max-height: 900px\)/);
  assert.match(
    globalsCss,
    /@media \(max-width: 900px\)[\s\S]*?\.sidebar-meta a \{ min-height: 44px; font-size: 11px; \}/,
  );
  assert.doesNotMatch(globalsCss, /\.site-footer|\.footer-sitemap|\.footer-support/);
});

test("the GitHub mark stays geometrically centered in its circular action", () => {
  assert.match(navigationComponentSource, /aria-label="Codice su GitHub, si apre in una nuova scheda"/);
  const iconRule = globalsCss.match(/\.header-action-icon svg \{([^}]*)\}/)?.[1] ?? "";
  assert.match(iconRule, /display: block/);
  assert.doesNotMatch(iconRule, /transform|translate/);
});

test("a submenu can be opened without a pointer that can hover", async () => {
  const navigationComponent = await readFile(
    new URL("../src/components/navigation.tsx", import.meta.url),
    "utf8",
  );
  // The caret is a control, not a glyph: on a touch screen it is the only way
  // into a section's pages, since hover never fires and the label navigates.
  assert.match(navigationComponent, /<button\s+type="button"\s+className="nav-item-toggle"/);
  assert.match(navigationComponent, /aria-expanded=\{open\}/);
  assert.match(navigationComponent, /aria-controls=\{menuId\}/);
  assert.match(navigationComponent, /icon=\{ArrowDown01Icon\}/);
  assert.doesNotMatch(navigationComponent, /▾|Scorri →/);
  assert.match(navigationComponent, /event\.key !== "Escape"/);
  assert.match(navigationComponent, /document\.addEventListener\("pointerdown", dismissOutside\)/);
  // Open state carries the path it was opened on, so a completed navigation
  // closes the menu without a setState in an effect.
  assert.match(navigationComponent, /openMenu\?\.pathname === pathname/);
  // Focus and caret share one open slot so two panels cannot overlap. Pointer
  // hover does not pre-open a panel just before the caret click.
  assert.doesNotMatch(navigationComponent, /onPointerEnter=/);
  assert.match(navigationComponent, /onFocusCapture=/);
  assert.doesNotMatch(
    globalsCss,
    /\.nav-item-has-menu:hover \.nav-submenu|\.nav-item-has-menu:focus-within \.nav-submenu/,
  );

  assert.match(globalsCss, /\.nav-item-has-menu\[data-open="true"\] \.nav-submenu/);
  assert.match(globalsCss, /\.nav-item-toggle \{/);
  assert.match(globalsCss, /@media \(max-width: 900px\)/);
  // On narrow screens the same navigation becomes a real off-canvas drawer.
  assert.match(globalsCss, /\.dashboard-sidebar\[data-mobile-open="true"\] \{ transform: translateX\(0\); \}/);
  assert.match(navigationComponent, /data-mobile-open=\{mobileOpen \? "true" : undefined\}/);
  assert.match(navigationComponent, /aria-controls="dashboard-sidebar"/);
  assert.match(navigationComponent, /inert=\{mobileLayout && !mobileOpen \? true : undefined\}/);
  assert.match(navigationComponent, /isEventTargetWithin\(mobileToggleRef\.current, event\.target\)/);
  // Collapsing one section must keep the mobile drawer open and preserve the
  // native button focus; only navigation or the drawer close affordance owns
  // closeNavigation.
  assert.match(navigationComponent, /onMenuClose=\{closeMenu\}/);
  assert.match(navigationComponent, /open\s*\n\s*\? onMenuClose\(\)/);
  assert.doesNotMatch(navigationComponent, /open\s*\n\s*\? onClose\(\)/);
  assert.match(globalsCss, /grid-template-columns: minmax\(0, 1fr\) 24px/);
  assert.match(globalsCss, /\.nav-item-toggle \{[\s\S]*?width: 24px;/);
  assert.match(
    globalsCss,
    /@media \(max-width: 900px\)[\s\S]*?\.sidebar-mission a,[\s\S]*?\.sidebar-support a \{ min-height: 44px; font-size: 11px; \}/,
  );
  assert.match(
    globalsCss,
    /@media \(max-width: 900px\)[\s\S]*?\.nav-item > a \{ font-size: 12px; \}/,
  );
});

test("reference dashboard taxonomy keeps every canonical destination reachable", () => {
  const hrefs = (sections) => new Set(
    sections.flatMap((section) => [section.href, ...(section.children ?? []).map((child) => child.href)]),
  );
  const canonical = hrefs(PRIMARY_NAV);
  const dashboard = hrefs(DASHBOARD_NAV);

  assert.deepEqual(DASHBOARD_NAV.map((section) => section.label), [
    "Panoramica",
    "Mappa della spesa",
    "Enti e Amministrazioni",
    "Fornitori e Beneficiari",
    "Contratti e Gare",
    "Progetti e Opere",
    "Spesa per Categoria",
    "Anomalie e Sprechi",
    "Confronti e Benchmark",
    "AI Insights",
    "Segnalazioni dei cittadini",
    "Open Data",
    "Documentazione",
  ]);
  assert.equal(DASHBOARD_NAV.length, 13);
  assert.deepEqual([...canonical].filter((href) => !dashboard.has(href)), []);
  assert.ok(dashboard.has("/cerca"), "/cerca deve essere raggruppata in una sezione della sidebar");
  for (const href of [
    "/appalti/fornitori",
    "/incarichi/personale-organi",
    "/spese/capitoli-progetti",
    "/controlli/working-set",
    "/trasparenza/documenti-mancanti",
    "/confronti/catalogo",
  ]) {
    assert.ok(dashboard.has(href), `${href} deve restare raggiungibile dal menu`);
  }
});

test("every generated editorial page remains reachable from a sidebar section", () => {
  const dashboard = new Set(
    DASHBOARD_NAV.flatMap((section) => [section.href, ...(section.children ?? []).map((child) => child.href)]),
  );
  for (const topic of EDITORIAL_TOPICS) {
    const href = `/${topic.section}/${topic.slug}`;
    assert.ok(dashboard.has(href), `${href} deve essere raggiungibile dalla sidebar`);
  }
  assert.match(navigationSource, /href: "\/termini"/);
});

test("every local page route is grouped by one of the thirteen dashboard sections", async () => {
  const dashboardHrefs = DASHBOARD_NAV.flatMap((section) => [
    section.href,
    ...(section.aliases ?? []),
    ...(section.children ?? []).map((child) => child.href.split("?")[0]),
  ]).filter((href) => href !== "/");
  const missingRoutes = (await pageRoutes()).filter(
    (route) => route !== "/" && !dashboardHrefs.some((href) => route === href || route.startsWith(`${href}/`)),
  );
  assert.deepEqual(missingRoutes, [], `route non raggruppate: ${missingRoutes.join(", ")}`);
});

test("the public sitemap and every promoted destination resolve to a page template", async () => {
  const localRoutes = await pageRoutes();
  const promotedRoutes = DASHBOARD_NAV.flatMap((section) => [
    section.href,
    ...(section.children ?? []).map((child) => child.href.split("?", 1)[0]),
  ]);
  const missingSitemapRoutes = PUBLIC_INDEXABLE_PATHS.filter(
    (route) => !localRoutes.some((template) => routePatternMatches(route, template)),
  );
  const missingPromotedRoutes = [...new Set(promotedRoutes)].filter(
    (route) => route !== "/" && !localRoutes.some((template) => routePatternMatches(route, template)),
  );

  assert.deepEqual(
    missingSitemapRoutes,
    [],
    `pagine in sitemap senza template locale: ${missingSitemapRoutes.join(", ")}`,
  );
  assert.deepEqual(
    missingPromotedRoutes,
    [],
    `destinazioni sidebar senza template locale: ${missingPromotedRoutes.join(", ")}`,
  );
});

test("sidebar highlights only the winning section on cross-section destinations", async () => {
  const navigationComponent = await readFile(
    new URL("../src/components/navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(navigationComponent, /activeNavSection,/);
  assert.match(navigationComponent, /const activeSection = activeNavSection\(pathname\)/);
  assert.match(
    navigationComponent,
    /const active = item\.href === "\/"\s*\n\s*\? pathname === "\/"\s*\n\s*: activeSection\?\.href === item\.href;/,
  );
  assert.match(
    navigationComponent,
    /const parentCurrent = active\s*\n\s*\? \(hasChildren \? "location" : "page"\)\s*\n\s*: undefined;/,
    "la categoria attiva deve essere location quando espone un sottomenu",
  );
  assert.match(
    navigationComponent,
    /currentSearch !== null &&\s*active &&\s*isNavChildActive/,
    "solo i figli della sezione proprietaria possono essere annunciati come pagina corrente",
  );

  const expectedOwners = new Map([
    ["/fonti/catalogo", "/dati"],
    ["/fonti/copertura", "/dati"],
    ["/fonti/stato", "/dati"],
    ["/territori/confronto", "/confronti"],
    ["/appalti/fornitori", "/imprese"],
    ["/incarichi/nominativi", "/imprese"],
    ["/controlli/segnalazioni", "/supporto"],
  ]);
  for (const [route, expected] of expectedOwners) {
    assert.equal(activeNavSection(route)?.href, expected, `${route}: proprietario errato`);
  }
});

test("category roots expose one location parent and one page overview", () => {
  assert.match(
    navigationComponentSource,
    /aria-current=\{parentCurrent\}/,
    "il link della categoria deve esporre lo stato semantico calcolato",
  );

  for (const route of ["/territori", "/imprese"]) {
    const section = DASHBOARD_NAV.find((candidate) => candidate.href === route);
    assert.ok(section?.children?.length, `${route}: categoria senza sottomenu`);
    const activeChildren = section.children.filter((child) =>
      isNavChildActive(route, child.href, section.children, ""),
    );
    assert.deepEqual(
      activeChildren.map((child) => child.href),
      [route],
      `${route}: il root deve avere una sola panoramica corrente`,
    );
  }

  const businessSection = DASHBOARD_NAV.find((candidate) => candidate.href === "/imprese");
  assert.ok(businessSection?.children?.length);
  assert.deepEqual(
    businessSection.children
      .filter((child) => isNavChildActive("/imprese", child.href, businessSection.children, "metric=employees"))
      .map((child) => child.href),
    ["/imprese?metric=employees"],
    "la query Addetti deve mantenere un solo child page",
  );
});

test("navigation guards related targets before checking containment", async () => {
  const navigationComponent = await readFile(
    new URL("../src/components/navigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    navigationComponent,
    /import \{ isEventTargetWithin \} from "@\/lib\/navigation-boundary";/,
  );
  assert.equal(
    navigationComponent.match(
      /isEventTargetWithin\(navigationRef\.current, event\.relatedTarget\)/g,
    )?.length,
    2,
  );
  assert.match(navigationComponent, /href\.slice\(1\)\.replaceAll\("\/", "-"\)/);
});

test("navigation related target guard distinguishes nodes from other event targets", () => {
  const originalNode = globalThis.Node;
  class TestNode extends EventTarget {
    parent;

    constructor(parent = null) {
      super();
      this.parent = parent;
    }

    contains(target) {
      if (!(target instanceof TestNode)) throw new TypeError("contains() expects a Node");
      return target === this || (target instanceof TestNode && target.parent === this);
    }
  }

  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: TestNode,
  });

  try {
    const navigation = new TestNode();
    const internal = new TestNode(navigation);
    const external = new TestNode();
    const nonNode = new EventTarget();

    assert.equal(isEventTargetWithin(navigation, nonNode), false);
    assert.equal(isEventTargetWithin(navigation, internal), true);
    assert.equal(isEventTargetWithin(navigation, external), false);
    assert.equal(isEventTargetWithin(navigation, null), false);
  } finally {
    if (originalNode === undefined) {
      delete globalThis.Node;
    } else {
      Object.defineProperty(globalThis, "Node", {
        configurable: true,
        value: originalNode,
      });
    }
  }
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
  const [page, supporters, navigationComponent, site] = await Promise.all([
    readFile(new URL("../src/app/supporter/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supporters.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/site.ts", import.meta.url), "utf8"),
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
  assert.match(navigationComponent, /href="\/supporter"/);
  assert.match(navigationComponent, /Sostieni il progetto/);
  assert.match(site, /BUY_ME_A_COFFEE_URL = "https:\/\/www\.buymeacoffee\.com\/dovevannoinostrisoldi"/);
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
  assert.equal(enti?.href, "/istituzioni");

  const appalti = activeNavSection("/appalti");
  assert.equal(appalti?.href, "/appalti");
  assert.equal(isNavChildActive("/appalti", "/appalti", appalti.children), true);
  assert.ok(appalti?.children?.some((child) => child.href === "/incarichi"));

  const fornitori = activeNavSection("/appalti/fornitori");
  assert.equal(fornitori?.href, "/imprese");
  assert.ok(fornitori?.children?.some((child) => child.href === "/appalti/fornitori"));

  assert.equal(activeNavSection("/territori/confronto")?.href, "/confronti");
  assert.equal(activeNavSection("/controlli/segnalazioni")?.href, "/supporto");
  assert.equal(activeNavSection("/fonti/stato")?.href, "/dati");
  assert.equal(activeNavSection("/fonti/copertura")?.href, "/dati");
  assert.equal(activeNavSection("/fonti/catalogo")?.href, "/dati");

  assert.equal(activeNavSection("/territori/confronto")?.href, "/confronti");
  assert.equal(activeNavSection("/controlli/segnalazioni")?.href, "/supporto");
  assert.equal(activeNavSection("/fonti/stato")?.href, "/dati");
  assert.equal(activeNavSection("/fonti/copertura")?.href, "/dati");
  assert.equal(activeNavSection("/fonti/catalogo")?.href, "/dati");

  const catalog = activeNavSection("/dati/vincitori");
  assert.equal(catalog?.href, "/dati");
  assert.equal(isNavChildActive("/dati/vincitori", "/dati", catalog.children), true);
  assert.equal(isNavChildActive("/dati/vincitori", "/fonti", catalog.children), false);

  const incarichi = activeNavSection("/incarichi");
  assert.equal(incarichi?.href, "/appalti");

  const stato = activeNavSection("/stato");
  assert.equal(stato?.href, "/istituzioni");
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
