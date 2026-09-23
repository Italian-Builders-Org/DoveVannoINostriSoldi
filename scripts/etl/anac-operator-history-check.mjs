import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  historyBlockSchema,
  historyManifestSchema,
  historySummarySchema,
} from "../../src/lib/data/anac-operator-history-contract.ts";

const directory = "src/data/generated/anac-operator-history";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const attributableStatuses = new Set([
  "positive-exact-cent",
  "positive-subcent",
  "zero",
]);
function decimalUnits(value) {
  // The contract caps decimal strings at 100 characters, so this scale is exact.
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(100, "0"));
}
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
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd);
    assert.ok(before.isFile(), path);
    assert.equal(before.size, file.bytes, path);
    const bytes = Buffer.alloc(file.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const received = readSync(fd, bytes, offset, bytes.length - offset, offset);
      assert.ok(received > 0, `Incomplete read: ${path}`);
      offset += received;
    }
    const after = fstatSync(fd);
    assert.equal(after.size, before.size, path);
    assert.equal(after.mtimeMs, before.mtimeMs, path);
    assert.equal(digest(bytes), file.sha256, path);
    return bytes;
  } finally {
    closeSync(fd);
  }
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
        const filterRow = record.detail.filterRows[data.start + offset];
        if (
          fields[0] !== filterRow[0] ||
          fields[1] !== filterRow[1] ||
          fields[2] !== filterRow[2] ||
          fields[3] !== filterRow[3]
        ) {
          assert.deepEqual(fields, filterRow, `${record.ref} filter row ${data.start + offset}`);
        }
        const annual = annualCounts.get(fields[0]) ?? {
          count: 0,
          attributedCount: 0,
          value: BigInt(0),
        };
        annual.count++;
        if (
          award.attribution === "single-operator" &&
          attributableStatuses.has(award.amountStatus)
        ) {
          assert.notEqual(award.amount, null, record.ref);
          annual.attributedCount++;
          annual.value += decimalUnits(award.amount);
        }
        annualCounts.set(fields[0], annual);
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
    for (const year of record.yearly) {
      const actual = annualCounts.get(year.year);
      assert.equal(actual?.count, year.awardCount, record.ref);
      assert.equal(
        actual?.attributedCount,
        year.attributedAwardCount,
        record.ref,
      );
      assert.equal(
        actual?.value,
        decimalUnits(year.attributedValue ?? "0"),
        record.ref,
      );
    }
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
