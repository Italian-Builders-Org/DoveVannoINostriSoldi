# Integrated data catalog

The catalog exposes all 84 datasets and lets a user search a row-level dataset
without changing missing values, zeroes, sources or evidence labels.

## Sub-features

- `catalog-complete` lists every dataset and publication state.
- `dataset-open` opens a dataset from its public card.
- `dataset-search` filters public cells case-insensitively.
- `dataset-pagination` enforces bounded `limit` and `offset`.
- `dataset-api` returns the same selector result as the page.

## How to get to it (user POV)

- Choose `Cosa controllare`, then `Tutti i dataset`.
- Open `/dati` directly.
- Query `/api/dati/<dataset-id>` from an HTTP client.

## Driving it with verify-dvns-integrated-sources

Preconditions:

- The skill doctor passes for the run-owned server.
- `integrated_source_release.py --check` passes offline.

- **Open catalog.** Run `node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive integrated-data-catalog`. The H1 is `Tutti i dataset integrati`. The default view `/dati` leads with readable recipient/amount datasets (`Numeri da leggere`) and demotes coverage gaps (`Cosa manca ancora`); `/dati?vista=tutti` has 84 unique detail links.
- **Open detail.** The same drive navigates to `/dati/consulenze-legali?q=2024&limit=5`. The H1 is `Consulenze legali` and at most five matching rows render.
- **Confirm API parity.** The drive requests `/api/dati/consulenze-legali?q=2024&limit=5`, requires the same dataset ID and row bound, and stores the response.
- **Proof.** Retain `catalog.png`, `catalog-tutti.png`, `consulenze-legali.png`, `api-response.json` and `state.json` in the feature evidence directory.

## Gotchas

- Twenty-two datasets are not row-queryable: nineteen are intentionally
  `catalog-only` and three are `derived-only`; they must remain visible without
  invented rows.
- `not-declared` is a reuse caveat, not a row-access gate.
- A blank string, `null` and `"0"` have different meanings.
