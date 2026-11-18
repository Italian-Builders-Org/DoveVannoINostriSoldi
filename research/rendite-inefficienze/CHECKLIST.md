# Checklist — catalogo rendite e inefficienze

- Base: `3687b47d168f1d2609a5df0dd597a6d72334eaca`.
- Obiettivo: proporre una pagina Studi con tutti i 79 casi della lista del contributore, in sette gruppi, e sette proposte di riforma. Nessuna cifra non verificata nella pagina pubblica.
- PR concorrenti controllate: nessuna delle PR aperte elencate riguarda questo catalogo (737, 735, 726, 705, 697, 694).
- Proposta collegata: https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/738.
- Comportamento atteso: tutti i casi visibili e marcati da verificare; nessun totale, nessun costo mancante trattato come zero; separazione tra proposta del contributore e posizione editoriale DVNS.
- Rischi: omissioni, doppi conteggi, confusione tra ricavi/costi e inefficienze, tra trasferimenti e perdita di benessere, tra costo lordo e risparmio netto; accessibilità/overflow delle tabelle.
- Controlli previsti: integrità del catalogo, integrazione pagina/indice, test studi, gate statici, test Node, snapshot, build e production/browser se dipendenze disponibili, diff --check.
- Blocco setup: `npm ci --ignore-scripts` fallisce con EALLOWREMOTE per xlsx da cdn.sheetjs.com; non cambiare la policy né bypassarla. Build/browser/typecheck richiedono dipendenze installabili.
- ETL: NOT RUN (nessuna modifica ETL).
- Non autorizzati: merge, deploy, approvazione preview Vercel.

## Esiti locali (arricchimento fonti, 2026-11-18)

- PASS: test mirati `rendite-catalogo`, `studies`, `public-discovery` (15/15).
- PASS: catalogo con fonti ufficiali su 79 casi e 7 proposte; evidence osservata su `taxi`, `balneari`, `aci-pra`, `cnel` (senza stime € inventate).
- PASS: 65 URL di catalogo controllate via curl — 62 HTTP 2xx/3xx; 403 su ART, CONAI, COVIP (documentati); Senato art.99 risponde 202/WAF.
- PASS: snapshot locali in `research/rendite-inefficienze/sources/` (47 file in manifest, PDF AGCM 22/2024 incluso).
- PASS: dicitura «bozza» rimossa da pagina Studi, indice, README/CHECKLIST e test del catalogo.
- PASS: anteprima locale `http://127.0.0.1:3020/studi/rendite-inefficienze` senza «bozza», con «Fonti di partenza» e blocchi evidence.
- ETL: NOT RUN (nessuna modifica ETL).
- Non autorizzati: merge, deploy, push (salvo richiesta esplicita).
