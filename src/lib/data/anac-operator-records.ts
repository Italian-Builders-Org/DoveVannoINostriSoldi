import "server-only";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  assertOperatorRecord,
  isAnacOperatorRef,
  loadAnacOperatorIndexMeta,
  parseJsonl,
  readGunzipped,
  type AnacOperatorRecord,
} from "@/lib/data/anac-operator-awards-index";

const MAX_SHARD_BYTES = 64 * 1024 * 1024;
const operatorCache = new Map<string, AnacOperatorRecord | null>();

/** Load operator details for many refs with one shard read per bucket. */
export function loadAnacOperatorsByRefs(refs: readonly string[]): Map<string, AnacOperatorRecord> {
  const meta = loadAnacOperatorIndexMeta();
  const wanted = [...new Set(refs.filter(isAnacOperatorRef))];
  const out = new Map<string, AnacOperatorRecord>();
  const missingByBucket = new Map<string, string[]>();
  for (const ref of wanted) {
    if (operatorCache.has(ref)) {
      const cached = operatorCache.get(ref);
      if (cached) out.set(ref, cached);
      continue;
    }
    const bucket = createHash("sha256").update(ref).digest("hex").slice(0, 2);
    const list = missingByBucket.get(bucket) ?? [];
    list.push(ref);
    missingByBucket.set(bucket, list);
  }
  for (const [bucket, bucketRefs] of missingByBucket) {
    const shard = meta.shards.find((item) => item.id === bucket);
    if (!shard) throw new Error(`shard operatori ${bucket} assente`);
    const text = readGunzipped(join(process.cwd(), "src/data/generated/anac-operator-awards-index/operators", `${bucket}.jsonl.gz`), MAX_SHARD_BYTES, shard);
    const records = parseJsonl(text, assertOperatorRecord, 50_000);
    const wantedSet = new Set(bucketRefs);
    for (const record of records) {
      if (wantedSet.has(record.ref)) out.set(record.ref, record);
    }
    for (const ref of bucketRefs) {
      if (operatorCache.size >= 100) operatorCache.delete(operatorCache.keys().next().value!);
      operatorCache.set(ref, out.get(ref) ?? null);
    }
  }
  return out;
}

export function getAnacOperatorByRef(ref: string): AnacOperatorRecord | null {
  if (!isAnacOperatorRef(ref)) return null;
  if (operatorCache.has(ref)) return operatorCache.get(ref) ?? null;
  return loadAnacOperatorsByRefs([ref]).get(ref) ?? null;
}
