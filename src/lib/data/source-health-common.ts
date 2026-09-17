import { classifyFreshness, type Freshness } from "@/lib/data/freshness";
import { SOURCE_POLICIES, type SourceId, type SourcePolicy } from "@/lib/data/source-policy";
import type { SsnCceSourceHealth } from "@/lib/ssn-cce-snapshot";

export type SourceIntegrationState = "active" | "configured";
export type SourceReachability = "up" | "down" | "not-probed";

export type SourceHealth = {
  sourceId: SourceId;
  label: string;
  owner: string;
  integration: SourceIntegrationState;
  reachability: SourceReachability;
  freshness: Freshness;
  checkedAt: string;
  latencyMs: number | null;
  detail: string | null;
  recordCount: number | null;
  /** Verifiche degli artifact versionati: non avviano refresh della fonte. */
  snapshot?: SsnCceSourceHealth;
  policy: Pick<
    SourcePolicy,
    | "cadence"
    | "cadenceNote"
    | "discoveryRevalidateSeconds"
    | "dataRevalidateSeconds"
    | "staleAfterSeconds"
    | "sourceUrl"
  >;
};

export function freshnessFor(sourceId: SourceId, sourceTimestamp: string | null): Freshness {
  return classifyFreshness(
    SOURCE_POLICIES[sourceId].staleAfterSeconds,
    sourceTimestamp,
  );
}

export function baseHealth(
  sourceId: SourceId,
  integration: SourceIntegrationState = SOURCE_POLICIES[sourceId].integration ?? "active",
): Omit<
  SourceHealth,
  "reachability" | "freshness" | "latencyMs" | "detail" | "recordCount"
> {
  const policy = SOURCE_POLICIES[sourceId];
  return {
    sourceId,
    label: policy.label,
    owner: policy.owner,
    integration,
    checkedAt: new Date().toISOString(),
    policy: {
      cadence: policy.cadence,
      cadenceNote: policy.cadenceNote,
      discoveryRevalidateSeconds: policy.discoveryRevalidateSeconds,
      dataRevalidateSeconds: policy.dataRevalidateSeconds,
      staleAfterSeconds: policy.staleAfterSeconds,
      sourceUrl: policy.sourceUrl,
    },
  };
}
