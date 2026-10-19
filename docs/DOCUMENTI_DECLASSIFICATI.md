# Documenti declassificati (pilota)

Dataset `documenti-declassificati`: schede curate di atti e fondi ufficiali
italiani declassificati o desecretati, con metadati, punti chiave e link alla
fonte. Alimenta `/documenti`, `/documenti/[id]` e `/api/documenti`.

## Perimetro

| Voce | Valore |
| --- | --- |
| Periodo di riferimento | Pilota 1970-2024 (Commissioni Moro / Terrorismo e stragi + quadro normativo) |
| Documenti pubblicati | 10 schede verificate |
| Titolare | raccolta curata DoveVannoINostriSoldi (`authority: secondary`) |
| Licenza | `not-declared`: fatto, attribuzione, riassunto e link; niente PDF hostati in v1 |
| Aggiornamento | manuale |
| Issue | [#796](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/796) |

## Che cosa il dato NON misura

1. Non e un archivio ufficiale completo (ACS, Senato, Camera restano autoritativi).
2. Declassificare ≠ pubblicare online: lo stato di accesso e dichiarato per scheda.
3. I riassunti non sostituiscono il documento originale.
4. Non misura colpevolezza o «verita» sulle stragi.
5. `soldi` e assente su ogni scheda del pilota.

## Quadro normativo (contesto)

- Legge 124/2007 art. 42: declassifica automatica ordinaria (5 + 5 anni, salvo proroghe).
- Art. 39: segreto di Stato (istanza dopo 15 anni; limite ordinario 30).
- d.lgs. 42/2004 art. 122: consultabilita archivistica (40/50/70 anni).
- FOIA italiano (d.lgs. 97/2016): accesso civico generalizzato, distinto dalla declassifica.

## Pipeline

1. Input: `data/documenti-declassificati/catalogo-verificato.json` (hash nello spec).
2. ETL: `python3 scripts/etl/documenti_declassificati_snapshot.py --check|--write`.
3. Snapshot: `src/data/generated/documenti-declassificati.json`.
4. Contratto: `src/lib/data/documenti-declassificati-contract.ts`.
5. Adapter: `src/lib/documenti-declassificati.ts` (server-only).

| Path | Ruolo |
| --- | --- |
| `data/documenti-declassificati/catalogo-verificato.json` | input verificato, bloccato per byte e sha256 |
| `scripts/etl/specs/documenti-declassificati.source.json` | source lock ed enum ammessi |
| `scripts/etl/documenti_declassificati_snapshot.py` | proiezione fail-closed |
| `src/data/generated/documenti-declassificati.json` | snapshot pubblicato |
| `src/lib/data/documenti-declassificati-contract.ts` | Zod `.strict()` |
| `src/app/documenti/` | hub e scheda |
| `src/app/api/documenti/route.ts` | lista filtrata |

## Comandi

```bash
python3 scripts/etl/documenti_declassificati_snapshot.py --check
python3 scripts/etl/documenti_declassificati_snapshot.py --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_documenti_declassificati_snapshot.py'
node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs --test tests/documenti-declassificati-contract.test.mjs tests/documenti-declassificati-page.test.mjs
```

## Fuori v1

Pin PDF, OCR, elenchi ACS completi, FOIA live, reading room full-text.
