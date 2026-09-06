import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const detail = await import("../src/lib/siope-nonmunicipal.ts");

test("non-municipal SIOPE labels distinguish autonomous provinces within the regional compartment", () => {
  for (const [code, label] of [["r_lazio", "Regione"], ["p_TN", "Provincia autonoma"], ["p_bz", "Provincia autonoma"], ["p_AN", "Provincia"], ["cmbo", "Città metropolitana"]]) {
    assert.equal(detail.getSiopeNonMunicipalTypeLabel(detail.getSiopeNonMunicipalEntityByIpaCode(code)), label);
  }
});

test("non-municipal SIOPE year selection reports unavailable, malformed and repeated parameters", () => {
  const entity = detail.getSiopeNonMunicipalEntityByIpaCode("r_lazio");
  const select = (value) => detail.selectSiopeNonMunicipalYear(entity, value);
  assert.deepEqual(select(undefined), { selected: entity.years[0], invalidYear: false });
  for (const year of entity.years) {
    assert.deepEqual(select(String(year.year)), { selected: year, invalidYear: false });
  }
  for (const value of ["", "abc", "0", "2023", "2025.0", "2.025e3", " 2025", ["2025", "2024"], ["2025", "2025"]]) {
    assert.deepEqual(select(value), { selected: entity.years[0], invalidYear: true });
  }
});

test("non-municipal SIOPE detail has unique IPA identities and reconciled integer-cent years", () => {
  assert.match(detail.siopeNonMunicipalReleaseId, /^[a-f0-9]{64}$/);
  const known = detail.getSiopeNonMunicipalEntityByIpaCode("r_lazio");
  assert.ok(known);
  assert.equal(known.entityType, "REGIONE");
  assert.deepEqual(known.years.map((year) => year.year), [2026, 2025, 2024]);
  for (const year of known.years) {
    if (year.status !== "available") continue;
    assert.equal(year.amountCents, year.monthly.reduce((sum, point) => sum + point.amountCents, 0));
    assert.equal(year.amountCents, year.titles.reduce((sum, item) => sum + item.amountCents, 0));
    assert.ok(year.monthly.every((point) => Number.isSafeInteger(point.amountCents) && point.month >= 1 && point.month <= 12));
  }
  assert.equal(detail.getSiopeNonMunicipalEntityByIpaCode("ipa-inesistente"), null);
});

test("non-municipal SIOPE rejects a balanced compact-view mutation", async () => {
  const raw = JSON.parse(await readFile(new URL("../src/data/generated/siope-nonmunicipal-detail.json", import.meta.url), "utf8"));
  const known = raw.entities.find((entity) => entity.codiceIpa === "r_lazio");
  known.years[0].amountCents += 100;
  known.years[0].monthly[0].amountCents += 100;
  known.years[0].titles[0].amountCents += 100;
  assert.throws(() => detail.assertSiopeNonMunicipalDetail(raw), /proof|canonica|release|storica/i);
});

test("non-municipal SIOPE period status distinguishes partial current data from revisionable full years", () => {
  const known = detail.getSiopeNonMunicipalEntityByIpaCode("r_lazio");
  assert.ok(known);
  assert.deepEqual(detail.getSiopeNonMunicipalPeriodStatus(known.years[0]), {
    status: "partial-revisionable",
    latestObservedMonthMayBeIncomplete: true,
  });
  assert.deepEqual(detail.getSiopeNonMunicipalPeriodStatus(known.years[1]), {
    status: "complete-revisionable",
    latestObservedMonthMayBeIncomplete: false,
  });
});


test("non-municipal SIOPE rejects plausible provenance drift against the native manifest", async () => {
  const raw = JSON.parse(await readFile(new URL("../src/data/generated/siope-nonmunicipal-detail.json", import.meta.url), "utf8"));
  raw.entities[0].years[0].provenance.acquisitionDate = "2026-09-05T08:00:00+00:00";
  assert.throws(() => detail.assertSiopeNonMunicipalDetail(raw), /provenienza|storica/);
});
