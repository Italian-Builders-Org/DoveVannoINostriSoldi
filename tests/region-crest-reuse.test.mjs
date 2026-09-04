import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testDirectory, "..");

async function source(path) {
  return readFile(join(projectRoot, path), "utf8");
}

test("regional tables reuse the shared crest component only with source-backed codes", async () => {
  const [business, fiscal, irpef, invalidity] = await Promise.all([
    source("src/app/imprese/page.tsx"),
    source("src/app/territori/fisco/page.tsx"),
    source("src/app/territori/irpef/page.tsx"),
    source("src/app/spese/invalidita/page.tsx"),
  ]);

  assert.match(business, /RegionCrest/);
  assert.match(business, /region\.code/);
  assert.match(business, /RegionCrestAttribution/);

  assert.match(fiscal, /hasRegionalCrest\(row\.regionCode\)/);
  assert.match(fiscal, /regionCode=\{row\.regionCode\}/);
  assert.match(fiscal, /Trento e Bolzano come territori separati/);
  assert.match(fiscal, /codice 04 identifica la regione combinata/);
  assert.match(fiscal, /RegionCrestAttribution/);

  assert.match(irpef, /record\.territory\.level === "region"/);
  assert.match(irpef, /regionCode=\{record\.territory\.code\}/);
  assert.match(irpef, /RegionCrestAttribution/);

  assert.match(invalidity, /istatCodeOfRegion\(region\.region\)/);
  assert.match(invalidity, /regionCode=\{regionCode\}/);
  assert.match(invalidity, /RegionCrestAttribution/);
});

test("all reused source-backed region codes resolve to the 20-entry crest manifest", async () => {
  const { istatCodeOfRegion } = await import("../src/lib/italy-regions.ts");
  const { queryCptRegionalFiscal } = await import("../src/lib/cpt-regional-fiscal-snapshot.ts");
  const { inpsCivilInvaliditySnapshot } = await import("../src/lib/inps-invalidity-snapshot.ts");
  const manifest = JSON.parse(await source("src/data/region-crests-manifest.json"));

  for (const region of inpsCivilInvaliditySnapshot.regionalNewPensions.regions) {
    const code = istatCodeOfRegion(region.region);
    assert.ok(code && manifest.regions[code]?.asset);
  }

  const fiscalRows = queryCptRegionalFiscal().rows;
  assert.equal(fiscalRows.filter((row) => /^(?:0[1-9]|1\d|20)$/.test(row.regionCode)).length, 19);
  assert.deepEqual(
    fiscalRows.filter((row) => !/^(?:0[1-9]|1\d|20)$/.test(row.regionCode)).map((row) => row.regionCode),
    ["21", "22"],
  );
  assert.ok(Object.values(manifest.regions).every((entry) => entry.asset));
});
