import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { italyRegionGeometry } from "../src/data/generated/italy-regions.ts";
import {
  ISTAT_CODE_BY_REGION_NAME,
  ITALY_MACRO_AREAS,
  REGION_NAME_BY_ISTAT_CODE,
  cptRegionAnchorOf,
  groupRegionsByMacroArea,
  istatCodeOfRegion,
  macroAreaOf,
} from "../src/lib/italy-regions.ts";

const snapshotUrl = new URL("../src/data/generated/siope-municipal.json", import.meta.url);
const annualSnapshotUrls = [
  new URL("../src/data/generated/siope-municipal-2024.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal-2025.json", import.meta.url),
  snapshotUrl,
];

test("ISTAT geometry and SIOPE data cover the same 20 regions", async () => {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  const geometryCodes = italyRegionGeometry.map((region) => region.code);
  const mappedNames = Object.values(REGION_NAME_BY_ISTAT_CODE);
  const snapshotNames = snapshot.regions.map((region) => region.region);

  assert.equal(italyRegionGeometry.length, 20);
  assert.equal(new Set(geometryCodes).size, 20);
  assert.deepEqual([...geometryCodes].sort(), Object.keys(REGION_NAME_BY_ISTAT_CODE).sort());
  assert.deepEqual([...snapshotNames].sort(), [...mappedNames].sort());
  assert.ok(
    italyRegionGeometry.every(
      (region) => region.name === REGION_NAME_BY_ISTAT_CODE[region.code],
    ),
  );
  assert.ok(italyRegionGeometry.every((region) => region.path.startsWith("M") && region.path.endsWith("Z")));
});

test("every region resolves to exactly one macro area, with no silent drops", () => {
  const names = Object.values(REGION_NAME_BY_ISTAT_CODE);

  for (const name of names) {
    const area = macroAreaOf(name);
    assert.ok(ITALY_MACRO_AREAS.includes(area), `${name} did not resolve to a known macro area`);
  }

  assert.equal(macroAreaOf("Regione inesistente"), null);
});

test("ISTAT_CODE_BY_REGION_NAME is the exact reverse of REGION_NAME_BY_ISTAT_CODE", () => {
  for (const [code, name] of Object.entries(REGION_NAME_BY_ISTAT_CODE)) {
    assert.equal(ISTAT_CODE_BY_REGION_NAME[name], code);
    assert.equal(istatCodeOfRegion(name), code);
  }
  assert.equal(istatCodeOfRegion("Regione inesistente"), null);
});

test("CPT anchors fail closed for the one-to-many Trentino mapping", () => {
  assert.equal(cptRegionAnchorOf("Piemonte"), "regione-01");
  assert.equal(cptRegionAnchorOf("Trentino-Alto Adige/Südtirol"), null);
  assert.equal(cptRegionAnchorOf("Regione inesistente"), null);
});

test("macro-area grouping rejects an unmapped region", () => {
  assert.throws(
    () => groupRegionsByMacroArea([{ region: "Regione inesistente" }]),
    /Regione non associata a una macro-area/,
  );
});

test("macro-area grouping rejects missing and duplicate regions", async () => {
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  assert.throws(
    () => groupRegionsByMacroArea(snapshot.regions.slice(1)),
    /Regioni mancanti/,
  );
  assert.throws(
    () => groupRegionsByMacroArea([...snapshot.regions, snapshot.regions[0]]),
    /Regione duplicata/,
  );
});

test("macro-area totals reconcile for every committed SIOPE year", async () => {
  const cents = (value) => Math.round(value * 100);

  for (const url of annualSnapshotUrls) {
    const snapshot = JSON.parse(await readFile(url, "utf8"));
    const groups = groupRegionsByMacroArea(snapshot.regions);

    assert.equal(
      cents(groups.reduce((total, group) => total + group.summary.value, 0)),
      cents(snapshot.regions.reduce((total, region) => total + region.value, 0)),
      `all payments for ${snapshot.year}`,
    );
    assert.equal(
      cents(groups.reduce((total, group) => total + group.summary.perCapitaValue, 0)),
      cents(snapshot.regions.reduce((total, region) => total + region.perCapitaValue, 0)),
      `payments with a population denominator for ${snapshot.year}`,
    );
  }
});
