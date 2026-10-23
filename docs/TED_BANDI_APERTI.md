# Bandi TED aperti con committente in Italia

Superficie `/appalti/bandi-aperti` (issue #364): avvisi di **gara/consultazione** con **scadenza presentazione offerte** pubblicata da TED e almeno un committente `buyer-country=ITA`.

## Fonte e acquisizione

- [Search API TED](https://api.ted.europa.eu/v3/notices/search), stessa base di `/appalti/ted`.
- Query vincolata in `scripts/etl/specs/ted-open-notices.source.json` (acquisizione **2026-10-23**).
- Campo scadenza: `deadline-receipt-tender-date-lot` (massimo tra i lotti). Senza scadenza la riga **non** entra.
- Natura contratto: `contract-nature-main-proc` → Lavori / Servizi / Forniture.

## MePA / Consip

Metadati del file `bandiegare2026.csv` su [dati.consip.it](https://dati.consip.it/dataset/dataset-bandi-e-gare), pagina `/appalti/mepa`. Non sostituisce la bacheca live di acquistinretepa.it né gli ordini storici Consip.

## Dataset integrati

- `ted-bandi-aperti-italia-2026-10`
- `consip-bandi-gare-programma-2026`
