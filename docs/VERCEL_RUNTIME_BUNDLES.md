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
requires every entity/CPV/operator shard and the source-lock inputs consumed by
the affected routes, deriving the inventory from the committed manifests.

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
