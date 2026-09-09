# Runtime bundles and deployment time

The ANAC readers used `readFileSync(fd)` after checking an open file descriptor.
Turbopack interpreted the numeric descriptor as a dynamic filesystem path and
included the whole project in six route traces. The operator reader also resolved
the repository root before joining its fixed artifact directory, producing a
second broad tracing warning.

The readers now fill a buffer bounded by the checked file size using `readSync`
on the same descriptor. Partial reads continue until complete; early EOF fails
closed. The before/after file fingerprints, size limits, hashes, source locks,
path validation and descriptor cleanup remain in place. The operator artifact
path is joined directly from `process.cwd()` and its fixed directory.

## Local comparison

Measured on 8 September 2026, main `bbe8dcb5`, Node 22.23.2 and Next 16.3.3.
The same checkout and committed corpus were used before and after the reader
changes. Values count unique normalized paths in each emitted `.nft.json`,
including runtime code and data, in decimal MB.

| Route | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| `/enti/[codice]` | 689.0 MB | 318.8 MB | 54% |
| `/api/enti/[codice]` | 680.1 MB | 309.9 MB | 54% |
| `/enti/[codice]/appalti` | 658.3 MB | 60.6 MB | 91% |
| `/enti/[codice]/appalti/confronti` | 651.6 MB | 57.9 MB | 91% |
| `/appalti/operatori` | 651.1 MB | 219.1 MB | 66% |
| `/appalti/operatori/[ref]` | 651.2 MB | 219.1 MB | 66% |

The complete build contains 150 App Router traces. No trace includes tests,
documentation or research files after the change. The operator index remains
in its own routes; it is no longer bundled into entity routes. All required
ANAC shards and provenance files are present.

These are local trace sizes, not uploaded Vercel package sizes. Routes can share
files and Vercel can group functions, so do not sum these rows as storage or
transfer savings. The warm local rebuild is not a controlled compilation-time
benchmark. The separate operator browsing index work addresses request latency.

## Build gate

`npm run build` runs `scripts/ci/check-runtime-traces.mjs` after Next succeeds,
both locally and on Vercel. The gate rejects accidental tracing of tests, docs
or research, missing referenced files and cross-domain ANAC inclusion. It also
requires the entity/CPV shards, operator detail shards or browsing blocks, and
source-lock inputs consumed by each route, deriving the inventory from the
committed manifests. The operator listing must not include detail shards.

To inspect an existing build:

```bash
node scripts/ci/check-runtime-traces.mjs
node --test tests/runtime-traces.test.mjs
```

If a route intentionally starts reading a new runtime asset, update its precise
inventory and verify the deployed route. Do not suppress the gate or remove
integrity checks to silence a bundler warning.

## Hosted measurement

The production deployment of `bbe8dcb5` took 9m34s, including 7m53s in
`Deploying outputs`. This identifies the phase to compare after the package
change. That phase includes Vercel's internal work; its logs do not separate
upload time from platform processing. A smaller trace alone does not prove a
specific time or billing saving.

Compare deployments on the same build-machine configuration and record cache
restoration, compilation, output publication, total duration and Vercel resource
sizes. Build resources and runtime CPU/memory are separate settings. No larger
machine or reduction of correctness checks is required by this change.

## Route isolation, 9 September 2026

Compared with `62ed2e33`, using the same checkout, committed corpus, Node
22.23.2, Next 16.3.3 and macOS arm64. Values below use **MiB** (2^20 bytes),
counting unique normalized paths from the emitted traces after each build.

| Route | Before | After |
| --- | ---: | ---: |
| `/appalti/operatori` | 239.0 MiB | 47.1 MiB |
| `/appalti/operatori/[ref]` | 239.0 MiB | 239.0 MiB |
| `/spese/sanita/storico` | 241.1 MiB | 2.8 MiB |
| `/api/spese/sanita/storico` | 240.4 MiB | 2.1 MiB |
| `/stato/legislature` | 240.7 MiB | 2.3 MiB |
| `/api/spese/stato/legislature` | 240.4 MiB | 2.0 MiB |

Source health and the two historical views now own separate cache modules.
The historical modules no longer import the full source-health registry and
its unrelated snapshots. Shared cache coordination stays in `live-view-cache.ts`;
persistent keys, TTLs, single-flight, cancellation and failure caching retain
their existing behavior. Import each domain directly instead of adding a
barrel that reconnects their dependency graphs.

Five fresh Node processes per module, interleaved on the same machine, measured
the import itself with `performance.now()` and RSS with `process.memoryUsage()`:

| Import | Median time | Median process RSS |
| --- | ---: | ---: |
| Previous shared cache module | 2485.61 ms | 348.7 MiB |
| SSN history cache | 204.51 ms | 107.6 MiB |
| Legislature cache | 211.60 ms | 103.4 MiB |

These are module-initialization measurements, not complete request latency or
Vercel cold starts. The six operator benchmark operations retain identical
result digests and byte-read counts across the split. Both builds emitted
151 traces and passed the runtime inventory guard. Warm local build durations
were 69.59 s and 68.43 s; this single pair does not establish a compilation
speedup. The hosted baseline `e6800070` took 6m38s, including 304.654 s in
`Deploying outputs`; compare the subsequent deployment separately.

## CI caches

The production job restores only `.next/cache/turbopack`, keyed by runner OS,
architecture, Node version file, lockfile, Next configuration and commit. It can
reuse compiler work from an earlier compatible commit. Every run still builds
its current tree and executes every production gate. Runtime fetch responses
are not restored from CI cache.

Static, Node and ETL jobs skip the Chromium download; the production job retains
it. ETL caches pip downloads while retaining the hash-locked installation.
Lighthouse uploads explicitly include its JSON/HTML files under the hidden
`.lighthouseci` directory. Browser scenarios, deadlines and Lighthouse budgets
are unchanged. The first run populates the compiler cache; assess reuse on a
later run before claiming a hosted CI time reduction.
