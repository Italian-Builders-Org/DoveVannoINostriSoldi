import "server-only";

import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { AnacOperatorIndexMeta, AnacOperatorRankBy, AnacOperatorSearchHit } from "./anac-operator-awards-index";

export const OPERATOR_BROWSE_DIR = "src/data/generated/anac-operator-browse";
export const OPERATOR_BROWSE_BLOCK_SIZE = 1000;
export const OPERATOR_BROWSE_ORDERS = ["awardCount", "attributedValue"] as const;
const MAX_BLOCK_BYTES = 512 * 1024;
const MAX_BLOCK_OUTPUT = 2 * 1024 * 1024;
const MAX_CACHED_BLOCKS = 8;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const blockSchema = z.object({
  offset: z.number().int().nonnegative(),
  bytes: z.number().int().positive().max(MAX_BLOCK_BYTES),
  rows: z.number().int().positive().max(OPERATOR_BROWSE_BLOCK_SIZE),
  sha256,
}).strict();
const orderSchema = z.object({
  bytes: z.number().int().positive(),
  blocks: z.array(blockSchema).min(1).max(1000),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSearchSha256: sha256,
  sourceSpecSha256: sha256,
  total: z.number().int().positive().max(1_000_000),
  blockSize: z.literal(OPERATOR_BROWSE_BLOCK_SIZE),
  orders: z.object({ awardCount: orderSchema, attributedValue: orderSchema }).strict(),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
let cachedManifest: Manifest | null = null;
const blockCache = new Map<string, readonly AnacOperatorSearchHit[]>();

// Preserve the existing ranking, including its Italian name tie-breaker.
export function compareAnacOperators(by: AnacOperatorRankBy, left: AnacOperatorSearchHit, right: AnacOperatorSearchHit): number {
  const count = right.awardCount - left.awardCount;
  const leftValue = Number(left.attributedValue);
  const rightValue = Number(right.attributedValue);
  const value = Number.isFinite(leftValue) && Number.isFinite(rightValue)
    ? rightValue - leftValue
    : right.attributedValue.localeCompare(left.attributedValue, "en");
  return (by === "attributedValue" ? value || count : count || value) || left.name.localeCompare(right.name, "it");
}

function loadManifest(meta: AnacOperatorIndexMeta): Manifest {
  if (cachedManifest) return cachedManifest;
  const path = join(process.cwd(), OPERATOR_BROWSE_DIR, "manifest.json");
  const fd = openSync(path, "r");
  let manifest: Manifest;
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 512 * 1024) throw new Error("Manifest paginazione operatori troppo grande");
    // Bound the read to the checked descriptor without a dynamic readFileSync
    // argument, which makes Turbopack trace unrelated repository files.
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("Manifest paginazione operatori incompleto");
      offset += count;
    }
    const after = fstatSync(fd);
    if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ino !== after.ino) {
      throw new Error("Manifest paginazione operatori cambiato durante la lettura");
    }
    manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  } finally {
    closeSync(fd);
  }
  if (manifest.sourceSearchSha256 !== meta.search.sha256 || manifest.sourceSpecSha256 !== meta.sourceSpecSha256 || manifest.total !== meta.totals.operators) {
    throw new Error("Paginazione operatori non allineata alla fonte");
  }
  for (const order of Object.values(manifest.orders)) {
    let offset = 0;
    let rows = 0;
    for (const [index, block] of order.blocks.entries()) {
      if (block.offset !== offset || (index < order.blocks.length - 1 && block.rows !== manifest.blockSize)) {
        throw new Error("Blocchi paginazione operatori non contigui");
      }
      offset += block.bytes;
      rows += block.rows;
    }
    if (offset !== order.bytes || rows !== manifest.total) throw new Error("Totali paginazione operatori non allineati");
  }
  cachedManifest = manifest;
  return manifest;
}

export function readAnacOperatorPage(
  meta: AnacOperatorIndexMeta,
  by: AnacOperatorRankBy,
  start: number,
  count: number,
  validate: (value: unknown) => AnacOperatorSearchHit,
): readonly AnacOperatorSearchHit[] {
  const manifest = loadManifest(meta);
  const end = Math.min(start + count, manifest.total);
  const hits: AnacOperatorSearchHit[] = [];
  for (let index = Math.floor(start / manifest.blockSize); index < Math.ceil(end / manifest.blockSize); index++) {
    const key = `${by}:${index}`;
    let rows = blockCache.get(key);
    if (!rows) {
      const order = manifest.orders[by];
      const block = order.blocks[index];
      const fd = openSync(join(process.cwd(), OPERATOR_BROWSE_DIR, `${by}.jsonl.gz`), "r");
      const compressed = Buffer.alloc(block.bytes);
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size !== order.bytes) throw new Error("Indice paginazione operatori non allineato");
        let read = 0;
        while (read < block.bytes) {
          const size = readSync(fd, compressed, read, block.bytes - read, block.offset + read);
          if (!size) throw new Error("Blocco operatori incompleto");
          read += size;
        }
        const after = fstatSync(fd);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Indice operatori cambiato durante la lettura");
      } finally {
        closeSync(fd);
      }
      if (createHash("sha256").update(compressed).digest("hex") !== block.sha256) throw new Error("SHA-256 blocco operatori non allineato");
      const text = gunzipSync(compressed, { maxOutputLength: MAX_BLOCK_OUTPUT }).toString("utf8");
      rows = text.trimEnd().split("\n").map((line) => validate(JSON.parse(line)));
      if (rows.length !== block.rows) throw new Error("Righe blocco operatori non allineate");
      if (blockCache.size >= MAX_CACHED_BLOCKS) blockCache.delete(blockCache.keys().next().value!);
      blockCache.set(key, rows);
    }
    const offset = index * manifest.blockSize;
    hits.push(...rows.slice(Math.max(0, start - offset), Math.min(rows.length, end - offset)));
  }
  return hits;
}
