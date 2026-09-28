import "server-only";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { ArtifactCache, artifactFingerprint } from "@/lib/data/artifact-cache";
import {
  historyManifestSchema,
  historyBlockSchema,
  historySummarySchema,
  type OperatorHistorySummary,
} from "@/lib/data/anac-operator-history-contract";

const DIRECTORY = "src/data/generated/anac-operator-history";
let cachedManifest: z.infer<typeof historyManifestSchema> | undefined;
const cache = new ArtifactCache<OperatorHistorySummary>(128, 16_777_216);
type HistoryRange = Readonly<{ start: number; end: number }>;
type HistoryShard = Readonly<{ raw: string; index: ReadonlyMap<string, HistoryRange> }>;
const shardCache = new ArtifactCache<HistoryShard>(4, 16_777_216);
const shardIndexes = new ArtifactCache<ReadonlyMap<string, HistoryRange>>(256, 8_388_608);
let manifestFingerprint = "";

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readBytes(
  path: string,
  max: number,
  range?: { offset: number; bytes: number; fileBytes: number },
): Buffer {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd);
    const bytes = range?.bytes ?? before.size;
    const offset = range?.offset ?? 0;
    if (
      !before.isFile() ||
      bytes > max ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset + bytes > before.size ||
      (range && range.fileBytes !== before.size)
    )
      throw new Error("Dimensioni storico operatori non valide");
    const result = Buffer.alloc(bytes);
    let read = 0;
    while (read < bytes) {
      const received = readSync(fd, result, read, bytes - read, offset + read);
      if (!received) throw new Error("Lettura storico operatori incompleta");
      read += received;
    }
    const after = fstatSync(fd);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    )
      throw new Error("Storico operatori cambiato durante la lettura");
    return result;
  } finally {
    closeSync(fd);
  }
}

function manifest() {
  const paths = [
    join(process.cwd(), DIRECTORY, "manifest.json"),
    join(process.cwd(), "src/data/generated/anac-operator-awards-index/meta.json"),
    join(process.cwd(), "scripts/etl/specs/anac-cig-2007-2025.source.json"),
  ];
  const fingerprint = artifactFingerprint(paths);
  if (cachedManifest && fingerprint === manifestFingerprint) return cachedManifest;
  const parsed = historyManifestSchema.parse(
    JSON.parse(
      readBytes(
        join(process.cwd(), DIRECTORY, "manifest.json"),
        512_000,
      ).toString("utf8"),
    ),
  );
  const source = readBytes(
    join(
      process.cwd(),
      "src/data/generated/anac-operator-awards-index/meta.json",
    ),
    2_000_000,
  );
  const cigSpec = readBytes(
    join(process.cwd(), "scripts/etl/specs/anac-cig-2007-2025.source.json"),
    1_000_000,
  );
  if (
    digest(source) !== parsed.sourceIndexSha256 ||
    digest(cigSpec) !== parsed.sourceCigSpecSha256
  )
    throw new Error("Storico operatori non allineato alle fonti");
  for (const files of [parsed.shards, parsed.packs]) {
    if (new Set(files.map((file) => file.id)).size !== 256)
      throw new Error("Partizioni dello storico duplicate");
  }
  if (artifactFingerprint(paths) !== fingerprint) throw new Error("Fonti dello storico modificate durante la lettura");
  manifestFingerprint = fingerprint;
  cachedManifest = parsed;
  return parsed;
}

function bucketFor(ref: string): string {
  return createHash("sha256").update(ref).digest("hex").slice(0, 2);
}

export function getOperatorHistory(ref: string): OperatorHistorySummary | null {
  if (!/^op-\d{8}$/.test(ref)) return null;
  const bucket = bucketFor(ref);
  const file = manifest().shards.find((file) => file.id === bucket)!;
  const path = join(process.cwd(), DIRECTORY, `${bucket}.jsonl.gz`);
  const fingerprint = `${file.sha256}:${artifactFingerprint([path])}`;
  const recordKey = `${ref}:${fingerprint}`;
  const cached = cache.get(recordKey);
  if (cached) return cached;
  let lines = shardCache.get(fingerprint);
  if (!lines) {
    const compressed = readBytes(
      path,
      16_777_216,
    );
    if (compressed.length !== file.bytes || digest(compressed) !== file.sha256)
      throw new Error("Hash dello storico operatori non valido");
    const raw = gunzipSync(compressed, { maxOutputLength: 67_108_864 }).toString(
      "utf8",
    );
    let indexed = shardIndexes.get(`${bucket}:${file.sha256}`);
    if (!indexed) {
      const offsets = new Map<string, HistoryRange>();
      let start = 0;
      for (const line of raw.split("\n")) {
        if (line) {
          const candidate = JSON.parse(line);
          if (typeof candidate.ref !== "string" || bucketFor(candidate.ref) !== bucket || offsets.has(candidate.ref)) {
            throw new Error("Identità dello storico operatori non valida");
          }
          offsets.set(candidate.ref, { start, end: start + line.length });
        }
        start += line.length + 1;
      }
      indexed = offsets;
      shardIndexes.set(`${bucket}:${file.sha256}`, indexed, Buffer.byteLength(JSON.stringify([...indexed])));
    }
    if (`${file.sha256}:${artifactFingerprint([path])}` !== fingerprint) throw new Error("Storico operatori cambiato durante la lettura");
    // Keep offsets across shard eviction; the SHA check above still runs on every read.
    lines = { raw, index: indexed };
    shardCache.set(fingerprint, lines, Buffer.byteLength(raw));
  }
  const range = lines.index.get(ref);
  if (range) {
    const line = lines.raw.slice(range.start, range.end);
    const candidate = JSON.parse(line);
    const result = historySummarySchema.parse(candidate);
    const bytes = Buffer.byteLength(line);
    if (bytes <= 8_388_608) {
      cache.set(recordKey, result, bytes);
    }
    return result;
  }
  return null;
}

export function readOperatorHistoryAwards(
  history: OperatorHistorySummary,
  positions: readonly number[],
) {
  if (
    positions.length > 25 ||
    new Set(positions).size !== positions.length ||
    positions.some(
      (position) =>
        !Number.isSafeInteger(position) ||
        position < 0 ||
        position >= history.awardCount,
    )
  )
    throw new Error("Pagina storico non valida");
  const bucket = bucketFor(history.ref);
  const pack = manifest().packs.find((file) => file.id === bucket)!;
  const wanted = [
    ...new Set(
      positions.map((position) =>
        Math.floor(position / history.detail.blockSize),
      ),
    ),
  ];
  const blocks = new Map<number, z.infer<typeof historyBlockSchema>>();
  for (const index of wanted) {
    const block = history.detail.blocks[index];
    const bytes = readBytes(
      join(process.cwd(), DIRECTORY, `${bucket}.pack`),
      1_048_576,
      { ...block, fileBytes: pack.bytes },
    );
    if (digest(bytes) !== block.sha256)
      throw new Error("Hash del blocco storico non valido");
    const parsed = historyBlockSchema.parse(
      JSON.parse(
        gunzipSync(bytes, { maxOutputLength: 4_194_304 }).toString("utf8"),
      ),
    );
    if (
      parsed.ref !== history.ref ||
      parsed.start !== index * history.detail.blockSize ||
      parsed.awards.length !== block.rows
    )
      throw new Error("Blocco storico non allineato alla pagina");
    blocks.set(index, parsed);
  }
  return positions.map(
    (position) =>
      blocks.get(Math.floor(position / history.detail.blockSize))!.awards[
        position % history.detail.blockSize
      ],
  );
}
