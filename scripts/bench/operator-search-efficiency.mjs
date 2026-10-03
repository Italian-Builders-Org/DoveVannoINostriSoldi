import '../../tests/helpers/register-ts-alias.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';

// Count exact runtime source reads, excluding module loading and report output.
const readFile = fs.readFileSync;
const read = fs.readSync;
let bytes = 0;
let nested = false;
fs.readFileSync = function (...args) {
  nested = true;
  try {
    const value = readFile.apply(this, args);
    bytes += Buffer.byteLength(value);
    return value;
  } finally {
    nested = false;
  }
};
fs.readSync = function (...args) {
  const count = read.apply(this, args);
  if (!nested) bytes += count;
  return count;
};
syncBuiltinESMExports();

// The override permits comparison with a git-show copy without changing HEAD.
const adapter = await import(
  process.env.OPERATOR_SEARCH_MODULE ?? '../../src/lib/data/anac-operator-awards-index.ts'
);
const queries = [
  'autostrade', 'srl', 'spa', 'servizi', 'cooperativa',
  'ＳＲＬ', ' edilizia ', '!!!', 'zzzzzz-no-match',
];
const limits = process.env.OPERATOR_SEARCH_COMPACT === '1'
  ? [50]
  : [1, 10.75, 25, 50, 500, 0, NaN];
const passes = Number(process.env.OPERATOR_SEARCH_PASSES ?? 3);

function measure(label, run) {
  bytes = 0;
  const cpu = process.cpuUsage();
  const start = performance.now();
  const result = run();
  const elapsed = process.cpuUsage(cpu);
  const memory = process.memoryUsage();
  console.log(JSON.stringify({
    label,
    milliseconds: performance.now() - start,
    cpuMs: (elapsed.user + elapsed.system) / 1000,
    bytesRead: bytes,
    rssMiB: memory.rss / 1024 ** 2,
    heapMiB: memory.heapUsed / 1024 ** 2,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    digest: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
  }));
}

try {
  console.log(JSON.stringify({
    node: process.version, platform: process.platform, architecture: process.arch,
  }));
  measure('cold-search', () => adapter.searchAnacOperators({ q: queries[0], limit: 50 }));
  for (let pass = 1; pass <= passes; pass++) {
    measure(`warm-search-${pass}`, () => queries.flatMap(q =>
      limits.map(limit => adapter.searchAnacOperators({ q, limit }))
    ));
  }
  measure('ranked-pages', () => ['awardCount', 'attributedValue'].flatMap(by =>
    [1, 2, 1234, 999999].map(page => adapter.listAnacOperatorsPage({ by, page, pageSize: 50 }))
  ));
  globalThis.gc?.();
  measure('warm-retained', () => queries.map(q => adapter.searchAnacOperators({ q, limit: 50 })));
  if (globalThis.gc) {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    measure('distinct-query-scan', () => {
      for (let i = 0; i < 128; i++) {
        adapter.searchAnacOperators({ q: `zzzzbenchmarknomatch${i}`, limit: 50 });
      }
      return { queries: 128 };
    });
    globalThis.gc();
    const retainedGrowth = process.memoryUsage().heapUsed - before;
    console.log(JSON.stringify({
      label: 'distinct-query-retained', heapGrowthMiB: retainedGrowth / 1024 ** 2,
    }));
    if (retainedGrowth > 4 * 1024 ** 2) {
      throw new Error('query working set retained more than 4 MiB');
    }
  }
} finally {
  fs.readFileSync = readFile;
  fs.readSync = read;
  syncBuiltinESMExports();
}
