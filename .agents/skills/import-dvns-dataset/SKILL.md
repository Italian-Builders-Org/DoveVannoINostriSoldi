---
name: import-dvns-dataset
description: >-
  Import a new official Italian public-spending dataset into DoveVannoINostriSoldi
  using the integrated corpus (or a typed snapshot only when required), with
  fail-closed money/period/provenance fields and a PR-ready checklist.
---

# Import DVNS dataset

Use this skill when the user asks to add a new official data source, integrate a
CSV/API into the platform, or turn an issue like “aggiungi dataset X” into a PR.

Read and follow [docs/DATA_IMPORT_STANDARD.md](../../../docs/DATA_IMPORT_STANDARD.md)
before writing code. Prefer the **integrated corpus** path.

## Non-negotiables

- Official URLs only; hash every acquired byte.
- Fail-closed: unexpected schema, license, period, duplicates, or broken
  reconciliations block publish.
- Keep money natures distinct (forecast vs commitment vs payment). Never invent
  event or national totals by summing different perimeters.
- Keep dates distinct: reference period, publication, acquisition, checked-at.
- Empty cell ≠ observed zero ≠ unavailable.
- No waste/fraud/efficiency claims from accounting gaps alone.
- Do not create a page-only JSON that duplicates an integrated dataset.
- Do not add search aliases that steal city/entity queries (e.g. bare city names).

## Workflow

### 1. Scope

1. Open or link a GitHub issue with holder, canonical URL, license, format,
   geography, period, update frequency, and what the data does **not** measure.
2. Choose the binario from `DATA_IMPORT_STANDARD.md` (corpus vs typed snapshot).
3. If unsure, stop and ask: default is corpus `publication: rows`.

### 2. Acquire (corpus path)

1. Download from the canonical URL(s) only.
2. Record SHA-256, byte size, and acquisition timestamp.
3. Place bytes according to source-corpus policy; never commit private maps or
   restricted paths into the public tree.

### 3. Contract the rows

1. Define stable `headers`.
2. Project `cells` as `string | null` only.
3. Set `evidenceLabel`, `sourceUrls`, redactions/`privateFields` as needed.
4. Register the dataset in
   `scripts/etl/specs/integrated-curated-datasets.source.json` with complete
   `sourceMetadata` when the source declares it; otherwise leave fields null /
   `not-declared` without inventing values.
5. Write explicit caveats (e.g. do not sum forecast with payments).

### 4. Close the ledger

1. Build/update public row chunks, catalog, dataset-proof, release-proof.
2. Run:
   ```bash
   python3 scripts/etl/source_corpus_intake.py --check
   npm run test:etl
   npm run test:snapshots
   ```
3. Fix until offline checks pass. Do not disable gates.

### 5. Product surfaces

1. Ensure `/dati/[id]` works via the shared integrated selector.
2. Reuse MCP integrated query paths; do not mint a parallel dataset id for the
   same table.
3. If a UI page is requested, filter/aggregate existing rows; link sources; state
   out-of-scope clearly.

### 6. Typed snapshot path (exception)

Only when the product needs strong types (mission trees, CP/RS/CS) and string
cells are insufficient:

1. Add `scripts/etl/specs/<name>.source.json`.
2. Add fail-closed contract under `src/lib/data/`.
3. Add ETL + `--check`, register in `scripts/ci/generated-artifacts.json`, refresh
   `docs/SOURCE_SNAPSHOT_INVENTORY.md`.
4. Still satisfy money / period / provenance rules.

Prefer deriving typed snapshots from corpus bytes over a second unhashed fetch.

### 7. PR

1. Focused branch from latest `origin/main`.
2. Reference the issue.
3. List commands run and what was not run.
4. Call out caveats and non-goals in the PR body.

## Verification skill

After integrated-source or ledger changes, run
`.agents/skills/verify-dvns-integrated-sources/SKILL.md` on the affected
surfaces.

## Stop conditions (ask the user)

- License or redistribution terms are unclear and would affect publish.
- The source is only PDF/HTML without a structured extract plan.
- The request asks to invent totals, geographies, or efficiency rankings.
- Corpus private archive / source-map paths are required but unavailable.
