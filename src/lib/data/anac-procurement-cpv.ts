import "server-only";

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { z } from "zod";
import sourceSpec from "../../../scripts/etl/specs/anac-procurement-cpv.source.json";
import { selectAnacEntityProcurementCigs, type AnacEntityProcurementPageView } from "@/lib/data/anac-entity-procurement-page";

const ROOT = "src/data/generated/anac-procurement-cpv";
const SPEC = "scripts/etl/specs/anac-procurement-cpv.source.json";
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const MAX_RAW_BYTES = 32 * 1024 * 1024;
const unzip = promisify(gunzip);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const counts = z.object({ entities: count, procedures: count, classified: count, unclassified: count }).strict();
const rowSchema = z.object({ cig: z.string().regex(/^[A-Z0-9]{10}$/), rawCode: z.string().max(100), description: z.string().max(2000) }).strict();
const recordSchema = z.object({ codiceIpa: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/), procedures: z.array(rowSchema).max(100_000) }).strict();
const metadataSchema = z.object({
  schemaVersion: z.literal(1), dataset: z.literal("anac-procurement-cpv"), sourceSpecSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCounts: z.object({ rawRows: count, primaryRows: count, nonPrimaryRows: count, classified: count, unclassified: count }).strict(),
  counts,
  shards: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{2}$/), bytes: count.positive().max(MAX_SHARD_BYTES), rawBytes: count.positive().max(MAX_RAW_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/), entities: count }).strict()).length(256),
}).strict();

export type AnacCpvProcedure = z.infer<typeof rowSchema>;
export type AnacCpvRecord = z.infer<typeof recordSchema>;
export type AnacCpvOption = Readonly<{ code: string; descriptions: readonly string[]; procedures: number }>;
export const anacCpvSource = sourceSpec;

/** The source may omit the check digit; no code is inferred from its label. */
export function normalizeAnacCpv(raw: string): string | null {
  const value = raw.trim();
  return /^[0-9]{8}(?:-[0-9])?$/.test(value) && value.slice(0, 8) !== "00000000" ? value.slice(0, 8) : null;
}

export function parseAnacCpvFilter(value: unknown): string {
  if (value === undefined || value === "") return "";
  if (typeof value === "string" && (value === "unclassified" || /^[0-9]{8}$/.test(value) && value !== "00000000")) return value;
  throw new Error("Filtro CPV non valido.");
}

async function readBounded(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error("Indice CPV oltre il limite.");
    const bytes = Buffer.alloc(stat.size + 1);
    let position = 0;
    while (position < bytes.length) {
      const result = await file.read(bytes, position, bytes.length - position, position);
      if (result.bytesRead === 0) break;
      position += result.bytesRead;
    }
    if (position !== stat.size) throw new Error("Indice CPV modificato durante la lettura.");
    return bytes.subarray(0, position);
  } finally { await file.close(); }
}

export function validateAnacCpvRecord(value: unknown, profile: Pick<AnacEntityProcurementPageView, "codiceIpa" | "procedures">): AnacCpvRecord {
  const record = recordSchema.parse(value);
  if (record.codiceIpa !== profile.codiceIpa || record.procedures.length !== profile.procedures.length
    || record.procedures.some((row, i) => row.cig !== profile.procedures[i].cig)) {
    throw new Error("Indice CPV non riconciliato con il profilo ANAC.");
  }
  return record;
}

export async function loadAnacCpvRecord(profile: AnacEntityProcurementPageView, root = process.cwd()): Promise<AnacCpvRecord> {
  const [metaBytes, specBytes, parentBytes, lockBytes] = await Promise.all([
    readBounded(join(root, ROOT, "meta.json"), 1_000_000),
    readBounded(join(root, SPEC), 100_000),
    readBounded(join(root, sourceSpec.profiles.path), 1_000_000),
    readBounded(join(root, sourceSpec.sourceLock.path), 100_000),
  ]);
  const metadata = metadataSchema.parse(JSON.parse(metaBytes.toString("utf8")));
  if (sha256(specBytes) !== metadata.sourceSpecSha256 || sha256(parentBytes) !== sourceSpec.profiles.sha256
    || sha256(lockBytes) !== sourceSpec.sourceLock.sha256 || JSON.stringify(JSON.parse(specBytes.toString("utf8"))) !== JSON.stringify(sourceSpec)) {
    throw new Error("Provenienza indice CPV non riconciliata.");
  }
  const parent = JSON.parse(parentBytes.toString("utf8"));
  if (JSON.stringify(profile.meta) !== JSON.stringify(parent)) throw new Error("Indice CPV di un'altra versione del profilo.");
  const { sourceCounts: s, counts: c } = metadata;
  if (s.rawRows !== s.primaryRows + s.nonPrimaryRows || s.primaryRows !== s.classified + s.unclassified
    || c.procedures !== c.classified + c.unclassified || c.entities !== parent.totals.entities || c.procedures !== parent.totals.procedures
    || metadata.shards.some((shard, i) => shard.id !== i.toString(16).padStart(2, "0") || shard.entities !== parent.shards[i].entities)) {
    throw new Error("Copertura indice CPV non riconciliata.");
  }
  const prefix = createHash("sha256").update(profile.codiceIpa).digest("hex").slice(0, 2);
  const shard = metadata.shards[Number.parseInt(prefix, 16)];
  const bytes = await readBounded(join(root, ROOT, `${prefix}.jsonl.gz`), MAX_SHARD_BYTES);
  if (bytes.length !== shard.bytes || sha256(bytes) !== shard.sha256) throw new Error("Hash indice CPV divergente.");
  const raw = await unzip(bytes, { maxOutputLength: MAX_RAW_BYTES });
  if (raw.length !== shard.rawBytes || !raw.toString("utf8").endsWith("\n")) throw new Error("Dimensione indice CPV divergente.");
  const lines = raw.toString("utf8").trimEnd().split("\n");
  if (lines.length !== shard.entities) throw new Error("Cardinalità indice CPV divergente.");
  const records = lines.map((line) => recordSchema.parse(JSON.parse(line)));
  const codes = new Set<string>();
  for (const record of records) {
    if (codes.has(record.codiceIpa) || createHash("sha256").update(record.codiceIpa).digest("hex").slice(0, 2) !== prefix) throw new Error("Identità indice CPV divergente.");
    codes.add(record.codiceIpa);
  }
  return validateAnacCpvRecord(records.find((record) => record.codiceIpa === profile.codiceIpa), profile);
}

export function anacCpvOptions(record: AnacCpvRecord): { options: AnacCpvOption[]; unclassified: number } {
  const groups = new Map<string, { descriptions: Set<string>; procedures: number }>();
  let unclassified = 0;
  for (const row of record.procedures) {
    const code = normalizeAnacCpv(row.rawCode);
    if (code === null) { unclassified += 1; continue; }
    let group = groups.get(code);
    if (!group) { group = { descriptions: new Set(), procedures: 0 }; groups.set(code, group); }
    group.procedures += 1;
    if (row.description.trim()) group.descriptions.add(row.description);
  }
  return { options: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([code, group]) => ({ code, procedures: group.procedures, descriptions: [...group.descriptions].sort() })), unclassified };
}

export function filterAnacProcurementByCpv(profile: AnacEntityProcurementPageView, record: AnacCpvRecord, filter: string): AnacEntityProcurementPageView {
  validateAnacCpvRecord(record, profile);
  const selected = parseAnacCpvFilter(filter);
  if (!selected) return profile;
  const cigs = new Set(record.procedures.filter((row) => selected === "unclassified" ? normalizeAnacCpv(row.rawCode) === null : normalizeAnacCpv(row.rawCode) === selected).map((row) => row.cig));
  return { ...selectAnacEntityProcurementCigs(profile, cigs), cpvFilter: selected };
}
