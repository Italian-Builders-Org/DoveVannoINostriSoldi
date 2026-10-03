# GovCore public identity links — isolated offline proof

Reviewed DVNS base `535a68d964200b1a3e1ca36602418bc3117a35af` (3 October 2026, PR #722). The GitHub connector confirmed that exact SHA as remote `main` during this review. The original local checkout remained on older `673bb6d` with unrelated untracked work; it was never changed. This separate sparse checkout contains only the current source and artifacts required for the proof.

`tools/govcore/links.ts` accepts the existing validated server projection's `codiceIpa` and `codiceFiscale`, returning an ordered overlay of logical IDs and complete public resolver outcomes. It leaves records, totals, periods, coverage, provenance and accounting functions unchanged. It ignores headquarters geography, names, CUP/CIG, amounts, notes, case files and arbitrary record fields. No GovCore database connection or write exists in the adapter. A resolved ID is identity context; it grants no reporting-channel or action authority.

`tools/govcore` is optional and has an independent package manifest and lock. Its vendored tarball was built from the independently authored MIT SDK; the tarball includes compiled JavaScript, declarations and the MIT permission text. It installs offline without changing DVNS's main package manifest or lock. There is no dependency on an unpublished package registry.

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund --prefix tools/govcore
npm test --prefix tools/govcore
GOVCORE_URL=http://127.0.0.1:8041 npm run link --prefix tools/govcore -- --ipa c_d150 --ipa c_f023 --concurrency 2
npm run bench --prefix tools/govcore
```

The proof CLI only reads explicit IPA selections (at most 50). It gets the corresponding identity from the committed SIOPE server projection, adds a corroborating institutional tax code if present, and prints separate link metadata. IPA case variants reuse the canonical source projection. The installed offline network guard blocks external destinations; the supported proof target is the local API. No source refresh starts in response to a page visit, and no product route is activated.

Batch resolution deduplicates complete selector sets within a single call. Added identifiers remain separate queries because they may reveal a conflict. There are four workers by default, up to 16, with a 1,000-row hard ceiling; the CLI lowers it to 50. Each request retains the SDK timeout and response validation. Output keeps `resolved`, `ambiguous`, `not_found` and `conflict` distinct from fixed transport/schema/input errors. Ambiguity never picks the first candidate. There are no retries, cross-call result cache or routing cache.

Tests use actual current DVNS public identities and financial detail while a synthetic loopback server exercises resolution, ambiguity, conflict, missing identity, malformed schema and outage. They check ordered results, bounded simultaneous HTTP calls, duplicate reuse, whitelist-only query parameters, zero headquarters/financial fields, no input mutation and identical source bytes/accounting data. The independent CLI invocation exercises the packed SDK installed locally. These fixtures establish behavior, not official verification of synthetic authority replies.

The benchmark repeats five current public identities across 50 rows with controlled 10 ms loopback reply delay. It compares the old sequential one-row helper with the batch, recording requests, peak concurrency, elapsed time and identical result digests. Measured time includes this machine/runtime and is not a production SLA.

The read-only local five-town pilot uses current Core's actual FastAPI/PostgreSQL API for Cremona, Massa, Torino, Genova and Cessalto. Exact IPA and tax selectors corroborate the existing identities; one case-variant duplicate requires no additional request. No financial rows, external request, database write, routing authority or delivery is involved. Evidence and limits are in the separate `outputs/dvns-govcore-proof.json` artifact.

This is an isolated adapter/CLI proof and separate patch, not DVNS adoption, merge or deployment. Targeted Node/identity contracts, SDK typecheck/package tests and adapter typecheck are the pertinent checks. Full DVNS application/ETL/build/production gates are NOT RUN for this sparse optional tool; a product PR would require the repository's current complete gates and a fresh base review. No data migration is proposed.
