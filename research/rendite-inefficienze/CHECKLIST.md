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

## Esiti locali (Node v24.19.0)

- PASS: 27 test mirati (`rendite-catalogo`, `studies`, `site-navigation`, `public-discovery`) con setup offline; verifica delle 79 corrispondenze tra catalogo e stime di ricerca e delle sette proposte.
- PASS: detector UI del nuovo percorso (nessun finding) e `git diff --check`.
- FAIL/ambiente: `ci:static` si ferma sul lint (ESLint del sistema, dipendenze locali non installate); typecheck `next: not found`.
- FAIL/ambiente: `ci:action-pins` manca `yaml`; `npm test` non completa la suite per dipendenze mancanti; build manca `zod`; production manca `next`.
- NOT COMPLETED: snapshot con guard offline interrotto dopo 45 secondi; processo della run terminato senza alterare i gate.
- NOT RUN: browser mobile/desktop, tastiera, overflow e console (nessun build/server disponibile); ETL non pertinente.
- Revisione read-only: corrette etichette dei link al dossier (non testo originale) e aggiunta guardia contro importi monetari anche nei campi testuali pubblici.
- `origin/main` aggiornato prima della consegna e invariato rispetto alla base; nessun merge/deploy. Bozza non pronta al merge finché mancano verifiche editoriali e full profile verde.
