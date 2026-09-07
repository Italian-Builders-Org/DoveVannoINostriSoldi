# Source ledger

The source ledger proves complete element, identity and row accounting while
withholding only unsafe identity values.

## Sub-features

- `coverage-receipt` shows 51.303 accounted elements.
- `source-equation` reconciles 34.071 identities.
- `quarantine-visible` exposes opaque IDs and reasons without values.
- `row-equation` reconciles 14.166.458 source rows.

## How to get to it (user POV)

- Choose `Fonti`, then `Copertura integrata`.
- Open `/fonti/catalogo` and filter `In quarantena`.
- Use `/api/fonti/catalogo?disposition=quarantined`.

## Driving it with verify-dvns-integrated-sources

Preconditions:

- The skill doctor passes.
- Source and release proofs pass offline.

- **Open coverage.** Run `node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive source-ledger`. The H1 states what was integrated and the release is complete.
- **Inspect quarantine.** The drive opens `/fonti/catalogo?disposition=quarantined&limit=5`; every visible result says `Valore non pubblicato`.
- **Proof.** Retain `coverage.png`, `quarantine.png`, `api-response.json` and `state.json`.

## Gotchas

- Quarantined identities are not omitted; never expect their private value.
- Occurrences and unique identities are different denominators.
- Manifest-only elements are accounted even when they are not product data.
- OpenCUP has 11.942.784 CSV records but 11.991.275 physical data lines because
  48.491 quoted newlines are internal to records.
- The Consip snapshot preserves 1.028.557 valid records and two malformed
  fragments as 1.028.559 physical units.
