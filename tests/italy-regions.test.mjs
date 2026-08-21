import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { italyRegionGeometry } from "../src/data/generated/italy-regions.ts";
import {
  ISTAT_CODE_BY_REGION_NAME,
  ITALY_MACRO_AREAS,
  REGION_NAME_BY_ISTAT_CODE,
  istatCodeOfRegion,
  macroAreaOf,
} from "../src/lib/italy-regions.ts";

const snapshotUrl = new URL("../src/data/generated/siope-municipal.json", import.meta.url);

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
