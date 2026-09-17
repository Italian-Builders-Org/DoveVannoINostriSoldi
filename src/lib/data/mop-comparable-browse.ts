import "server-only";

import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const MOP_COMPARABLE_DATA = "src/data/generated/mop-comparable-browse.data.jsonl.gz";
export const MOP_COMPARABLE_META = "src/data/generated/mop-comparable-browse.meta.json";
export const MOP_COMPARABLE_DIR = "src/data/generated";
export const MOP_COMPARABLE_META_FILE = "mop-comparable-browse.meta.json";
export const MOP_COMPARABLE_DATA_FILE = "mop-comparable-browse.data.jsonl.gz";
export const MOP_COMPARABLE_PAGE_SIZE = 50;
export const MOP_COMPARABLE_ORDERS = ["deltaAbs", "planned", "actual"] as const;
export const MOP_COMPARABLE_PROGRESS = ["in-corso", "concluso", "non-determinato"] as const;

export type MopComparableOrder = (typeof MOP_COMPARABLE_ORDERS)[number];
export type MopComparableProgress = (typeof MOP_COMPARABLE_PROGRESS)[number];

const facetSchema = z.object({
  label: z.string().min(1),
  count: z.number().int().positive(),
}).strict();

const metaSchema = z.object({
  schemaVersion: z.literal(1),
  dataset: z.literal("mop-comparable-browse"),
  observedAt: z.string().min(1),
  generatedAt: z.string().min(1),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.object({
    owner: z.string().min(1),
    dataset: z.string().min(1),
    landingUrl: z.string().url(),
    datasetId: z.string().min(1),
    license: z.string().min(1),
    sourceLastUpdate: z.string().min(1),
    declaredCadence: z.string().min(1),
  }).strict(),
  coverage: z.object({
    publishedWorks: z.number().int().nonnegative(),
    scannedRows: z.number().int().nonnegative(),
    droppedInvalidRows: z.number().int().nonnegative(),
    nonComparableAmongScanned: z.number().int().nonnegative(),
    pagesFetched: z.number().int().nonnegative(),
    sourceCupCardinality: z.number().int().positive(),
    sourceLocalProjectCardinality: z.number().int().positive(),
    sourceColumnCount: z.number().int().positive(),
  }).strict(),
  scope: z.object({
    distributionKind: z.string().min(1),
    comparableRule: z.string().min(1),
    acquisitionOrder: z.string().min(1),
    nationalPopulationClaim: z.literal("not-asserted"),
    geography: z.literal("absent-in-mop-columns"),
    note: z.string().min(1),
  }).strict(),
  facets: z.object({
    sectors: z.array(facetSchema),
    categories: z.array(facetSchema),
    statuses: z.array(facetSchema),
    progress: z.array(facetSchema).optional(),
  }).strict(),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    dataArtifact: z.object({
      path: z.string().min(1),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
    sourceSpecSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  }).strict(),
  methodology: z.object({
    moneyFamily: z.string().min(1),
    delta: z.string().min(1),
    screeningOnly: z.string().min(1),
    regions: z.string().min(1),
    ongoingWorks: z.string().min(1).optional(),
  }).strict(),
  limitations: z.array(z.string().min(1)).min(1),
}).strict();

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const workSchema = z.object({
  localCode: z.string().min(1),
  cup: z.string().regex(/^[A-Z0-9]{15}$/),
  description: z.string().min(1),
  statusCode: z.string().min(1),
  status: z.string().min(1),
  holderName: z.string().min(1),
  nature: z.string().nullable(),
  interventionType: z.string().nullable(),
  sector: z.string().nullable(),
  subsector: z.string().nullable(),
  category: z.string().nullable(),
  plannedTotalCents: z.number().int().positive(),
  actualTotalCents: z.number().int().positive(),
  deltaCents: z.number().int(),
  deltaAbsCents: z.number().int().nonnegative(),
  changeBasisPoints: z.number().int(),
  plannedExecutionStart: optionalDate.optional(),
  plannedExecutionEnd: optionalDate.optional(),
  actualExecutionStart: optionalDate.optional(),
  actualExecutionEnd: optionalDate.optional(),
  progress: z.enum(MOP_COMPARABLE_PROGRESS).optional(),
}).strict();

export type MopComparableMeta = z.infer<typeof metaSchema>;
export type MopComparableWork = z.infer<typeof workSchema> & {
  progress: MopComparableProgress;
  plannedExecutionStart: string | null;
  plannedExecutionEnd: string | null;
  actualExecutionStart: string | null;
  actualExecutionEnd: string | null;
};

export type MopComparableQuery = {
  q?: string;
  sector?: string;
  category?: string;
  status?: string;
  progress?: string;
  order?: MopComparableOrder;
  page?: number;
  pageSize?: number;
};

export type MopComparableListing = {
  meta: MopComparableMeta;
  works: readonly MopComparableWork[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  order: MopComparableOrder;
  filters: {
    q: string | null;
    sector: string | null;
    category: string | null;
    status: string | null;
    progress: string | null;
  };
};

export type MopComparableSummaries = {
  progress: Array<{ label: MopComparableProgress; count: number }>;
  sectors: Array<{ label: string; count: number; plannedEuro: number; actualEuro: number }>;
};

let cached: { meta: MopComparableMeta; works: readonly MopComparableWork[] } | null = null;

function deriveProgress(work: z.infer<typeof workSchema>): MopComparableProgress {
  if (work.progress) return work.progress;
  if (work.actualExecutionEnd || work.statusCode === "C" || work.status.toUpperCase() === "CHIUSO") {
    return "concluso";
  }
  if (work.statusCode === "A" || work.status.toUpperCase() === "ATTIVO") return "in-corso";
  return "non-determinato";
}

function normalizeWork(raw: z.infer<typeof workSchema>): MopComparableWork {
  return {
    ...raw,
    plannedExecutionStart: raw.plannedExecutionStart ?? null,
    plannedExecutionEnd: raw.plannedExecutionEnd ?? null,
    actualExecutionStart: raw.actualExecutionStart ?? null,
    actualExecutionEnd: raw.actualExecutionEnd ?? null,
    progress: deriveProgress(raw),
  };
}

function readBoundedFile(absolutePath: string, maxBytes: number, label: string): Buffer {
  // Bound the read to the checked descriptor without a dynamic readFileSync
  // argument, which makes Turbopack trace unrelated repository files (docs/).
  const fd = openSync(absolutePath, "r");
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= 0) throw new Error(`Artifact assente: ${label}`);
    if (info.size > maxBytes) throw new Error(`Artifact troppo grande: ${label}`);
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error(`Artifact incompleto: ${label}`);
      offset += count;
    }
    const after = fstatSync(fd);
    if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ino !== after.ino) {
      throw new Error(`Artifact cambiato durante la lettura: ${label}`);
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function loadBundle(): { meta: MopComparableMeta; works: readonly MopComparableWork[] } {
  if (cached) return cached;
  const metaBytes = readBoundedFile(
    join(process.cwd(), MOP_COMPARABLE_DIR, MOP_COMPARABLE_META_FILE),
    512 * 1024,
    MOP_COMPARABLE_META_FILE,
  );
  const meta = metaSchema.parse(JSON.parse(metaBytes.toString("utf8")));
  const dataBytes = readBoundedFile(
    join(process.cwd(), MOP_COMPARABLE_DIR, MOP_COMPARABLE_DATA_FILE),
    40 * 1024 * 1024,
    MOP_COMPARABLE_DATA_FILE,
  );
  const digest = createHash("sha256").update(dataBytes).digest("hex");
  if (digest !== meta.integrity.dataArtifact.sha256) {
    throw new Error("Hash mop-comparable-browse non allineato");
  }
  if (dataBytes.byteLength !== meta.integrity.dataArtifact.bytes) {
    throw new Error("Dimensione mop-comparable-browse non allineata");
  }
  const text = gunzipSync(dataBytes).toString("utf8");
  const works = text
    .split("\n")
    .filter(Boolean)
    .map((line) => normalizeWork(workSchema.parse(JSON.parse(line))));
  if (works.length !== meta.coverage.publishedWorks) {
    throw new Error("Conteggio opere mop-comparable-browse non allineato");
  }
  const seen = new Set<string>();
  const progressCounts = new Map<MopComparableProgress, number>();
  for (const work of works) {
    if (seen.has(work.localCode)) throw new Error(`Duplicato localCode ${work.localCode}`);
    seen.add(work.localCode);
    progressCounts.set(work.progress, (progressCounts.get(work.progress) ?? 0) + 1);
  }
  const enrichedMeta: MopComparableMeta = {
    ...meta,
    facets: {
      ...meta.facets,
      progress: [...progressCounts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count),
    },
  };
  cached = { meta: enrichedMeta, works };
  return cached;
}

export function getMopComparableMeta(): MopComparableMeta {
  return loadBundle().meta;
}

export function getMopComparableSummaries(): MopComparableSummaries {
  const { works } = loadBundle();
  const progressMap = new Map<MopComparableProgress, number>();
  const sectorMap = new Map<string, { count: number; planned: number; actual: number }>();
  for (const work of works) {
    progressMap.set(work.progress, (progressMap.get(work.progress) ?? 0) + 1);
    if (!work.sector) continue;
    const current = sectorMap.get(work.sector) ?? { count: 0, planned: 0, actual: 0 };
    current.count += 1;
    current.planned += work.plannedTotalCents;
    current.actual += work.actualTotalCents;
    sectorMap.set(work.sector, current);
  }
  return {
    progress: [...progressMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count),
    sectors: [...sectorMap.entries()]
      .map(([label, value]) => ({
        label,
        count: value.count,
        plannedEuro: value.planned / 100,
        actualEuro: value.actual / 100,
      }))
      .sort((left, right) => right.plannedEuro - left.plannedEuro),
  };
}

function compareWorks(order: MopComparableOrder, left: MopComparableWork, right: MopComparableWork): number {
  if (order === "planned") {
    return right.plannedTotalCents - left.plannedTotalCents || left.cup.localeCompare(right.cup);
  }
  if (order === "actual") {
    return right.actualTotalCents - left.actualTotalCents || left.cup.localeCompare(right.cup);
  }
  return (
    right.deltaAbsCents - left.deltaAbsCents ||
    right.plannedTotalCents - left.plannedTotalCents ||
    left.cup.localeCompare(right.cup)
  );
}

function normalizeFilter(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function queryMopComparableBrowse(input: MopComparableQuery = {}): MopComparableListing {
  const { meta, works } = loadBundle();
  const q = normalizeFilter(input.q)?.toLocaleLowerCase("it-IT") ?? null;
  const sector = normalizeFilter(input.sector);
  const category = normalizeFilter(input.category);
  const status = normalizeFilter(input.status);
  const progress = normalizeFilter(input.progress);
  const order = MOP_COMPARABLE_ORDERS.includes(input.order as MopComparableOrder)
    ? (input.order as MopComparableOrder)
    : "deltaAbs";
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? MOP_COMPARABLE_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(input.page ?? 1));

  const filtered = works.filter((work) => {
    if (sector && work.sector !== sector) return false;
    if (category && work.category !== category) return false;
    if (status && work.status !== status) return false;
    if (progress && work.progress !== progress) return false;
    if (!q) return true;
    const haystack = `${work.cup} ${work.description} ${work.holderName} ${work.localCode}`.toLocaleLowerCase("it-IT");
    return haystack.includes(q);
  });

  const sorted = [...filtered].sort((left, right) => compareWorks(order, left, right));
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;

  return {
    meta,
    works: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page: safePage,
    pageSize,
    pageCount,
    order,
    filters: { q, sector, category, status, progress },
  };
}
