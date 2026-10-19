import { join } from "node:path";

export const OCCUPAZIONE_INDEX_DIR = join(
  process.cwd(),
  "src/data/generated/rgs-conto-annuale-occupazione-ente-index",
);

export const OCCUPAZIONE_SHARD_COUNT = 256;

export function occupationShardIdForCode(code: string): string {
  const numeric = Number(code);
  if (!Number.isFinite(numeric) || numeric < 1) {
    throw new Error(`Codice istituzione non valido: ${code}`);
  }
  return String(numeric % OCCUPAZIONE_SHARD_COUNT).padStart(3, "0");
}

export function occupationShardPath(shardId: string): string {
  return join(OCCUPAZIONE_INDEX_DIR, "shards", `bucket-${shardId}.json`);
}
