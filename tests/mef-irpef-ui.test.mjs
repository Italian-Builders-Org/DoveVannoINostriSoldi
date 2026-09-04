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

test("the global footer includes the latest MEF verification timestamp", async () => {
  const layout = await source("../src/app/layout.tsx");

  assert.match(layout, /mefIrpefSourceMeta\.period\.observedAt/);
  assert.match(layout, /Math\.max/);
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
