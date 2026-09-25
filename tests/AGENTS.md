# Lavorare nei test

Queste istruzioni si applicano a `tests/`, inclusi `tests/etl/` e le fixture.
Per setup, mappa del dominio e gate finali valgono anche [AGENTS.md](../AGENTS.md)
e [CONTRIBUTING.md](../CONTRIBUTING.md#verifica-locale).

## Durante lo sviluppo

1. Applica la [strategia dei test](../AGENTS.md#strategia-dei-test): prima del
   codice, annota nella checklist della task gli errori plausibili e l'esito
   atteso. Scegli il flusso E2E pertinente; aggiungi verifiche isolate soltanto
   per rischi scoperti. Per un bug verifica che il test fallisca sulla versione
   difettosa e passi con la correzione. Usa fixture piccole durante lo sviluppo.
2. Esegui il file Node mirato con il guard offline:
   `DVNS_OFFLINE_GUARD=1 node --experimental-strip-types --import ./scripts/ci/node-offline-guard.mjs --test tests/NOME.test.mjs`.
   Per un caso aggiungi `--test-name-pattern='nome del caso'` prima del file.
3. Per ETL usa il Python del virtualenv:
   `DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_NOME.py'`.
   Per un caso aggiungi `-k 'nome_del_caso'`; controlla che il filtro abbia
   eseguito almeno un test.
4. Dopo ogni modifica, allarga la selezione ai contratti dei producer, delle
   route e degli artifact effettivamente toccati. Registra comando, esito e
   durata quando un test è lento; per il file ETL aggiungi `--durations 20` al
   comando. Distingui il tempo del test da setup, build e attese intenzionali.

## Qualità e costo

- Verifica comportamento e invarianti osservabili con dati rappresentativi;
  includi i casi di errore, i limiti e la provenance quando pertinenti.
- Mantieni l'isolamento: fixture locali, cleanup degli artifact temporanei,
  nessuna dipendenza dalla rete o dall'ordine dei test. Usa i guard offline per
  ETL, snapshot e suite Node deterministiche.
- Riusa fixture e helper solo quando rendono più chiaro il contratto. Evita
  setup costoso ripetuto per ogni caso; non condividere stato mutabile fra test.
- Per valutare un test, chiediti quale difetto osservabile lo farebbe fallire.
  Assert su dettagli interni, copie della stessa formula e mock che impongono
  la risposta attesa richiedono revisione: verifica il risultato al confine
  pubblico. Prima di eliminare una duplicazione, indica nella PR il rischio,
  lo scenario e l'asserzione che restano a coprirlo; esegui quella verifica.
- Se un test rallenta, misura prima la fase dominante e ottimizza letture,
  indici o preparazione duplicati. Conserva la stessa copertura semantica,
  cardinalità e controlli fail-closed; documenta il confronto sullo stesso
  runtime e sugli stessi dati.
- I test browser devono mantenere controlli su viewport mobile e desktop,
  tastiera, overflow ed errori console quando il flusso modificato li richiede.

## Prima di una PR

Esegui i gate applicabili del profilo full di
[Verifica locale](../CONTRIBUTING.md#verifica-locale) dopo l'ultima modifica,
rispettando la politica ETL di [AGENTS.md](../AGENTS.md). Riporta ogni gate come
`PASS`, `FAIL` o `NOT RUN` e spiega ogni limite ambientale. Un test mirato verde
non sostituisce il profilo full.
