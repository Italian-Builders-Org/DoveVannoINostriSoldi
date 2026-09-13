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
| Publication | 2025-10-23 |
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
