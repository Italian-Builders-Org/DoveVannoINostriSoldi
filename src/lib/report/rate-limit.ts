/**
 * In-memory sliding-window limiter.
 *
 * Deliberately simple: the site runs on serverless instances without a shared
 * store, so this protects a single warm instance from bursts and complements
 * the honeypot, the timing checks and GitHub's own abuse controls. It is not a
 * durable, global limit — see docs/SEGNALAZIONI.md for the documented gap.
 */

export type RateLimitRule = Readonly<{ windowMs: number; max: number }>;

export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #rule: RateLimitRule;
  readonly #maxKeys: number;

  constructor(rule: RateLimitRule, { maxKeys = 5_000 }: { maxKeys?: number } = {}) {
    this.#rule = rule;
    this.#maxKeys = maxKeys;
  }

  /** Records a hit and returns whether it is still within the allowance. */
  consume(key: string, now = Date.now()): boolean {
    const floor = now - this.#rule.windowMs;
    const recent = (this.#hits.get(key) ?? []).filter((timestamp) => timestamp > floor);
    if (recent.length >= this.#rule.max) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    this.#evict(floor);
    return true;
  }

  #evict(floor: number): void {
    if (this.#hits.size <= this.#maxKeys) return;
    for (const [key, timestamps] of this.#hits) {
      if (timestamps.every((timestamp) => timestamp <= floor)) this.#hits.delete(key);
      if (this.#hits.size <= this.#maxKeys) return;
    }
    // Still too many live keys: drop the oldest insertion to bound memory.
    const oldest = this.#hits.keys().next().value;
    if (oldest !== undefined) this.#hits.delete(oldest);
  }
}

/** First hop of X-Forwarded-For, or null. Never logged: used only as a limiter key. */
export function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first && first.length <= 64 && /^[0-9a-f.:%]+$/iu.test(first)) return first.toLowerCase();
  const real = request.headers.get("x-real-ip")?.trim();
  if (real && real.length <= 64 && /^[0-9a-f.:%]+$/iu.test(real)) return real.toLowerCase();
  return null;
}

/** Per-instance bulkhead for expensive handlers. Distributed WAF remains the outer layer. */
export class ConcurrencyLimiter {
  #active = 0;
  readonly max: number;

  constructor(max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new Error("Concurrency limit must be positive");
    this.max = max;
  }

  tryAcquire(): (() => void) | null {
    if (this.#active >= this.max) return null;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}
