import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  computePaycheck,
  formatPaycheckEuro,
  parsePaycheckAnnualGross,
  PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR,
} = await import("../src/lib/paycheck-counter.ts");
const {
  buildPaycheckShareCardInput,
  buildPaycheckShareCardPath,
  buildPaycheckShareMessage,
  parsePaycheckShareCardSearchParams,
  PaycheckShareCardError,
} = await import("../src/lib/paycheck-share-card.ts");
const { GET } = await import("../src/app/api/share/busta-paga/route.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

const page = await readFile(new URL("../src/app/busta-paga/page.tsx", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/DATA_SOURCES.md", import.meta.url), "utf8");

const sampleRegion = {
  code: "03",
  name: "Lombardia",
  effectiveIrpefRate: 0.18,
  effectiveRegionalSurtaxRate: 0.012,
  effectiveMunicipalSurtaxRate: 0.005,
};

const sampleMissions = [
  { mission: "Politiche previdenziali", label: "Previdenza", share: 0.4 },
  { mission: "Tutela della salute", label: "Salute", share: 0.25 },
  { mission: "Istruzione scolastica", label: "Istruzione", share: 0.1 },
  { mission: "Debito pubblico", label: "Debito pubblico", share: 0.08 },
];

test("computePaycheck derives monthly net and mission allocation", () => {
  const result = computePaycheck({
    annualGrossEur: 36_000,
    region: sampleRegion,
    employeeSscRate: 0.095,
    missions: sampleMissions,
  });

  assert.equal(result.monthlyGrossCents, 300_000);
  assert.equal(result.deductions.length, 4);
  assert.ok(result.monthlyNetCents < result.monthlyGrossCents);
  assert.ok(result.missions.length >= 3);
  assert.equal(
    result.missions.reduce((sum, row) => sum + row.monthlyCents, 0) + result.otherMissionsCents,
    result.monthlyStateIrpefCents,
  );
  assert.equal(
    result.monthlyStateIrpefCents,
    result.deductions.find((row) => row.key === "irpef")?.monthlyCents,
  );
  assert.ok(result.monthlyTaxCents > result.monthlyStateIrpefCents);
  assert.match(formatPaycheckEuro(result.monthlyNetCents), /€/);
});

test("parsePaycheckAnnualGross clamps extremes", () => {
  assert.equal(parsePaycheckAnnualGross(100), 5_000);
  assert.equal(parsePaycheckAnnualGross(9_999_999), 500_000);
  assert.equal(parsePaycheckAnnualGross("30.000"), PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR);
});

test("paycheck share card round-trips and GET returns PNG", async () => {
  const computation = computePaycheck({
    annualGrossEur: 30_000,
    region: sampleRegion,
    employeeSscRate: 0.095,
    missions: sampleMissions,
  });
  const input = buildPaycheckShareCardInput(computation);
  const path = buildPaycheckShareCardPath(input);
  assert.match(path, /^\/api\/share\/busta-paga\?/);
  const params = new URL(path, "https://example.test").searchParams;
  const parsed = parsePaycheckShareCardSearchParams(params);
  assert.equal(parsed.regionName, "Lombardia");
  assert.match(buildPaycheckShareMessage(input), /Lombardia/);

  const response = await GET(new Request(`https://example.test${path}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /image\/png/);
});

test("paycheck share card fail-closed on missing region", () => {
  assert.throws(
    () => parsePaycheckShareCardSearchParams(new URLSearchParams({ net: "1", gross: "2", annual: "3" })),
    (error) => error instanceof PaycheckShareCardError && error.message === "missing_region",
  );
});

test("busta-paga page is wired in nav, sitemap, search and docs", () => {
  assert.match(page, /Contatore busta paga/);
  assert.match(page, /Non sostituisce/);
  assert.match(docs, /Contatore busta paga/);
  const economy = PRIMARY_NAV.find((section) => section.href === "/economia");
  assert.ok(economy?.children?.some((entry) => entry.href === "/busta-paga"));
  assert.ok(
    SITE_MAP_GROUPS.some(
      (group) => group.title === "Economia" && group.links.some((entry) => entry.href === "/busta-paga"),
    ),
  );
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/busta-paga"));
  for (const query of ["busta paga", "stipendio lordo", "addizionale regionale"]) {
    assert.ok(searchSiteDocuments(query).some((result) => result.href === "/busta-paga"), query);
  }
});
