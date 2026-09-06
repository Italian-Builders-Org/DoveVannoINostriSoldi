# Thematic hubs

The thematic hubs make all integrated domains reachable without duplicating
or reinterpreting the canonical dataset rows.

## Sub-features

- `hub-procurement` groups procurement datasets.
- `hub-appointments` groups consultancies and personnel.
- `hub-operations` groups operating and state-account data.
- `hub-transparency` groups missing documents, evidence and benchmarks.
- `primary-previews` limits each main-page preview to at most three paths.
- `participations-preview` keeps the national MEF view primary and exposes the
  three focused participation datasets.
- `hub-navigation` reaches every hub from the shared navigation or footer.

## How to get to it (user POV)

- Open `/appalti/dettaglio` or `/incarichi/dettaglio` under `Cosa controllare`.
- Open `/spese/operative` under `Soldi`.
- Open `/trasparenza` under `Cosa controllare`.
- Open `/partecipazioni` under `Enti e società`.

## Driving it with verify-dvns-integrated-sources

Preconditions:

- The skill doctor passes.
- Navigation and typecheck gates pass.

- **Visit all hubs.** Run `node .agents/skills/verify-dvns-integrated-sources/scripts/verify.mjs drive thematic-hubs`. Every route has one visible H1 and at least one `/dati/<id>` link.
- **Keep hierarchy clear.** Main pages expose no more than three concise
  previews. The four hubs are expansion pages for the complete thematic paths
  and technical register, not long previews embedded in the main pages.
- **Check total coverage.** The union of unique detail hrefs across the four hubs, the participation preview and `/spese/sanita` contains all 84 dataset IDs.
- **Proof.** Retain one screenshot per hub and `state.json`.

## Gotchas

- A dataset must have one canonical detail route even if several pages link to it.
- Hub copy must not rename signals or missing documents as proven waste.
- Mobile submenus need a separate browser pass after navigation changes.
