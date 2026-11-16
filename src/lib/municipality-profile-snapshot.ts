import "server-only";

import { join } from "node:path";
import manifest from "@/data/generated/municipality-profile/manifest.json";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { integratedRowChunkCount, integratedRowChunkName, sha256Hex, type IntegratedPublicRow } from "@/lib/integrated-source-contract";
import { loadIntegratedSourceBundle, type IntegratedSourceBundle } from "@/lib/integrated-sources";
import type { MunicipalityRealEstate } from "@/lib/municipality-real-estate";

export type MunicipalitySchoolRow = Pick<IntegratedPublicRow, "id" | "cells">;

export type MunicipalityProfileShard = {
  schools: Record<string, MunicipalitySchoolRow>;
  realEstate: Record<string, MunicipalityRealEstate>;
};

const snapshot = manifest as { sources: Record<string, string>; shards: Record<string, string> };

export function municipalityProfileBucket(key: string): string {
  return sha256Hex(key).slice(0, 1);
}

export function municipalityProfileSourceDigest(bundle: IntegratedSourceBundle, id: string): string | null {
  const dataset = bundle.datasetsById.get(id);
  if (!dataset) return null;
  const hashes = Array.from({ length: integratedRowChunkCount(dataset.publicRows) }, (_, ordinal) =>
    bundle.datasetProof.artifactSha256[`src/data/generated/integrated/rows/${integratedRowChunkName(id, ordinal)}`]);
  return sha256Hex(JSON.stringify([dataset.receiptSha256, hashes]));
}

/** Undefined means the live corpus must handle this release. A missing key in
 * a verified shard is an exact miss in the released data. */
export async function readMunicipalityProfileSnapshot(
  key: string, sources: readonly string[], signal?: AbortSignal,
): Promise<MunicipalityProfileShard | undefined> {
  const backend = process.env.DVNS_BUILD_DATA_BACKEND ?? process.env.DVNS_DATA_BACKEND;
  if (backend !== "supabase") return undefined;
  signal?.throwIfAborted();
  const bundle = await loadIntegratedSourceBundle();
  signal?.throwIfAborted();
  if (!sources.every((id) => snapshot.sources[id] === municipalityProfileSourceDigest(bundle, id))) return undefined;
  const bucket = municipalityProfileBucket(key);
  const digest = snapshot.shards[bucket];
  if (!digest) throw new Error("Indice degli snapshot comunali incompleto.");
  return readJsonSnapshot(
    join(process.cwd(), "src/data/generated/municipality-profile", `${bucket}.json.gz`), 128 * 1024,
    { sha256: digest, maxOutputLength: 1024 * 1024 },
  ) as MunicipalityProfileShard;
}
