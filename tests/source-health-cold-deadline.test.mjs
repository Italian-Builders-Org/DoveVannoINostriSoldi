import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';

const { GET } = await import('../src/app/api/fonti/stato/route.ts');
const { getCachedSourceHealthOverview } = await import('../src/lib/data/cached-live-views.ts');
const { validateSourceHealthPayload } = await import('../scripts/runtime-health.mjs');

test('cold source-health reports timed-out upstreams before the HTTP request expires', async () => {
  const originalFetch = globalThis.fetch;
  const originalFetchMode = process.env.DVNS_SOURCE_FETCH_USE_GLOBAL;
  process.env.DVNS_SOURCE_FETCH_USE_GLOBAL = '1';
  const signals = [];
  globalThis.fetch = async (input, init = {}) => {
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    assert.ok(signal, 'every live probe must carry cancellation');
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      const fallback = setTimeout(() => reject(new Error('probe ignored cancellation')), 12_000);
      const abort = () => {
        clearTimeout(fallback);
        reject(signal.reason);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };

  try {
    const response = await GET(new Request('http://localhost/api/fonti/stato'));
    const payload = await response.json();
    // A timed-out caller must not leave its shared population using real fetch.
    await getCachedSourceHealthOverview();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.ok(signals.length > 0);
    assert.ok(signals.every(signal => signal.aborted));
    assert.equal(payload.summary.reachable, 0);
    assert.ok(payload.summary.unreachable > 0);
    const result = validateSourceHealthPayload(response, JSON.stringify(payload));
    assert.ok(result.warning, 'upstream timeouts remain visible to the runtime monitor');
    assert.equal(result.down.length, payload.summary.unreachable);

    const requests = signals.length;
    const warm = await GET(new Request('http://localhost/api/fonti/stato'));
    const cached = await warm.json();
    assert.equal(warm.status, 200);
    assert.equal(cached.observedAt, payload.observedAt);
    assert.deepEqual(cached.sources, payload.sources);
    assert.equal(signals.length, requests, 'the next caller reuses the completed health check');
  } finally {
    await getCachedSourceHealthOverview().catch(() => {});
    globalThis.fetch = originalFetch;
    if (originalFetchMode === undefined) delete process.env.DVNS_SOURCE_FETCH_USE_GLOBAL;
    else process.env.DVNS_SOURCE_FETCH_USE_GLOBAL = originalFetchMode;
  }
});
