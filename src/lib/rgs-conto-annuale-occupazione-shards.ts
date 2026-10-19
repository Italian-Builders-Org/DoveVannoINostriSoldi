import "server-only";

import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { occupationShardIdForCode, occupationShardPath } from "@/lib/rgs-conto-annuale-occupazione-paths";

export type OccupazioneSeriesTuple = readonly [number, string, number, number, string];

export type OccupazioneShardInstitution = Readonly<{
  code: string;
  name: string;
  type: string;
  bdap: string | null;
  permanentLatest: number;
  flexibleLatest: number;
  permanentBaseline: number | null;
  peakPermanent: number;
  peakYear: number;
  nameVariants: readonly string[];
  series: readonly OccupazioneSeriesTuple[];
}>;

type OccupazioneShardFile = Readonly<{
  schemaVersion: 1;
  bucket: number;
  institutions: Readonly<Record<string, OccupazioneShardInstitution>>;
}>;

const shardCache = new Map<string, OccupazioneShardFile>();
const MAX_SHARD_BYTES = 512 * 1024;

export function loadOccupazioneShardForCode(code: string): OccupazioneShardFile {
  const shardId = occupationShardIdForCode(code);
  const cached = shardCache.get(shardId);
  if (cached) return cached;
  const parsed = readJsonSnapshot(occupationShardPath(shardId), MAX_SHARD_BYTES) as OccupazioneShardFile;
  if (parsed.schemaVersion !== 1 || typeof parsed.institutions !== "object") {
    throw new Error(`Shard occupazione ${shardId}: schema non valido.`);
  }
  shardCache.set(shardId, parsed);
  return parsed;
}

export function getOccupazioneShardInstitution(code: string): OccupazioneShardInstitution | null {
  if (!/^[1-9]\d*$/.test(code)) return null;
  const shard = loadOccupazioneShardForCode(code);
  return shard.institutions[code] ?? null;
}
