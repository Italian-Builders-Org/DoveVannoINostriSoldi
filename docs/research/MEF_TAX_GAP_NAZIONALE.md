# MEF tax gap nazionale (Relazione evasione 2025)

## Scope

Typed snapshot `mef-tax-gap-nazionale` from the official PDF
*Relazione sull'economia non osservata e sull'evasione fiscale e contributiva
2025* (MEF — Commissione ex art. 10-bis.1 L. 196/2009).

This slice publishes **only** national tables:

- PDF page index **8** — Tabella I.1 (gap in milioni di euro)
- PDF page index **9** — Tabella I.2 (propensione al gap, percentuali)

No regional/ripartition tables, no UI page. Surface: source catalog + HTTP API +
MCP. Closes issue #474; refs epic #387.

## Source lock

| Field | Value |
| --- | --- |
| URL | https://www.mef.gov.it/export/sites/MEF/documenti-pubblicazioni/rapporti-relazioni/documenti/Relazione-evasione-fiscale-e-contributiva-2025_2310_ore1230.pdf |
| Bytes | 3840500 |
| SHA-256 | `6d45f5de74f65dbd6a6df1eb61cdc5102641978ddfb58bc34c12cff4ef1bd4ef` |
| File version (filename) | 2025-10-23 |
| Publication date | Not independently verified (`null`) |
| Acquired / checked | 2026-09-13 |
| License | `not-declared` |

Extraction uses the PDF text layer (`pypdf`), never OCR. Page text hashes are
pinned in the source lock.

## Units

- Money: source millions of euro → **euro-cents** (`× 100_000_000`)
- Propensione: one decimal percent → **tenths of a percentage point** (`16,9%` → `169`)
- Range rows keep `min`/`max`; point rows keep a single `value`
- Contribution rows appear only in Tab. I.1: propensione is `absent`, never invented

## Out of scope

- VAT compliance gap DG TAXUD
- ISTAT economia non osservata
- INL vigilance rates
- Accertamenti / recuperi AdE–GdF
- Regional or municipal gap estimates

## Edition boundary

This is the initial 2025 report, not the subsequent MEF update for 2019–2023.
The [official update](https://www.mef.gov.it/export/sites/MEF/documenti-pubblicazioni/rapporti-relazioni/documenti/Relazione-evasione-fiscale-e-contributiva-2025_Aggiornamento_11_12.pdf)
revises earlier estimates too; it must be acquired as a separate reviewed edition,
never silently spliced into this series. The report records Commission approval
on 13 October 2025; the locked filename identifies its 23 October version.

The generator verifies PDF bytes and text hashes before writing any output.
A changed input leaves the previous source lock, data and metadata untouched.
Runtime validates every PDF reference, including the two table titles.
