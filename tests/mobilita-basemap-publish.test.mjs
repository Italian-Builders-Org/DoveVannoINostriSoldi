import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "mappe",
  "mobilita",
  "explorer",
);

test("published mobilità city packages embed a verified OSM basemap", () => {
  const citiesDir = path.join(root, "cities");
  const files = readdirSync(citiesDir).filter((name) => name.endsWith(".json.gz"));
  assert.ok(files.length >= 40, `attese ≥40 reti pubblicate, trovate ${files.length}`);

  let withRoads = 0;
  for (const name of files) {
    const city = JSON.parse(gunzipSync(readFileSync(path.join(citiesDir, name))));
    const basemap = city.basemap;
    assert.ok(basemap, `${city.id}: basemap assente`);
    assert.equal(basemap.attribution, "© OpenStreetMap contributors");
    assert.equal(basemap.license, "ODbL 1.0");
    assert.equal(
      basemap.licenseUrl,
      "https://www.openstreetmap.org/copyright",
    );
    assert.ok(basemap.receipt?.sha256, `${city.id}: ricevuta OSM assente`);
    assert.ok(
      Array.isArray(basemap.features) && basemap.features.some((f) => f.kind === "road"),
      `${city.id}: nessuna strada nel basemap`,
    );
    withRoads += 1;
  }
  assert.equal(withRoads, files.length);
});
