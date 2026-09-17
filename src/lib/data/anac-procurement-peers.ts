import "server-only";

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { z } from "zod";
import spec from "../../../scripts/etl/specs/anac-procurement-peers.source.json";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digits = z.string().regex(/^(0|[1-9][0-9]{0,199})$/);
const ratio = z.object({ numerator: digits, denominator: digits.refine((v) => v !== "0") }).strict();
const metrics = z.object({ top1Share: ratio, top10Share: ratio, hhi10000: ratio }).strict();
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,99})(\.[0-9]{1,100})?$/);
const rowSchema = z.object({
  codiceIpa: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/), istatCode: z.string().regex(/^[0-9]{6}$/), name: z.string().min(1).max(500),
  population: integer.positive().nullable(), procedures: integer, awards: integer, stableAwards: integer,
  positiveAwards: integer, valueObservations: integer, awardValue: decimal, attributedValue: decimal,
  mix: z.record(z.string().regex(/^[0-9]{2}$/), integer.positive()), count: metrics.nullable(), value: metrics.nullable(),
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), dataset: z.literal("anac-procurement-peers"), sourceSpecSha256: z.string().regex(/^[a-f0-9]{64}$/),
  municipalProfiles: integer, ambiguousProfilesExcluded: integer, totalProfiles: integer, rows: z.array(rowSchema).max(10_000),
}).strict();
const metadataSchema = z.object({ schemaVersion: z.literal(1), bytes: integer.positive().max(4_000_000), rawBytes: integer.positive().max(24_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type AnacPeerRow = z.infer<typeof rowSchema>;
export type AnacPeerRatio = z.infer<typeof ratio>;
export type AnacPeerMetric = keyof z.infer<typeof metrics>;
export type AnacPeerDimension = "count" | "value";
export const anacPeerSource = spec;
export const ANAC_PEER_MINIMUM = 10;
/** Minimum CPV composition overlap (exact rational). Editorial v1.1: 70%, was 80%. */
export const ANAC_PEER_CPV_MINIMUM = { numerator: "7", denominator: "10" } as const;

export function comparePeerRatios(a: AnacPeerRatio, b: AnacPeerRatio): number {
  const difference = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

function fraction(n: bigint, d: bigint): AnacPeerRatio {
  let a = n, b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: String(n / a), denominator: String(d / a) };
}

function decimalRatio(value: string): AnacPeerRatio {
  const [whole, part = ""] = value.split(".");
  return { numerator: whole + part, denominator: String(BigInt(10) ** BigInt(part.length)) };
}

function coverage90(part: number, total: number): boolean {
  return total > 0 && BigInt(part) * BigInt(10) >= BigInt(total) * BigInt(9);
}

export function peerExclusions(row: AnacPeerRow, dimension: AnacPeerDimension): string[] {
  const reasons: string[] = [];
  if (row.population === null) reasons.push("Popolazione 2024 non disponibile");
  if (!coverage90(Object.values(row.mix).reduce((s, n) => s + n, 0), row.procedures)) reasons.push("CPV interpretabile in meno del 90% delle procedure");
  if (row.awards < 30 || row.count === null) reasons.push("Meno di 30 aggiudicazioni con indicatore calcolabile");
  if (!coverage90(row.stableAwards, row.awards)) reasons.push("Aggiudicatari identificati in meno del 90% delle aggiudicazioni");
  if (dimension === "value") {
    if (row.value === null || row.valueObservations < 30) reasons.push("Meno di 30 aggiudicazioni con valore attribuibile");
    if (!coverage90(row.valueObservations, row.awards)) reasons.push("Valore positivo attribuibile in meno del 90% delle aggiudicazioni");
    const assigned = decimalRatio(row.attributedValue), total = decimalRatio(row.awardValue);
    if (BigInt(total.numerator) === BigInt(0) || BigInt(assigned.numerator) * BigInt(total.denominator) * BigInt(10) < BigInt(total.numerator) * BigInt(assigned.denominator) * BigInt(9)) reasons.push("Meno del 90% del valore positivo dichiarato è attribuibile");
  }
  return reasons;
}

/** Overlap of two CPV distributions, including unknown procedures in each denominator. */
export function peerCpvOverlap(a: AnacPeerRow, b: AnacPeerRow): AnacPeerRatio {
  const denominator = BigInt(a.procedures) * BigInt(b.procedures);
  if (!denominator) return { numerator: "0", denominator: "1" };
  let numerator = BigInt(0);
  for (const [code, count] of Object.entries(a.mix)) {
    const left = BigInt(count) * BigInt(b.procedures), right = BigInt(b.mix[code] ?? 0) * BigInt(a.procedures);
    numerator += left < right ? left : right;
  }
  return fraction(numerator, denominator);
}

function withinFactorTwo(a: number, b: number): boolean {
  return BigInt(a) <= BigInt(b) * BigInt(2) && BigInt(b) <= BigInt(a) * BigInt(2);
}

export function selectAnacPeers(rows: readonly AnacPeerRow[], code: string, dimension: AnacPeerDimension) {
  const target = rows.find((row) => row.codiceIpa === code) ?? null;
  const exclusions = target ? peerExclusions(target, dimension) : ["Comune non collegato univocamente a ISTAT SITUAS 2025"];
  const eligible = rows.filter((row) => peerExclusions(row, dimension).length === 0);
  const peers = target && exclusions.length === 0 ? eligible.filter((row) =>
    row.istatCode !== target.istatCode && row.codiceIpa !== code
    && withinFactorTwo(target.population!, row.population!) && withinFactorTwo(target.procedures, row.procedures)
    && comparePeerRatios(peerCpvOverlap(target, row), ANAC_PEER_CPV_MINIMUM) >= 0,
  ).sort((a, b) => a.codiceIpa < b.codiceIpa ? -1 : a.codiceIpa > b.codiceIpa ? 1 : 0) : [];
  return { target, exclusions, eligibleCount: eligible.length, peers, publish: exclusions.length === 0 && peers.length >= ANAC_PEER_MINIMUM };
}

export function summarizeAnacPeers(target: AnacPeerRow, peers: readonly AnacPeerRow[], dimension: AnacPeerDimension, metric: AnacPeerMetric) {
  if (peerExclusions(target, dimension).length || peers.length < ANAC_PEER_MINIMUM
    || new Set(peers.map((row) => row.istatCode)).size !== peers.length
    || peers.some((row) => row.istatCode === target.istatCode || peerExclusions(row, dimension).length)) return null;
  const values = peers.map((row) => row[dimension]![metric]).sort(comparePeerRatios);
  const middle = Math.floor(values.length / 2), right = values[middle], left = values[middle - 1];
  const median = values.length % 2 ? right : fraction(
    BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(2) * BigInt(left.denominator) * BigInt(right.denominator),
  );
  const value = target[dimension]![metric];
  const less = values.filter((v) => comparePeerRatios(v, value) < 0).length;
  const equal = values.filter((v) => comparePeerRatios(v, value) === 0).length;
  return { value, median, percentile: fraction(BigInt(2 * less + equal), BigInt(2 * values.length)) };
}

export function validateAnacPeerSnapshot(value: unknown) {
  const snapshot = snapshotSchema.parse(value);
  if (snapshot.municipalProfiles !== snapshot.rows.length || snapshot.municipalProfiles + snapshot.ambiguousProfilesExcluded > snapshot.totalProfiles
    || new Set(snapshot.rows.map((r) => r.codiceIpa)).size !== snapshot.rows.length || new Set(snapshot.rows.map((r) => r.istatCode)).size !== snapshot.rows.length) throw new Error("Identità indice confronti non riconciliate.");
  for (const row of snapshot.rows) {
    if (row.stableAwards > row.awards || row.positiveAwards > row.awards || row.valueObservations > row.positiveAwards
      || Object.values(row.mix).reduce((s, n) => s + n, 0) > row.procedures
      || comparePeerRatios(decimalRatio(row.attributedValue), decimalRatio(row.awardValue)) > 0
      || (row.count !== null && row.awards < 30) || (row.value !== null && row.valueObservations < 30)) throw new Error("Copertura indice confronti non riconciliata.");
    for (const m of [row.count, row.value]) if (m && (comparePeerRatios(m.top1Share, m.top10Share) > 0 || comparePeerRatios(m.top10Share, { numerator: "1", denominator: "1" }) > 0 || comparePeerRatios(m.hhi10000, { numerator: "10000", denominator: "1" }) > 0)) throw new Error("Indicatori indice confronti non validi.");
  }
  return snapshot;
}

async function readBounded(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error("Indice confronti oltre il limite.");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error("Indice confronti modificato durante la lettura.");
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}

export async function loadAnacPeerSnapshot(root = process.cwd()) {
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const [specBytes, metaBytes, compressed, ...inputs] = await Promise.all([
    readBounded(join(root, "scripts/etl/specs/anac-procurement-peers.source.json"), 100_000),
    readBounded(join(root, "src/data/generated/anac-procurement-peers/meta.json"), 100_000),
    readBounded(join(root, "src/data/generated/anac-procurement-peers/snapshot.json.gz"), 4_000_000),
    ...Object.values(spec.inputs).map((entry) => readBounded(join(root, entry.path), 24_000_000)),
  ]);
  if (JSON.stringify(JSON.parse(specBytes.toString("utf8"))) !== JSON.stringify(spec)
    || inputs.some((bytes, i) => hash(bytes) !== Object.values(spec.inputs)[i].sha256)) throw new Error("Provenienza indice confronti non riconciliata.");
  const metadata = metadataSchema.parse(JSON.parse(metaBytes.toString("utf8")));
  if (compressed.length !== metadata.bytes || hash(compressed) !== metadata.sha256) throw new Error("Hash indice confronti divergente.");
  const raw = await promisify(gunzip)(compressed, { maxOutputLength: 24_000_000 });
  if (raw.length !== metadata.rawBytes) throw new Error("Dimensione indice confronti divergente.");
  const snapshot = validateAnacPeerSnapshot(JSON.parse(raw.toString("utf8")));
  if (snapshot.sourceSpecSha256 !== hash(specBytes)) throw new Error("Source lock confronti divergente.");
  return snapshot;
}
