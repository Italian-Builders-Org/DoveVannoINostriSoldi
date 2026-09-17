export type FreshnessState = "fresh" | "stale" | "unknown";

export type Freshness = {
  state: FreshnessState;
  sourceTimestamp: string | null;
  ageSeconds: number | null;
  staleAfterSeconds: number | null;
  checkedAt: string;
};

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Classifies one source timestamp without knowing anything about the source.
 * The source adapter supplies its own stale threshold from source-policy.ts.
 * Keeping this helper framework-independent makes it reusable in workers,
 * tests and future ingestion jobs without Next.js path aliases.
 */
export function classifyFreshness(
  staleAfterSeconds: number | null,
  sourceTimestamp: string | null,
  now: Date = new Date(),
): Freshness {
  const parsed = parseTimestamp(sourceTimestamp);
  const checkedAt = now.toISOString();

  if (parsed === null || staleAfterSeconds === null) {
    return {
      state: "unknown",
      sourceTimestamp,
      ageSeconds: parsed === null ? null : Math.max(0, (now.getTime() - parsed) / 1_000),
      staleAfterSeconds,
      checkedAt,
    };
  }

  const ageSeconds = (now.getTime() - parsed) / 1_000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < -300) {
    return {
      state: "unknown",
      sourceTimestamp,
      ageSeconds: null,
      staleAfterSeconds,
      checkedAt,
    };
  }

  return {
    state: ageSeconds > staleAfterSeconds ? "stale" : "fresh",
    sourceTimestamp,
    ageSeconds: Math.max(0, ageSeconds),
    staleAfterSeconds,
    checkedAt,
  };
}
