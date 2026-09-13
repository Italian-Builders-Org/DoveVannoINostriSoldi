# Commissione europea DG TAXUD: VAT gap Italia (Report 2025)

Slice ufficiale del foglio **IT** delle *Tables of Country Chapters* allegate a
*VAT gap in Europe — Report 2025*. Espone fonte, API e MCP; **nessuna pagina UI**
in questa integrazione (la UI arriva con l’ultima PR dell’epic #387).

## Source lock

- titolare: Commissione europea, DG TAXUD;
- [landing VAT gap](https://taxation-customs.ec.europa.eu/taxation/vat/fight-against-vat-fraud/vat-gap_en);
- [XLSX ufficiale](https://taxation-customs.ec.europa.eu/document/download/c4ce2e13-0a9b-4a26-8f49-7238a8b4dc7a_en)
  (`VAT-GAP-2025-Tables-of-Country-Chapters.xlsx`);
- byte: **102793**;
- SHA-256: `7662fdd6da02d5acca385cca5f1ed5a5fbad3655105f8f0f490d433e472c75fa`;
- foglio: `IT` → `xl/worksheets/sheet12.xml`;
- periodo: 2019–2023 e **2024 stima rapida** (`2024 (e)`);
- geografia: Italia soltanto; nessuna media UE pubblicata in questa slice;
- pubblicazione report: 2025-12-08; acquisizione/controllo: 2026-09-13;
- licenza XLSX: `not-declared` (il file non dichiara termini di riuso). Evidenza
  documentale PDF citata come CC BY 4.0 su DG TAXUD / Publications Office,
  senza inventare un license id per l’XLSX.

La specifica versionata è
`scripts/etl/specs/eu-vat-gap-italy.source.json`. La fixture offline è
`tests/fixtures/eu-vat-gap/VAT-GAP-2025-Tables-of-Country-Chapters.xlsx`.

## Campi pubblicati

Per ogni anno 2019–2024:

| Campo | Origine | Unità pubblicata |
| --- | --- | --- |
| `vttlCents` | `VTTL (EUR mln)` | centesimi di euro (milioni × 1e8) |
| `vatRevenueCents` | `VAT revenue (EUR mln)` | centesimi di euro |
| `complianceGapCents` | `VAT compliance gap (EUR mln)` | centesimi di euro |
| `complianceGapShareMillionths` | `VAT compliance gap (percent of VTTL)` | milionesimi di unità (0.193 → 193000) |
| `estimateKind` | etichetta anno | `standard` oppure `rapid-estimate` (2024) |
| `vttlComposition[]` | righe o/w VTTL | centesimi; 2024 = `unavailable` (`X`) |

Inoltre `gapChangeSince2019` (F12, solo 2023): `-4.2pp` → `-42` decimi di punto
percentuale.

Riconciliazione fail-closed: `VTTL − VAT revenue = compliance gap` esatta.
La somma delle componenti o/w può scostarsi di ±1 milione di euro (arrotondamento
fonte).

## Superfici

- API: `/api/tributi/vat-gap` e `/api/tributi/vat-gap?anno=2023`
- MCP: `query_dataset` con `dataset: "eu_vat_gap_italy"` e `year` opzionale
- datasetId / sourceId: `eu-vat-gap-italy`

## Fuori perimetro

- fogli di altri paesi e medie UE;
- blocco policy gap / C-efficiency della stessa tavola (fuori da questa PR);
- MEF dichiarazioni IVA, tax gap MEF PDF, ISTAT economia non osservata;
- pagina UI «Evasione».

## Comandi

```bash
PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/eu_vat_gap_italy_snapshot.py --check
PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/eu_vat_gap_italy_snapshot.py --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_eu_vat_gap_italy_snapshot.py'
node --experimental-strip-types --test tests/eu-vat-gap-italy.test.mjs tests/eu-vat-gap-italy-route.test.mjs
```
