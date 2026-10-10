import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  buildPaycheckCurve,
  computePaycheck,
  formatPaycheckEuro,
  parsePaycheckAnnualGross,
  PAYCHECK_DEFAULT_ANNUAL_GROSS_EUR,
  EMPLOYEE_SSC_RATE,
  solveAnnualGrossForAnnualNetEur,
  solveAnnualGrossForMonthlyNetEur,
} = await import("../src/lib/paycheck-counter.ts");
const {
  employerInpsRate,
  employerProfileById,
  INPS_CONTRIBUTION_CEILING_2026_EUR,
} = await import("../src/lib/paycheck-employer.ts");
const {
  irpefNetEur,
  applyProgressiveTax,
  regionalSurtaxForCode,
  employmentDeductionEur,
  PAYCHECK_TAX_YEAR,
  REGIONAL_SURTAX_BY_CODE,
  LOMBARDIA_REGIONAL_BANDS,
} = await import("../src/lib/paycheck-tax-rules.ts");
const {
  buildPaycheckShareCardInput,
  buildPaycheckShareCardPath,
  buildPaycheckShareMessage,
  parsePaycheckShareCardSearchParams,
  PaycheckShareCardError,
  PAYCHECK_SHARE_X_HANDLE,
} = await import("../src/lib/paycheck-share-card.ts");
const { GET } = await import("../src/app/api/share/busta-paga/route.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");
const { getPaycheckCounterView } = await import("../src/lib/paycheck-counter-view.ts");
const { comparePaycheckNetsByRegion } = await import("../src/lib/paycheck-region-comparison.ts");

const page = await readFile(new URL("../src/app/busta-paga/page.tsx", import.meta.url), "utf8");
const counterUi = await readFile(
  new URL("../src/app/busta-paga/paycheck-counter.tsx", import.meta.url),
  "utf8",
);
const docs = await readFile(new URL("../docs/DATA_SOURCES.md", import.meta.url), "utf8");
const chartUi = await readFile(
  new URL("../src/app/busta-paga/paycheck-curve-chart.tsx", import.meta.url),
  "utf8",
);
const shareImage = await readFile(
  new URL("../src/lib/paycheck-share-card-image.ts", import.meta.url),
  "utf8",
);

const lombardia = {
  code: "03",
  name: "Lombardia",
  effectiveRegionalSurtaxRate: 0.014276,
  effectiveMunicipalSurtaxRate: 0.006585,
  regionalSchedule: "published-2026",
};

const sampleMissions = [
  { mission: "Politiche previdenziali", label: "Previdenza", share: 0.4 },
  { mission: "Tutela della salute", label: "Salute", share: 0.25 },
  { mission: "Istruzione scolastica", label: "Istruzione", share: 0.1 },
  { mission: "Debito pubblico", label: "Debito pubblico", share: 0.08 },
];

function regionStub(code, name, municipal = 0.006) {
  return {
    code,
    name,
    effectiveRegionalSurtaxRate: 0.015,
    effectiveMunicipalSurtaxRate: municipal,
    regionalSchedule: "published-2026",
  };
}

test("IRPEF 2026 brackets and employment deduction", () => {
  assert.equal(PAYCHECK_TAX_YEAR, 2026);
  assert.equal(EMPLOYEE_SSC_RATE, 0.0919);
  assert.ok(Math.abs(employmentDeductionEur(15_000) - 1_955) < 0.01);
  assert.ok(Math.abs(employmentDeductionEur(28_000) - (1_910 + 65)) < 0.01);
  assert.ok(irpefNetEur(28_000) > 0);
  assert.ok(irpefNetEur(50_000) > irpefNetEur(28_000));
});

test("all 20 ISTAT regions have a published 2026 regional schedule", () => {
  const codes = Object.keys(REGIONAL_SURTAX_BY_CODE).sort();
  assert.equal(codes.length, 20);
  assert.deepEqual(
    codes,
    [
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
      "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
    ],
  );
});

test("50k RAL Lombardia lands near ChatGPT-recomputed ~2.717 € net (12m)", () => {
  const result = computePaycheck({
    annualGrossEur: 50_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 12,
  });

  assert.equal(result.monthlyGrossCents, 416_667);
  assert.equal(result.payMonths, 12);
  assert.equal(result.region.regionalSchedule, "published-2026");

  const ssc = result.deductions.find((row) => row.key === "employeeSsc");
  const irpef = result.deductions.find((row) => row.key === "irpef");
  const regional = result.deductions.find((row) => row.key === "regionalSurtax");
  assert.ok(ssc && irpef && regional);
  assert.ok(Math.abs(ssc.monthlyCents - 38_292) <= 2);
  assert.ok(Math.abs(irpef.monthlyCents - 98_206) <= 50);
  assert.ok(Math.abs(regional.monthlyCents - 5_744) <= 20);
  assert.ok(
    result.monthlyNetCents >= 271_000 && result.monthlyNetCents <= 272_500,
    `expected ~2717€, got ${result.monthlyNetCents / 100}`,
  );
  assert.ok(result.monthlyNetCents < 279_600, "must not reproduce the old 2.796€ overestimate");
});

test("13 mensilità lowers per-paycheck net but keeps annual tax on RAL", () => {
  const twelve = computePaycheck({
    annualGrossEur: 50_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 12,
  });
  const thirteen = computePaycheck({
    annualGrossEur: 50_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  assert.equal(thirteen.payMonths, 13);
  assert.ok(thirteen.monthlyGrossCents < twelve.monthlyGrossCents);
  assert.ok(thirteen.monthlyNetCents < twelve.monthlyNetCents);
  // Annual net ≈ monthly × months should match within rounding
  const annual12 = twelve.monthlyNetCents * 12;
  const annual13 = thirteen.monthlyNetCents * 13;
  assert.ok(Math.abs(annual12 - annual13) < 200, "annual net should be ~equal");
});

test("Lazio preferential rate under 28k taxable; progressive above", () => {
  const lazio = regionStub("12", "Lazio");
  // Taxable after SSC on 25k RAL ≈ 22.7k → under 28k → flat 1.73%
  const low = computePaycheck({ annualGrossEur: 25_000, region: lazio, missions: sampleMissions });
  const taxableLow = 25_000 * (1 - 0.0919);
  assert.ok(taxableLow <= 28_000);
  const expectedLow = Math.round((taxableLow * 0.0173 * 100) / 12);
  const regionalLow = low.deductions.find((row) => row.key === "regionalSurtax");
  assert.equal(regionalLow?.monthlyCents, expectedLow);

  // 50k RAL taxable ≈ 45.4k → progressive + no 60€ deduction (outside 28-30k)
  const high = regionalSurtaxForCode(45_405, "12");
  assert.ok(high != null);
  assert.ok(high > 45_405 * 0.0173);
});

test("FVG reduced flat rate under 15k; full flat above", () => {
  assert.equal(regionalSurtaxForCode(10_000, "06"), 10_000 * 0.007);
  assert.equal(regionalSurtaxForCode(20_000, "06"), 20_000 * 0.0123);
});

test("Valle d'Aosta exempt under 15k", () => {
  assert.equal(regionalSurtaxForCode(12_000, "02"), 0);
  assert.equal(regionalSurtaxForCode(20_000, "02"), 20_000 * 0.0123);
});

test("Piemonte progressive differs from Lombardia at 50k taxable", () => {
  const taxable = 45_405;
  const piemonte = regionalSurtaxForCode(taxable, "01");
  const lombardiaTax = regionalSurtaxForCode(taxable, "03");
  assert.ok(piemonte != null && lombardiaTax != null);
  assert.ok(piemonte > lombardiaTax);
});

test("Lombardia regional bands match progressive schedule", () => {
  const taxable = 50_000 * (1 - 0.0919);
  const expected = applyProgressiveTax(taxable, LOMBARDIA_REGIONAL_BANDS);
  const result = computePaycheck({
    annualGrossEur: 50_000,
    region: lombardia,
    missions: sampleMissions,
  });
  const regional = result.deductions.find((row) => row.key === "regionalSurtax");
  assert.ok(regional);
  assert.ok(Math.abs(regional.monthlyCents - Math.round((expected * 100) / 12)) <= 1);
});

test("computePaycheck derives monthly net and mission allocation", () => {
  const result = computePaycheck({
    annualGrossEur: 36_000,
    region: lombardia,
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

test("paycheck share card round-trips, tags @DVNSoldi, and GET returns PNG", async () => {
  const computation = computePaycheck({
    annualGrossEur: 30_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  const input = buildPaycheckShareCardInput(computation);
  assert.equal(input.payMonthsLabel, "13 mensilità");
  const path = buildPaycheckShareCardPath(input);
  assert.match(path, /^\/api\/share\/busta-paga\?/);
  assert.match(path, /months=/);
  const params = new URL(path, "https://example.test").searchParams;
  const parsed = parsePaycheckShareCardSearchParams(params);
  assert.equal(parsed.regionName, "Lombardia");
  assert.equal(parsed.payMonthsLabel, "13 mensilità");
  const message = buildPaycheckShareMessage(input);
  assert.match(message, /Lombardia/);
  assert.match(message, /@DVNSoldi/);
  assert.equal(PAYCHECK_SHARE_X_HANDLE, "@DVNSoldi");
  assert.match(shareImage, /@DVNSoldi/);
  assert.match(shareImage, /IRPEF 2026/);
  assert.doesNotMatch(shareImage, /OECD/);

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

test("paycheck counter view wires all regions to published-2026", async () => {
  const view = await getPaycheckCounterView();
  assert.equal(view.employeeSscRate, 0.0919);
  assert.equal(view.taxYear, 2026);
  assert.equal(view.defaultPayMonths, 12);
  assert.deepEqual([...view.payMonthOptions], [12, 13, 14]);
  assert.equal(view.regions.length, 20);
  assert.ok(view.regions.every((row) => row.regionalSchedule === "published-2026"));
  assert.ok(view.caveats.some((text) => /Mensilità/i.test(text)));
  assert.ok(view.caveats.some((text) => /Dipartimento delle Finanze/i.test(text)));
  assert.ok(view.caveats.some((text) => /mappa/i.test(text)));
});

test("region net map ranks Trentino high and Lazio low at 50k / 12m", async () => {
  const view = await getPaycheckCounterView();
  const comparison = comparePaycheckNetsByRegion({
    annualGrossEur: 50_000,
    payMonths: 12,
    regions: view.regions,
    missions: view.missions,
  });
  assert.equal(comparison.rows.length, 20);
  assert.equal(comparison.rows[0].code, "04");
  assert.equal(comparison.rows.at(-1)?.code, "12");
  assert.ok(comparison.maxNetCents - comparison.minNetCents > 5_000);
  // Lombardia mid-pack, near ChatGPT ~2717–2720
  const lombardia = comparison.rows.find((row) => row.code === "03");
  assert.ok(lombardia);
  assert.ok(lombardia.monthlyNetCents >= 271_000 && lombardia.monthlyNetCents <= 272_500);
});

test("employer charges use statutory INPS lines, TFR / 13.5 and illustrative INAIL", () => {
  assert.equal(INPS_CONTRIBUTION_CEILING_2026_EUR, 122_295);
  assert.ok(Math.abs(employerInpsRate(employerProfileById("commerce-to-50")) - 0.2898) < 1e-9);
  assert.ok(Math.abs(employerInpsRate(employerProfileById("industry-clerical-16-50")) - 0.2906) < 1e-9);
  assert.ok(Math.abs(employerInpsRate(employerProfileById("industry-blue-16-50")) - 0.3128) < 1e-9);
  assert.ok(Math.abs(employerInpsRate(employerProfileById("construction-blue-16-50")) - 0.3428) < 1e-9);

  // 2.000 € × 14 mensilità. TFR is pay / 13.5, not a rounded 31% of RAL.
  const example = computePaycheck({
    annualGrossEur: 2_000 * 14,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 14,
    employerProfileId: "commerce-to-50",
    inailPresetId: "office",
  });
  assert.equal(example.annualGrossCents, 2_800_000);
  assert.equal(example.monthlyGrossCents, 200_000);
  const tfrAnnual = example.employerCharges
    .filter((row) => row.key === "tfrFinancing" || row.key === "tfrAccrual")
    .reduce((sum, row) => sum + row.annualCents, 0);
  assert.equal(tfrAnnual, Math.round((28_000 / 13.5) * 100));
  const inpsAnnual = example.employerCharges
    .filter((row) => row.key.startsWith("inps"))
    .reduce((sum, row) => sum + row.annualCents, 0);
  assert.equal(inpsAnnual, Math.round(28_000 * 0.2898 * 100));
  assert.notEqual(inpsAnnual, Math.round(28_000 * 0.31 * 100));
  const inail = example.employerCharges.find((row) => row.key === "inail");
  assert.equal(inail?.annualCents, 11_200);
  assert.equal(
    example.annualCompanyCostCents,
    example.annualGrossCents + example.annualEmployerCents,
  );
  assert.ok(example.monthlyEmployerCents > 0);
  assert.ok(example.monthlyCompanyCostCents > example.monthlyGrossCents);
});

test("INPS contributions stop at the 2026 ceiling; TFR stays on full pay", () => {
  const high = computePaycheck({
    annualGrossEur: 200_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 12,
  });
  assert.equal(high.inpsBaseCapped, true);
  assert.equal(high.inpsBaseCents, INPS_CONTRIBUTION_CEILING_2026_EUR * 100);
  const ivs = high.employerCharges.find((row) => row.key === "inpsIvs");
  assert.equal(ivs?.annualCents, Math.round(INPS_CONTRIBUTION_CEILING_2026_EUR * 0.2381 * 100));
  const ssc = high.deductions.find((row) => row.key === "employeeSsc");
  const cappedMonthlySsc = Math.round(
    Math.round(INPS_CONTRIBUTION_CEILING_2026_EUR * EMPLOYEE_SSC_RATE * 100) / 12,
  );
  assert.equal(ssc?.monthlyCents, cappedMonthlySsc);
  const tfrAnnual = high.employerCharges
    .filter((row) => row.key === "tfrFinancing" || row.key === "tfrAccrual")
    .reduce((sum, row) => sum + row.annualCents, 0);
  assert.equal(tfrAnnual, Math.round((200_000 / 13.5) * 100));
});

test("net curve rises with annual gross and with employer charges", () => {
  const curve = buildPaycheckCurve({
    annualGrossEur: 30_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 12,
    employerProfileId: "commerce-to-50",
    inailPresetId: "office",
  });
  const current = curve.find((point) => point.isCurrent);
  assert.ok(current);
  assert.equal(current.annualGrossEur, 30_000);
  assert.equal(curve.length, 20);
  assert.equal(curve[0].annualGrossEur, 5_000);
  assert.equal(curve.at(-1).annualGrossEur, 100_000);
  assert.equal(curve[1].annualGrossEur - curve[0].annualGrossEur, 5_000);
  assert.ok(!curve.some((point) => point.annualGrossEur > 100_000));
  assert.ok(curve.at(-1).monthlyNetEur > curve[0].monthlyNetEur);
  assert.ok(curve.at(-1).employerAnnualEur > curve[0].employerAnnualEur);
  assert.ok(current.employerAnnualEur < current.annualGrossEur);
  assert.ok(current.annualNetEur > 0);
  assert.ok(current.annualNetEur < current.annualGrossEur);
  assert.ok(current.companyAnnualEur > current.annualGrossEur);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index].annualGrossEur > curve[index - 1].annualGrossEur);
  }
});

test("monthly and annual net invert to a nearby RAL", () => {
  const known = computePaycheck({
    annualGrossEur: 30_000,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  const monthlyTarget = Math.round(known.monthlyNetCents / 100);
  const fromMonthly = solveAnnualGrossForMonthlyNetEur({
    targetMonthlyNetEur: monthlyTarget,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  const backMonthly = computePaycheck({
    annualGrossEur: fromMonthly,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  assert.ok(Math.abs(backMonthly.monthlyNetCents - monthlyTarget * 100) <= 100);

  const annualTarget = Math.round((known.monthlyNetCents * known.payMonths) / 100);
  const fromAnnual = solveAnnualGrossForAnnualNetEur({
    targetAnnualNetEur: annualTarget,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  const backAnnual = computePaycheck({
    annualGrossEur: fromAnnual,
    region: lombardia,
    missions: sampleMissions,
    payMonths: 13,
  });
  assert.ok(Math.abs(backAnnual.monthlyNetCents * backAnnual.payMonths - annualTarget * 100) <= 100);

  assert.equal(
    solveAnnualGrossForMonthlyNetEur({
      targetMonthlyNetEur: 1,
      region: lombardia,
      missions: sampleMissions,
      payMonths: 12,
    }),
    5_000,
  );
  assert.equal(
    solveAnnualGrossForMonthlyNetEur({
      targetMonthlyNetEur: 400_000,
      region: lombardia,
      missions: sampleMissions,
      payMonths: 12,
    }),
    500_000,
  );
});

test("busta-paga page is wired in nav, sitemap, search and docs", () => {
  assert.match(page, /Contatore busta paga/);
  assert.match(page, /Non sostituisce/);
  assert.match(page, /scaglioni|IRPEF 2026/);
  assert.match(page, /art\. 2120/);
  assert.match(counterUi, /paycheck-monthly-gross-input/);
  assert.match(counterUi, /paycheck-monthly-net-input/);
  assert.match(counterUi, /paycheck-annual-net-input/);
  assert.match(counterUi, /PaycheckCurveChart/);
  assert.match(chartUi, /BarChart/);
  assert.match(chartUi, /RAL dipendente/);
  assert.match(chartUi, /Netto dipendente/);
  assert.match(chartUi, /Costo azienda annuale/);
  assert.doesNotMatch(chartUi, /type="checkbox"/);
  assert.doesNotMatch(chartUi, /LineChart/);
  assert.match(counterUi, /Oneri a carico del datore/);
  assert.match(docs, /Contatore busta paga/);
  assert.match(docs, /9,19%/);
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
