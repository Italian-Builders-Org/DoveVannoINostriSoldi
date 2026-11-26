import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("the IRPEF page is server-rendered, bounded, and semantically explicit", async () => {
  const [page, scrollRegion] = await Promise.all([
    source("../src/app/territori/irpef/page.tsx"),
    source("../src/components/horizontal-scroll-region.tsx"),
  ]);

  assert.doesNotMatch(page, /^["']use client["'];/m);
  assert.match(page, /queryMefMunicipalIrpef/);
  assert.doesNotMatch(page, /mef-irpef-2024\.data\.json/);
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /Che cosa misura l&apos;imposta netta dichiarata/);
  assert.match(page, /MefIrpefSwissBorderNote/);
  assert.match(page, /cifra presente nelle statistiche MEF/);
  assert.match(page, /Resta separata da spesa e saldo CPT/);
  assert.match(page, /HorizontalScrollRegion/);
  assert.match(scrollRegion, /role="region"/);
  assert.match(scrollRegion, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(scrollRegion, /event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(page, /<caption>Contribuenti, redditi, imposta netta dichiarata/);
  assert.match(page, /aria-label="Paginazione dei territori"/);
  assert.match(page, /Nota metodologica ufficiale/);
  assert.match(page, /Definizioni ufficiali delle variabili/);
});

test("the IRPEF regional table defers crest images to avoid blocking critical text paint", async () => {
  const page = await source("../src/app/territori/irpef/page.tsx");
  const component = await source("../src/components/region-crest.tsx");

  assert.match(component, /loading\?: "eager" \| "lazy"/);
  assert.match(component, /loading = "eager"/);
  assert.match(component, /loading=\{loading\}/);

  // The table renders 20 region crests at once; only the first few are in the
  // initial viewport. Eagerly preloading all of them competes with the web font
  // and can push text LCP past the budget, so the table must ask for lazy load.
  const tableRegionMatch = page.match(
    /<HorizontalScrollRegion[\s\S]*?className=\{`table-scroll \$\{styles\.tableRegion\}`\}[\s\S]*?<\/HorizontalScrollRegion>/,
  );
  assert.ok(tableRegionMatch, "table region not found");
  const tableRegionCode = tableRegionMatch[0];
  assert.match(tableRegionCode, /<RegionCrest[\s\S]*?loading="lazy"/);
  assert.doesNotMatch(tableRegionCode, /<RegionCrest[\s\S]*?loading="eager"/);
});

test("the IRPEF layout keeps every grid bounded at narrow widths", async () => {
  const css = await source("../src/app/territori/irpef/irpef.module.css");

  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.filters \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 460px\)[\s\S]*?\.summary \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.hash \{ overflow-wrap: anywhere; \}/);
});

test("partial MEF values are never presented as exact totals", async () => {
  const page = await source("../src/app/territori/irpef/page.tsx");

  assert.match(page, /measure\.coverage === "partial" \? "≥ " : ""/);
  assert.match(page, /partial \? "≥ " : ""/);
  assert.match(page, /Frequenza nota:/);
  assert.match(page, /riga oscurata/);
  assert.match(page, /righe oscurate/);
});

test("MEF verification stays on its source page instead of dating the whole site", async () => {
  const [layout, page] = await Promise.all([source("../src/app/layout.tsx"), source("../src/app/territori/irpef/page.tsx")]);
  assert.doesNotMatch(layout, /mefIrpefSourceMeta|lastCheckLabel/);
  assert.match(page, /observedAt/);
});

test("the production deployment advertises HTTPS and a security contact", async () => {
  const [vercel, securityTxt] = await Promise.all([
    source("../vercel.json"),
    source("../public/.well-known/security.txt"),
  ]);

  const vercelConfig = JSON.parse(vercel);
  const catchAllRules = vercelConfig.headers.filter((rule) => rule.source === "/(.*)");
  assert.equal(catchAllRules.length, 1);

  const allHstsEntries = vercelConfig.headers.flatMap((rule) =>
    rule.headers.filter((header) => header.key.toLowerCase() === "strict-transport-security"),
  );
  assert.equal(allHstsEntries.length, 1);

  const hstsEntries = catchAllRules[0].headers.filter(
    (header) => header.key.toLowerCase() === "strict-transport-security",
  );
  assert.equal(hstsEntries.length, 1);
  assert.deepEqual(hstsEntries[0], {
    key: "Strict-Transport-Security",
    value: "max-age=31536000",
  });
  assert.doesNotMatch(hstsEntries[0].value, /includeSubDomains/i);
  assert.doesNotMatch(hstsEntries[0].value, /preload/i);
  assert.match(vercel, /X-Content-Type-Options/);
  assert.match(
    securityTxt,
    /^Contact: https:\/\/github\.com\/Italian-Builders-Org\/DoveVannoINostriSoldi\/security\/advisories\/new$/m,
  );
  assert.match(
    securityTxt,
    /^Policy: https:\/\/github\.com\/Italian-Builders-Org\/DoveVannoINostriSoldi\/security\/policy$/m,
  );
  assert.match(securityTxt, /^Expires: 2027-08-24T00:00:00\.000Z$/m);
});
