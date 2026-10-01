import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";

const cpv = await import("../src/lib/data/anac-procurement-cpv.ts");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Exercise a working set larger than both caches, using real source-locked
// metadata. No entity profile loader is needed to check the CPV read boundary.
test("CPV validates every sibling after eviction or SHA change, shares concurrent reads and recovers after repair", async () => {
  const root = mkdtempSync(join(tmpdir(), "dvns-cpv-index-"));
  const directory = "src/data/generated/anac-procurement-cpv";
  const metaPath = `${directory}/meta.json`;
  try {
    for (const path of ["scripts/etl/specs/anac-procurement-cpv.source.json", cpv.anacCpvSource.profiles.path, cpv.anacCpvSource.sourceLock.path, metaPath]) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      copyFileSync(path, join(root, path));
    }
    const parent = JSON.parse(readFileSync(cpv.anacCpvSource.profiles.path, "utf8"));
    const profiles = [], rowsByPrefix = new Map();
    for (let i = 0; i < 10; i++) {
      const prefix = i.toString(16).padStart(2, "0");
      const path = `${directory}/${prefix}.jsonl.gz`;
      copyFileSync(path, join(root, path));
      const rows = gunzipSync(readFileSync(path)).toString("utf8").trimEnd().split("\n").map(JSON.parse);
      rowsByPrefix.set(prefix, rows);
      for (const row of rows.slice(0, 15)) profiles.push({ codiceIpa: row.codiceIpa, procedures: row.procedures.map(({ cig }) => ({ cig, publishedAt: null })), meta: parent });
    }
    assert.ok(profiles.length > 128, "fixture must exceed the record cache");
    const first = await cpv.loadAnacCpvRecord(profiles[0], root);
    for (const profile of profiles.slice(1)) await cpv.loadAnacCpvRecord(profile, root);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => cpv.loadAnacCpvRecord(profiles[0], root)));
    assert.ok(concurrent.every((record) => record === concurrent[0]));
    assert.deepEqual(concurrent[0], first);
    await assert.rejects(cpv.loadAnacCpvRecord({ ...profiles[0], procedures: [...profiles[0].procedures, { cig: "OTHER00001" }] }, root), /non riconciliato/);

    const shardPath = join(root, directory, "00.jsonl.gz");
    const originalBytes = readFileSync(shardPath);
    const damaged = Buffer.from(originalBytes); damaged[damaged.length - 1] ^= 1;
    writeFileSync(shardPath, damaged);
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root), /Hash indice CPV/);
    for (const profile of profiles.slice(15)) await cpv.loadAnacCpvRecord(profile, root);
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root), /Hash indice CPV/, "corruption must still fail after shard and record eviction");
    writeFileSync(shardPath, originalBytes);
    assert.deepEqual(await cpv.loadAnacCpvRecord(profiles[0], root), first);

    const originalMeta = JSON.parse(readFileSync(join(root, metaPath), "utf8"));
    function replaceShard(rows, suffix = "\n") {
      const raw = Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + suffix);
      const bytes = gzipSync(raw);
      const meta = structuredClone(originalMeta);
      Object.assign(meta.shards[0], { bytes: bytes.length, rawBytes: raw.length, sha256: digest(bytes) });
      writeFileSync(shardPath, bytes);
      writeFileSync(join(root, metaPath), JSON.stringify(meta));
    }
    const rows = rowsByPrefix.get("00");
    const sibling = rows.findIndex((row, i) => i > 0 && row.procedures.length);
    assert.ok(sibling > 0);
    const invalid = structuredClone(rows);
    invalid[sibling].procedures[0].unexpected = "reject sibling even if the requested record is unchanged";
    replaceShard(invalid);
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root));
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root), undefined, "failed validation must not seed a proof");
    const duplicate = structuredClone(rows); duplicate[sibling] = structuredClone(rows[0]);
    replaceShard(duplicate);
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root), /Identità/);
    replaceShard(rows, "");
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root), /Dimensione/);
    const wrongIdentity = structuredClone(originalMeta); wrongIdentity.shards[0].entities += 1;
    writeFileSync(join(root, metaPath), JSON.stringify(wrongIdentity));
    await assert.rejects(cpv.loadAnacCpvRecord(profiles[0], root), /Copertura/);

    const valid = structuredClone(rows);
    valid[sibling].procedures[0].description = "Nuova descrizione € 🏛️";
    replaceShard(valid);
    const repaired = await cpv.loadAnacCpvRecord(profiles[0], root);
    assert.deepEqual(repaired, first);
    const neighbour = { codiceIpa: valid[sibling].codiceIpa, procedures: valid[sibling].procedures.map(({ cig }) => ({ cig })), meta: parent };
    assert.deepEqual(await cpv.loadAnacCpvRecord(neighbour, root), valid[sibling]);
    // Distinct valid SHA keys exceed the proof cache's complete working set.
    // Restoring an earlier version must remain correct after that churn.
    for (let version = 0; version < 260; version++) {
      valid[sibling].procedures[0].description = `Verified snapshot ${version}`;
      replaceShard(valid);
      assert.deepEqual(await cpv.loadAnacCpvRecord(profiles[0], root), first);
    }
    writeFileSync(shardPath, originalBytes);
    writeFileSync(join(root, metaPath), JSON.stringify(originalMeta));
    assert.deepEqual(await cpv.loadAnacCpvRecord(profiles[0], root), first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
