import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getRealEstateNationalData, getRealEstateRegionData } = await import("../src/lib/real-estate-map-points.ts");

const buildings = (data, predicate = () => true) =>
  data.cells.buildings.reduce((sum, count, index) => sum + (predicate(index) ? count : 0), 0);

test("the national view counts every idle building of the corpus by region and municipality", async () => {
  const data = await getRealEstateNationalData();
  assert.equal(data.total, 133_293);
  assert.equal(Object.keys(data.byRegion).length, 20);
  assert.equal(Object.values(data.byRegion).reduce((sum, count) => sum + count, 0), data.total);
  assert.equal(data.byRegion["12"], 6_909);
  const roma = data.municipalities.name.indexOf("Roma");
  assert.deepEqual([data.municipalities.code[roma], data.municipalities.region[roma], data.municipalities.count[roma]], ["H501", "12", 1_727]);
  assert.deepEqual(Object.keys(data.byUse).sort(), ["In ristrutturazione/manutenzione", "Inutilizzabile", "Non utilizzato"]);
  assert.equal(Object.values(data.byUse).reduce((sum, count) => sum + count, 0), data.total);
});

test("a region is published per municipality, with no position of any building", async () => {
  const lazio = await getRealEstateRegionData("12");
  assert.deepEqual(Object.keys(lazio).sort(), ["cells", "municipalities", "types", "uses"]);
  assert.deepEqual(Object.keys(lazio.cells).sort(), ["area", "buildings", "municipality", "type", "use"]);
  assert.equal(buildings(lazio), 6_909);
  assert.equal(lazio.municipalities.length, 250);
  const roma = lazio.municipalities.findIndex((municipality) => municipality.code === "H501");
  assert.equal(buildings(lazio, (index) => lazio.cells.municipality[index] === roma), 1_727);
  assert.ok(lazio.municipalities.every((municipality) => Object.keys(municipality).sort().join() === "code,name,taxpayers"));
  // IRPEF 2024 taxpayers, the denominator of the per-1,000 ranking.
  assert.equal(lazio.municipalities[roma].taxpayers, 1_994_045);
  assert.ok(lazio.types.includes("Area urbana"));
});

test("a municipality merged away keeps its buildings but has no taxpayers of its own", async () => {
  const veneto = await getRealEstateRegionData("05");
  const queroVas = veneto.municipalities.findIndex((municipality) => municipality.code === "M332");
  assert.equal(buildings(veneto, (index) => veneto.cells.municipality[index] === queroVas), 29);
  assert.equal(veneto.municipalities[queroVas].taxpayers, null);
});

test("a municipality listed under its former region still finds its taxpayers", async () => {
  // Montecopiolo moved from Marche to Emilia-Romagna in 2021; the census keeps it in Marche.
  const marche = await getRealEstateRegionData("11");
  const montecopiolo = marche.municipalities.find((municipality) => municipality.code === "F478");
  assert.ok(montecopiolo.taxpayers > 0);
});

test("the census keeps 30 municipalities whose cadastral code is no longer in use", async () => {
  // Merged away; Sovizzo (I879) too, although the merger kept its name under the new code M436.
  const without = [];
  for (let region = 1; region <= 20; region += 1) {
    const data = await getRealEstateRegionData(String(region).padStart(2, "0"));
    without.push(...data.municipalities.filter(({ taxpayers }) => taxpayers === null).map(({ code }) => code));
  }
  assert.equal(without.length, 30);
  assert.ok(without.includes("I879"));
});
