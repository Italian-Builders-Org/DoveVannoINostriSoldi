import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  historyBlockSchema,
  historyManifestSchema,
  historySummarySchema,
} from "../../src/lib/data/anac-operator-history-contract.ts";

const directory = "src/data/generated/anac-operator-history";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = historyManifestSchema.parse(
  JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
);
const sourceBytes = readFileSync(
  "src/data/generated/anac-operator-awards-index/meta.json",
);
const source = JSON.parse(sourceBytes);
assert.equal(manifest.sourceIndexSha256, digest(sourceBytes));
assert.equal(manifest.observedAt, source.observedAt);
assert.equal(manifest.generatedAt, source.generatedAt);
assert.equal(
  manifest.sourceCigSpecSha256,
  digest(readFileSync("scripts/etl/specs/anac-cig-2007-2025.source.json")),
);

function checkedFile(file, suffix, maxBytes) {
  const path = join(directory, file.id + suffix);
  assert.ok(file.bytes <= maxBytes, `File exceeds the read budget: ${path}`);
  assert.equal(statSync(path).size, file.bytes);
  const bytes = readFileSync(path);
  assert.equal(digest(bytes), file.sha256, path);
  return bytes;
}

const refs = new Set();
let awards = 0;
for (const files of [manifest.shards, manifest.packs])
  assert.equal(new Set(files.map((file) => file.id)).size, 256);
for (const [shardIndex, shard] of manifest.shards.entries()) {
  const pack = manifest.packs.find((file) => file.id === shard.id);
  const packed = checkedFile(pack, ".pack", 67_108_864);
  const raw = gunzipSync(checkedFile(shard, ".jsonl.gz", 16_777_216), {
    maxOutputLength: 67_108_864,
  }).toString("utf8");
  let expectedOffset = 0;
  for (const line of raw.trimEnd().split("\n")) {
    if (!line) continue;
    const record = historySummarySchema.parse(JSON.parse(line));
    assert.equal(digest(record.ref).slice(0, 2), shard.id);
    assert.ok(!refs.has(record.ref), `Duplicate operator: ${record.ref}`);
    refs.add(record.ref);
    awards += record.awardCount;
    const annualCounts = new Map();
    const authorityCounts = new Map();
    let missingAuthority = 0;
    let unmatchedCigs = 0;
    for (const [index, block] of record.detail.blocks.entries()) {
      assert.equal(block.offset, expectedOffset);
      expectedOffset += block.bytes;
      assert.ok(expectedOffset <= pack.bytes);
      const bytes = packed.subarray(block.offset, expectedOffset);
      assert.equal(digest(bytes), block.sha256, `${record.ref} block ${index}`);
      const data = historyBlockSchema.parse(
        JSON.parse(
          gunzipSync(bytes, { maxOutputLength: 4_194_304 }).toString("utf8"),
        ),
      );
      assert.equal(data.ref, record.ref);
      assert.equal(data.start, index * 100);
      assert.equal(data.awards.length, block.rows);
      for (const [offset, award] of data.awards.entries()) {
        const fields = [
          award.awardedAt ? Number(award.awardedAt.slice(0, 4)) : null,
          award.procedure?.authorityRef ?? null,
          award.procedure?.procedure ?? null,
          award.amount,
        ];
        assert.deepEqual(
          fields,
          record.detail.filterRows[data.start + offset],
          `${record.ref} filter row ${data.start + offset}`,
        );
        annualCounts.set(fields[0], (annualCounts.get(fields[0]) ?? 0) + 1);
        if (fields[1] === null) missingAuthority++;
        else
          authorityCounts.set(
            fields[1],
            (authorityCounts.get(fields[1]) ?? 0) + 1,
          );
        if (award.procedure === null) unmatchedCigs++;
      }
    }
    assert.equal(annualCounts.size, record.yearly.length, record.ref);
    for (const year of record.yearly)
      assert.equal(annualCounts.get(year.year), year.awardCount, record.ref);
    assert.equal(
      authorityCounts.size,
      record.distinctContractingAuthorityCount,
      record.ref,
    );
    assert.equal(missingAuthority, record.awardsWithoutAuthority, record.ref);
    assert.equal(unmatchedCigs, record.awardsWithoutCigMatch, record.ref);
    for (const authority of record.authorities)
      assert.equal(
        authorityCounts.get(authority.ref),
        authority.awardCount,
        record.ref,
      );
  }
  assert.equal(expectedOffset, pack.bytes, `Unreferenced bytes in ${pack.id}`);
  if ((shardIndex + 1) % 32 === 0)
    console.log(`Operator history: ${shardIndex + 1}/256 shards checked`);
}
assert.equal(refs.size, manifest.totals.operators);
assert.equal(awards, manifest.totals.awardRelations);
assert.deepEqual(manifest.totals, {
  operators: source.totals.operators,
  awardRelations: source.totals.awardRelations,
});
console.log(
  `Operator history: ${refs.size} operators, ${awards} award relations, all blocks and 512 files verified.`,
);
