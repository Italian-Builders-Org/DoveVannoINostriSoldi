import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("atlas regeneration carries metadata and inventory into the next release and detects drift", () => {
  const target = mkdtempSync(join(tmpdir(), "dvns-atlas-refresh-"));
  try {
    for (const path of [
      "scripts/etl/company_atlas_snapshot.mjs",
      "scripts/ci/source-snapshot-inventory.py",
      "src/data/generated/company-atlas-snapshot.json",
      ".github/workflows/company-atlas-refresh.yml",
    ]) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      cpSync(join(root, path), join(target, path));
    }
    const registry = JSON.parse(readFileSync(join(root, "scripts/ci/generated-artifacts.json"), "utf8"));
    registry.artifacts = registry.artifacts.filter((artifact) => artifact.id === "company-atlas");
    writeFileSync(join(target, "scripts/ci/generated-artifacts.json"), JSON.stringify(registry));
    mkdirSync(join(target, "docs"), { recursive: true });
    const run = (mode) => spawnSync(process.execPath, ["scripts/etl/company_atlas_snapshot.mjs", mode], { cwd: target, encoding: "utf8" });
    const snapshotPath = join(target, "src/data/generated/company-atlas-snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    // A future acquisition must change both derived artifacts without relaxing
    // report cutoffs or carrying a stale provenance entry into publication.
    snapshot.generatedAt = "2026-09-10T00:00:00.000Z";
    for (const source of Object.values(snapshot.sources)) source.observedAt = snapshot.generatedAt;
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
    const generate = run("--metadata-only");
    assert.equal(generate.status, 0, generate.stderr);
    const metadataPath = join(target, "src/data/generated/company-atlas-metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    assert.deepEqual(metadata.sources, snapshot.sources);
    const inventoryPath = join(target, "docs/SOURCE_SNAPSHOT_INVENTORY.md");
    const inventory = readFileSync(inventoryPath, "utf8");
    assert.ok(inventory.includes(snapshot.generatedAt));
    assert.equal(run("--check").status, 0);
    writeFileSync(inventoryPath, inventory + "stale inventory\n");
    assert.notEqual(run("--check").status, 0, "inventory drift must block publication");
    writeFileSync(inventoryPath, inventory);
    metadata.sources["active-stock"].observedAt = "2026-09-01T00:00:00.000Z";
    writeFileSync(metadataPath, JSON.stringify(metadata));
    const staleMetadata = run("--check");
    assert.notEqual(staleMetadata.status, 0);
    assert.match(staleMetadata.stderr, /metadata does not match/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
