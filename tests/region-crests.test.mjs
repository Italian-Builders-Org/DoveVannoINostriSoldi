import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(testDirectory, "..");
const manifest = JSON.parse(
  await readFile(join(projectRoot, "src/data/region-crests-manifest.json"), "utf8"),
);
const regionCodes = Object.keys(manifest.regions).sort();
const localEntries = Object.entries(manifest.regions).filter(([, entry]) => entry.asset);

test("manifest copre tutti i 20 codici ISTAT e dichiara i fallback", () => {
  assert.deepEqual(
    regionCodes,
    Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, "0")),
  );
  assert.equal(manifest.coverage.totalRegions, 20);
  assert.equal(manifest.coverage.localAssetCount, 10);
  assert.equal(localEntries.length, 10);
  assert.deepEqual(
    manifest.coverage.fallbackCodes.sort(),
    Object.entries(manifest.regions)
      .filter(([, entry]) => !entry.asset)
      .map(([code]) => code)
      .sort(),
  );
  for (const [code, entry] of Object.entries(manifest.regions)) {
    assert.ok(entry.name, code + ": nome mancante");
    if (entry.asset) {
      assert.ok(entry.asset.startsWith("/region-crests/") && entry.asset.endsWith(".svg"));
      assert.ok(entry.assetFile.startsWith("public/region-crests/") && entry.assetFile.endsWith(".svg"));
      assert.ok(entry.sourceUrl.startsWith("https://upload.wikimedia.org/wikipedia/commons/"));
      assert.ok(entry.sourcePage.startsWith("https://commons.wikimedia.org/wiki/File:"));
      assert.ok(["Public domain", "CC BY-SA 3.0", "CC BY-SA 4.0"].includes(entry.license));
      assert.ok(entry.licenseUrl.startsWith("https://"));
      assert.ok(entry.author, code + ": autore mancante");
      assert.ok(entry.attribution, code + ": attribuzione mancante");
      assert.match(entry.sha1, /^[a-f0-9]{40}$/);
      assert.ok(Number.isInteger(entry.width) && entry.width > 0);
      assert.ok(Number.isInteger(entry.height) && entry.height > 0);
    } else {
      assert.equal(typeof entry.fallbackReason, "string");
      assert.ok(entry.fallbackReason.length > 20, code + ": motivazione fallback poco chiara");
    }
  }
});

test("ogni SVG locale è presente, hashato e senza contenuto eseguibile o riferimenti esterni", async () => {
  for (const [code, entry] of localEntries) {
    const svg = await readFile(join(projectRoot, entry.assetFile), "utf8");
    assert.ok(svg.toLowerCase().includes("<svg"), code + ": root SVG mancante");
    assert.doesNotMatch(svg, new RegExp("<(script|foreignObject|iframe|object|embed|audio|video|form)", "i"));
    assert.doesNotMatch(svg, new RegExp(" on[a-z]+[[:space:]]*=", "i"));
    assert.ok(!svg.includes('href="http') && !svg.includes('xlink:href="http'));
    assert.ok(!svg.includes('href="//') && !svg.includes('xlink:href="//'));
    assert.ok(!svg.match(new RegExp("url\\([[:space:]]*[\"']?(https?:|//)", "i")));
    const hash = createHash("sha1").update(svg).digest("hex");
    assert.equal(hash, entry.sha1, code + ": hash locale diverso dal manifest");
  }
});

test("RegionCrest usa solo asset locali, alt decorativo e fallback accessibile", async () => {
  const component = await readFile(join(projectRoot, "src/components/region-crest.tsx"), "utf8");
  assert.ok(component.includes('from "next/image"'));
  assert.ok(component.includes("src={entry.asset}"));
  assert.ok(component.includes("unoptimized"));
  assert.ok(component.includes('alt={decorative ? "" :'));
  assert.ok(component.includes('data-region-crest="fallback"'));
  assert.ok(component.includes("Stemma non disponibile per"));
  for (const route of ["src/app/page.tsx", "src/app/regioni/page.tsx", "src/app/territori/page.tsx"]) {
    const source = await readFile(join(projectRoot, route), "utf8");
    assert.ok(source.includes("RegionCrest"), route + ": integrazione mancante");
  }
});

test("la mappa mantiene spazio visivo sotto PeriodSelector e le tabelle restano contenute", async () => {
  const homeCss = await readFile(join(projectRoot, "src/app/home.module.css"), "utf8");
  assert.ok(homeCss.includes(".mapStage"));
  assert.ok(homeCss.includes("margin-top: var(--space-3)"));
  const home = await readFile(join(projectRoot, "src/app/page.tsx"), "utf8");
  assert.ok(home.includes("className={styles.mapStage}"));
  for (const cssPath of ["src/app/home.module.css", "src/app/regioni/regioni.module.css", "src/app/territori/territori.module.css"]) {
    const css = await readFile(join(projectRoot, cssPath), "utf8");
    assert.doesNotMatch(css, /overflow-x:[[:space:]]*visible/i);
  }
  for (const route of ["src/app/regioni/page.tsx", "src/app/territori/page.tsx"]) {
    const source = await readFile(join(projectRoot, route), "utf8");
    assert.ok(source.includes("table-scroll"), route + ": contenitore tabella mancante");
  }
});
