import "server-only";

import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import metadata from "@/data/generated/pnrr-projects-index/meta.json";
import { sha256Hex } from "@/lib/integrated-source-contract";

export const pnrrProjectMetadata = metadata;
export const PNRR_PROJECT_DATASET = "pnrr-progetti";
export const pnrrFilterPatterns = {
  cup: /^[A-Z0-9]{15}$/,
  mission: /^M[1-7]$/,
  component: /^M[1-7]C[1-9]$/,
  measure: /^M[1-7]C[1-9][IR][0-9][A-Z0-9.]{0,14}$/,
  submeasure: /^M[1-7]C[1-9][IR][0-9][A-Z0-9.]{0,14}$/,
  code: /^(?:[0-9]{11}|FR[0-9]{11})$/,
  region: /^[0-9]{3}$/,
  province: /^[0-9]{3}$/,
  territory: /^[0-9]{6}$/,
} as const;
export type PnrrFilter = keyof typeof pnrrFilterPatterns;
export type PnrrFilters = Partial<Record<PnrrFilter, string>>;
export const pnrrFilterNames = Object.keys(pnrrFilterPatterns) as PnrrFilter[];
type IndexField = PnrrFilter | "regionProvince" | "regionTerritory";
const indexPatterns = { ...pnrrFilterPatterns, regionProvince: /^[0-9]{3}:[0-9]{3}$/, regionTerritory: /^[0-9]{3}:[0-9]{6}$/ };
const unzip = promisify(gunzip);
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
type Index = Readonly<Record<string, readonly number[]>>;
const cachedIndexes = new Map<IndexField, Promise<Index>>();

async function readIndex(field: IndexField): Promise<Index> {
  const expected = metadata.files[field];
  if (!expected || expected.bytes > MAX_INDEX_BYTES || expected.rawBytes > MAX_INDEX_BYTES) {
    throw new Error("Contratto indice PNRR non valido.");
  }
  const handle = await open(join(process.cwd(), "src/data/generated/pnrr-projects-index", `${field}.json.gz`), constants.O_RDONLY | constants.O_NOFOLLOW);
  let payload: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expected.bytes) throw new Error("Dimensione indice PNRR divergente.");
    payload = Buffer.alloc(expected.bytes + 1);
    let position = 0;
    while (position < payload.length) {
      const { bytesRead } = await handle.read(payload, position, payload.length - position, position);
      if (bytesRead === 0) break;
      position += bytesRead;
    }
    if (position !== expected.bytes) throw new Error("Indice PNRR cambiato durante la lettura.");
    payload = payload.subarray(0, position);
  } finally { await handle.close(); }
  if (sha256Hex(payload) !== expected.sha256) throw new Error("Hash indice PNRR divergente.");
  const raw = await unzip(payload, { maxOutputLength: MAX_INDEX_BYTES });
  if (raw.length !== expected.rawBytes) throw new Error("Dimensione decompressione indice PNRR divergente.");
  const index: unknown = JSON.parse(raw.toString("utf8"));
  if (index === null || typeof index !== "object" || Array.isArray(index)) throw new Error("Schema indice PNRR invalido.");
  for (const [key, refs] of Object.entries(index)) {
    if (!indexPatterns[field].test(key) || !Array.isArray(refs) || refs.length === 0) throw new Error("Voce indice PNRR invalida.");
    let previous = 0;
    for (const ref of refs) {
      if (!Number.isSafeInteger(ref) || ref <= previous || ref > metadata.coverage.projectRows) throw new Error("Riferimento PNRR invalido.");
      previous = ref;
    }
    Object.freeze(refs);
  }
  return Object.freeze(index) as Index;
}

async function loadIndex(field: IndexField): Promise<Index> {
  let promise = cachedIndexes.get(field);
  if (!promise) {
    promise = readIndex(field).catch((error: unknown) => { cachedIndexes.delete(field); throw error; });
    cachedIndexes.set(field, promise);
  }
  return promise;
}

function contains(sorted: readonly number[], value: number): boolean {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return sorted[low] === value;
}

/** References only; actual public rows are loaded at the integrated public boundary. */
export async function pnrrMatchingRows(filters: PnrrFilters): Promise<readonly number[] | null> {
  const lists: (readonly number[])[] = [];
  const { region, province, territory, ...projectFilters } = filters;
  const selected: Partial<Record<IndexField, string>> = { ...projectFilters };
  if (territory) {
    if (province && !territory.startsWith(province)) return [];
    if (region) selected.regionTerritory = `${region}:${territory}`;
    else selected.territory = territory;
  } else if (province) {
    if (region) selected.regionProvince = `${region}:${province}`;
    else selected.province = province;
  } else if (region) selected.region = region;
  for (const field of Object.keys(selected) as IndexField[]) {
    const value = selected[field];
    if (value !== undefined) {
      const index = await loadIndex(field);
      lists.push(Object.hasOwn(index, value) ? index[value] : []);
    }
  }
  if (lists.length === 0) return null;
  lists.sort((left, right) => left.length - right.length);
  const [smallest, ...others] = lists;
  return others.length === 0 ? smallest : smallest.filter((value) => others.every((list) => contains(list, value)));
}
