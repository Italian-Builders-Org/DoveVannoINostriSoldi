# RGS public pages

The RGS pages expose consulting payments and territorial state spending with
their accounting scopes and non-additivity visible.

## Sub-features

- `rgs-consulting` renders 268 selected 2024–2025 accounting rows.
- `rgs-zero` distinguishes 153 observed zero-payment rows from missing data.
- `rgs-territorial` exposes 5.067 dimension combinations.
- `rgs-measures` keeps four publisher measures separate.
- `rgs-levels` does not sum Italy, macroareas and regions.

## How to get to it (user POV)

- Choose `Soldi`, then `Consulenze ministeriali`.
- Choose `Soldi`, then `Spesa statale per territorio`.
- Open `/spese/consulenze` or `/spese/territoriale` directly.

## Driving it with verify-dvns-integrated-sources

Preconditions:

- The skill doctor passes.
- Both RGS public-view test files pass.

- **Open consulting.** Run `node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive rgs-public-pages`. The consulting H1 and accounting table region are visible.
- **Open territorial view.** The drive opens the territorial page and requires the table caption `Una sola misura e un solo livello territoriale per tabella`.
- **Proof.** Retain `consulenze.png`, `territoriale.png` and `state.json`.

## Gotchas

- `Pagato CS` is an accounting aggregate, not a contract or beneficiary.
- Percentage, per-capita and per-km² values are not additive.
- The territorial source does not declare a resource license; do not infer one.
