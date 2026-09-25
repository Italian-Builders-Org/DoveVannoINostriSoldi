import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getRealEstateNationalData, getRealEstateRegionPoints } = await import("../src/lib/real-estate-map-points.ts");

test("the national view counts every idle building of the corpus by region and municipality", async () => {
  const data = await getRealEstateNationalData();
  assert.equal(data.total, 133_293);
  assert.equal(Object.keys(data.byRegion).length, 20);
  assert.equal(Object.values(data.byRegion).reduce((sum, count) => sum + count, 0), data.total);
  assert.equal(data.byRegion["12"], 6_909);
  const roma = data.municipalities.name.indexOf("Roma");
  assert.deepEqual([data.municipalities.region[roma], data.municipalities.count[roma]], ["12", 1_727]);
});

test("region points are projected on the site map and keep the source precision and surface", async () => {
  const lazio = await getRealEstateRegionPoints("12");
  assert.equal(lazio.x.length, 6_909);
  assert.ok(lazio.x.every((x) => x > 0 && x < 560) && lazio.y.every((y) => y > 0 && y < 640));
  assert.equal(lazio.approximate.filter(Boolean).length, 76);
  assert.equal(lazio.area.filter((area) => area === 0).length, 167);
  assert.equal(lazio.area.filter((area) => area === null).length, 0);
  assert.ok(lazio.types.includes("Area urbana"));
});
