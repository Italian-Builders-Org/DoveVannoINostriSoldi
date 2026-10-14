import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import "./helpers/register-ts-alias.mjs";

const { projectBoardTileSeries, resolveActiveSeriesIds } = await import(
  "../src/lib/boards/tile-series.ts"
);

test("debt tile projects monthly stock and switchable interest series", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("../src/data/generated/public-debt.json", import.meta.url), "utf8"),
  );
  // Shape closest to getPublicDebtView(): stock.history + citizenImpact.annualInterest.history
  const raw = {
    ok: true,
    stock: snapshot.stock,
    citizenImpact: {
      annualInterest: {
        ...snapshot.annualInterest,
        history: snapshot.annualInterest.history,
      },
    },
    caveats: snapshot.caveats,
  };
  const stock = projectBoardTileSeries("debito_pubblico_italiano", raw, {});
  assert.ok(stock.points.length >= 12);
  assert.ok(stock.kpi);
  assert.ok(stock.series.some((item) => item.id === "stock"));
  assert.ok(stock.series.some((item) => item.id === "interest"));
  assert.equal(resolveActiveSeriesIds(stock, {}).includes("stock"), true);

  const interest = projectBoardTileSeries("debito_pubblico_italiano", raw, {
    series_key: "interest",
  });
  assert.ok(interest.points.length >= 4);
  assert.ok(interest.points.every((point) => "interest" in point.values));
});

test("SIOPE-like payload projects monthly and regional series", () => {
  const raw = {
    year: 2025,
    totalPaid: 1_000_000,
    monthly: [
      { month: 1, label: "Gennaio", flow: 100 },
      { month: 2, label: "Febbraio", flow: 200 },
      { month: 3, label: "Marzo", flow: 150 },
      { month: 4, label: "Aprile", flow: 180 },
      { month: 5, label: "Maggio", flow: 220 },
      { month: 6, label: "Giugno", flow: 210 },
    ],
    regions: [
      { region: "Lombardia", value: 500 },
      { region: "Lazio", value: 400 },
      { region: "Sicilia", value: 300 },
      { region: "Campania", value: 250 },
      { region: "Veneto", value: 200 },
    ],
  };
  const monthly = projectBoardTileSeries("siope_comuni", raw, { series_key: "flow" });
  assert.equal(monthly.points.length, 6);
  assert.ok(monthly.kpi);

  const regions = projectBoardTileSeries("siope_comuni", raw, { series_key: "region" });
  assert.equal(regions.points.length, 5);
  assert.ok(regions.points[0].values.region > 0);
});

test("SSN-like payload keeps multiple series on one timeline", () => {
  const raw = {
    years: Array.from({ length: 10 }, (_, index) => ({
      year: 2015 + index,
      values: {
        productionCosts: (100 + index) * 100,
        personnelCost: (40 + index) * 100,
        purchasedServices: (50 + index) * 100,
      },
    })),
  };
  const payload = projectBoardTileSeries("openbdap_ssn_storico_nazionale", raw, {});
  assert.equal(payload.points.length, 10);
  const ids = resolveActiveSeriesIds(payload, {});
  assert.ok(ids.includes("productionCosts"));
  assert.ok(ids.includes("personnelCost"));
});

test("SIOPE receipts unwrap national monthly series", () => {
  const raw = {
    dataset: "siope_entrate_comuni",
    national: {
      year: 2025,
      totalCollected: 50_000_000,
      monthly: [
        { month: 1, label: "Gennaio", flow: 10 },
        { month: 2, label: "Febbraio", flow: 20 },
        { month: 3, label: "Marzo", flow: 15 },
      ],
      regions: [
        { region: "Lombardia", value: 30 },
        { region: "Lazio", value: 20 },
      ],
    },
  };
  const payload = projectBoardTileSeries("siope_entrate_comuni", raw, {});
  assert.equal(payload.points.length, 3);
  assert.ok(payload.kpi);
  assert.equal(payload.kpi.value, 50_000_000);
  assert.ok(payload.series.some((item) => item.id === "flow"));
});

test("Eurostat COFOG with year filter projects function bars", () => {
  const raw = {
    functions: [
      { code: "TOTAL", label: "Total" },
      { code: "GF01", label: "General public services" },
      { code: "GF07", label: "Health" },
    ],
    observations: [
      { year: 2024, function: "TOTAL", amountCents: 100_000_00, geo: "IT" },
      { year: 2024, function: "GF01", amountCents: 40_000_00, geo: "IT" },
      { year: 2024, function: "GF07", amountCents: 60_000_00, geo: "IT" },
    ],
  };
  const payload = projectBoardTileSeries("eurostat_cofog", raw, { year: 2024 });
  assert.ok(payload.points.length >= 2);
  assert.ok(payload.points.every((point) => "function" in point.values));
  assert.ok(!payload.caveat?.includes("non ancora mappata"));
});

test("Consulenti incarichi projects external and employee paid series", () => {
  const raw = {
    externalAppointments: [
      { year: 2023, paidCents: 100_00, assignments: 10 },
      { year: 2024, paidCents: 200_00, assignments: 20 },
    ],
    employeeAppointments: [
      { year: 2023, paidCents: 50_00, assignments: 5 },
      { year: 2024, paidCents: 80_00, assignments: 8 },
    ],
  };
  const payload = projectBoardTileSeries("consulenti_incarichi", raw, {});
  assert.equal(payload.points.length, 2);
  assert.ok(payload.series.some((item) => item.id === "external"));
  assert.ok(payload.series.some((item) => item.id === "employee"));
  assert.equal(payload.points[1].values.external, 200);
  assert.ok(payload.kpi);
});

test("CPT regional rows project expenditure bars", () => {
  const raw = {
    year: 2023,
    rows: [
      { region: "Lombardia", expenditureCents: 300_00, revenueCents: 280_00 },
      { region: "Lazio", expenditureCents: 200_00, revenueCents: 190_00 },
      { region: "Sicilia", expenditureCents: 150_00, revenueCents: 140_00 },
    ],
  };
  const payload = projectBoardTileSeries("cpt_finanza_regionale", raw, {});
  assert.equal(payload.points.length, 3);
  assert.equal(payload.points[0].label, "Lombardia");
  assert.ok(payload.series.some((item) => item.id === "expenditure"));
});
