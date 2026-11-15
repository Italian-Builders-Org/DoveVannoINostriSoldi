# Correzioni encoding e digest — 8 novembre 2026

Base PR #838 `becea0e586550dcb222f795fc1ec7afef4823c9e`; base corrente
`origin/main` riconfermata con fetch: `1d02f4b31385bfec95b2ef9b90c5a8e1c6688929`.
Verifiche eseguite localmente sopra quella head. Il collaudo Supabase
usa esclusivamente letture sul DB e login dell'identità tecnica Storage.
Checklist, log e patch in `artifacts/supabase-review-fixes/` del worktree.

## Comportamento e riproduzione

Il controllo `test_etl_text_encoding_contract.py` falliva sulle dieci chiamate
Path indicate dalla review. Le chiamate ora dichiarano `encoding="utf-8"`:
credenziali locali, documenti di restore e fixture non dipendono dalla codifica
predefinita della macchina. Il test esistente verifica il vincolo sull'intero
perimetro ETL senza richiedere una suite ETL completa.

La build filesystem precedente includeva il manifest dei digest nei trace MCP
e operatore. Il nuovo test dei quattro profili corpus/archivio è stato eseguito
prima del fix e falliva sul profilo filesystem. Il lettore degli archivi importa
ora il lettore SQL solo quando viene chiamato. Poiché Next traccia anche gli
import dinamici, la configurazione esclude il digest quando il corpus è su file,
anche con archivio Storage. Nel profilo corpus SQL non è escluso: la validazione
dei chunk resta invariata. Come documentato per i profili, cambiare backend
richiede una nuova build.

## Verifiche

Runtime Node 22.23.2 e Python 3.12.8 del virtualenv del worktree.
Per i comandi Node usare il binario Node 22 e aggiungere `.venv/bin` a PATH
per le fixture Python lanciate dai test Node.

| Controllo | Esito |
| --- | --- |
| Contratto encoding prima/dopo | FAIL riprodotto / PASS, 2 test |
| ETL Supabase mirati offline | PASS, 31 test |
| Test regressione profili digest prima/dopo | FAIL riprodotto / PASS |
| Test Node correlati offline | PASS, 54 test |
| `npm run build`, profilo filesystem | PASS, incluso TypeScript e controllo trace |
| Scansione `.next/**/*.nft.json` | PASS, 279 manifest, nessuno contiene il digest |
| Smoke HTTP su produzione locale filesystem | PASS, quattro risposte 200 e contratto MCP da 30 POST |
| Chiusura server dello smoke | PASS |
| `git diff --check` | PASS |
| `npm run ci:static` e `npm run ci:action-pins` | PASS |
| `npm test`, offline | PASS, 2.555 test |
| Snapshot offline | PASS, 120 controlli, nessuna modifica durante la validazione |
| Build e test reali Supabase | PASS, dettagli sotto |
| Nuova build filesystem e parità rollback | PASS, 23 richieste confrontate |
| Produzione browser main (incluso Lighthouse) | PASS |
| Produzione browser core (inclusi tema scuro e documenti) | PASS |
| Suite ETL completa e test di carico calibrato sul traffico reale | NOT RUN |

Comandi dalla radice del worktree:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p test_etl_text_encoding_contract.py
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_supabase_*.py'
node --experimental-strip-types --import ./scripts/ci/node-test-setup.mjs --test tests/runtime-traces.test.mjs tests/next-config.test.mjs tests/integrated-supabase-reader.test.mjs tests/supabase-archive-session.test.mjs tests/anac-operator-history.test.mjs tests/anac-operator-history-reader.test.mjs tests/medical-device-spending-index.test.mjs tests/medical-device-route.test.mjs tests/integrated-source-public-view.test.mjs
npm run build
.venv/bin/python artifacts/supabase-review-fixes/http-smoke.py
git diff --check
```

Il primo comando Node aveva usato Python 3.9 dal PATH di sistema e falliva
durante la costruzione della fixture ANAC. La ripetizione usa il virtualenv
Python 3.12.8 ed è verde; entrambi i log sono conservati. Il primo comando
aveva anche un nome di file test medico inesatto: il giro finale usa i file
esistenti riportati sopra.

Lo smoke avvia e termina un server proprio su 127.0.0.1:43291, con guard
offline. Verifica home, operatore op-00000001, dispositivi e dataset
consip-winners-2024 (limit=1); esegue `scripts/mcp_http_smoke.mjs --mode contract`.
Log `http-smoke.log`, `next-smoke.log`; runner ripetibile `http-smoke.py`.
La scansione completa dei trace è registrata in `trace-filesystem.json`.
I test isolati verificano i quattro profili di configurazione e il digest SQL.

## Collaudo aggiuntivo del profilo Supabase e del rollback

Le env originali sono lette in memoria dal launcher `with-supabase.py`, senza
copiarle nel worktree o nei log. La chiave amministrativa Storage non viene
passata ai processi runtime. La URL SQL disponibile usa `postgres`: i test
funzionali non attestano quindi il login con la password del ruolo dedicato.
Tutte le transazioni del reader sono read-only. Nessun servizio condiviso
è stato fermato e nessuna password o policy è stata cambiata.

La build con entrambi i backend Supabase passa, incluso il gate trace:
276 manifest applicativi, nessun payload escluso rimasto nei pacchetti,
digest conservato in 43 trace. API corpus e dispositivi, MCP sui due dataset,
richieste concorrenti (sei identiche e sei con offset diversi), errori 400/404,
pagine dataset, operatore e dispositivo passano. Flussi browser dispositivi
a 390/768/1280 px e corpus/operatore a 390/1280 px passano con tastiera, focus,
overflow e controlli degli errori console. Si usano gli strumenti browser
del repository; il plugin Browser/skill browser non è disponibile.

Sei scenari, con server nuovi e PID propri su porta 43292, passano:

- DB irraggiungibile e password SQL volutamente errata: API corpus 503
  no-store, MCP segnala errore, pagine e API che dipendono dall'archivio falliscono.
- Auth indisponibile, Storage indisponibile e 401 Storage persistente:
  corpus SQL continua a funzionare; API/pagine archivio falliscono con 500,
  MCP segnala errore, senza fallback ai file. Il 500 delle API non ha cache pubblica.
- Primo 401 Storage seguito da servizio reale: nuovo login e lettura riuscita.

I guasti di rete sono iniettati soltanto nel processo Node del test con
`faults.mjs`; i contatori nei log del server provano che il fault è stato
esercitato. Non sono prove di interruzione effettiva dei servizi cloud.
La prova reale Auth/Storage con 12 lettori prima/dopo avanzamento simulato
dell'orologio oltre un'ora ottiene 206 e digest identico. Un oggetto esistente
fuori perimetro è negato (400); la lista del bucket è vuota.

Il rollback è una nuova build filesystem senza env cloud: PASS. Sono
ripristinati i payload locali nei trace (31 trace corpus e due archivi), mentre
il digest SQL è assente in tutti i 279 manifest. Il confronto delle 23
richieste conserva status, dati/provenance e testo delle tre pagine.
Il messaggio MCP del corpus differisce nei byte del JSON testuale incorporato:
JSONB riordina le proprietà. L'intero envelope parsato coincide dopo aver
canonicalizzato quel JSON. Le risposte MCP dispositivi coincidono anche nel
digest wire. Il confronto ordina inoltre le richieste concorrenti per scenario,
non per ordine di completamento. L'esito finale è in `rollback-parity-final.json`.

La prima fixture MCP del nuovo smoke usava nomi di parametri non ammessi;
è stata corretta secondo lo schema esistente, senza cambiare il prodotto.
Il primo confronto rollback confrontava erroneamente ordine di completamento
e JSON incorporato come stringa opaca. `mcp-json-parity.mjs` riproduce entrambi
i digest wire originari e verifica tutti i campi dei due envelope normalizzati;
`rollback-compare.py` confronta poi i risultati registrati. I fallimenti iniziali
restano nei log; nessuna modifica applicativa necessaria.

Comandi aggiuntivi (PATH Node 22 e virtualenv come sopra):

```sh
npm run ci:static
npm run ci:action-pins
npm test
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci npm run test:snapshots
.venv/bin/python artifacts/supabase-review-fixes/with-supabase.py npm run build
.venv/bin/python artifacts/supabase-review-fixes/with-supabase.py .venv/bin/python artifacts/supabase-review-fixes/profile-run.py healthy
# Ripetere con db-down, db-bad-password, auth-down, storage-down, storage-401 e storage-401-once.
node --experimental-strip-types artifacts/supabase-production/live-renewal.mjs
npm run build
DVNS_TEST_PROFILE=filesystem .venv/bin/python artifacts/supabase-review-fixes/profile-run.py healthy
.venv/bin/python artifacts/supabase-review-fixes/with-supabase.py node --experimental-strip-types artifacts/supabase-review-fixes/mcp-json-parity.mjs
.venv/bin/python artifacts/supabase-review-fixes/rollback-compare.py
NEXT_PORT=43294 PRODUCTION_GATES=main npm run test:production
NEXT_PORT=43295 PRODUCTION_GATES=core npm run test:production
```

Per ripetere il confronto canonico, salvare l'output `mcp-json-parity.mjs` in
`mcp-json-parity-final.log`. La cattura HTTP e il confronto sono ora separati:
`profile-http.mjs` verifica ogni risposta, `rollback-compare.py` confronta i
risultati senza dipendere dall'ordine di completamento.
I gate main e core sono terminati con exit 0 e il messaggio finale di successo.
La seconda esecuzione di `ci:static`, dopo la documentazione, passa.
`verified-code.json` registra gli hash dei nove file di codice/test esatti
validati sopra la base prima del push.
Gli artifact includono build/log, `trace-supabase.json`, `trace-rollback.json`,
`supabase-healthy.json`, `filesystem-healthy.json`, `profile-*.log`,
`next-supabase-*.log`, `browser-supabase/`, `browser-supabase-extra/` e
`storage-live.log`. Tutti i server del collaudo sono terminati dal runner.

## Permessi effettivi e limiti della verifica

I cataloghi reali del progetto condiviso confermano:

- `dvns_vercel_preview`: login abilitato, nessuna membership, nessun superuser,
  BYPASSRLS, creazione ruoli/database/oggetti. Nessun privilegio su sequenze.
- Lettura sulle sole cinque tabelle applicative necessarie:
  `dvns_corpus.rows`, `dvns_metadata.datasets/chunks/imports`,
  `dvns_snapshots.blobs`. Nessun privilegio di scrittura a livello tabella
  o colonna; nessuna lettura di dati applicativi estranei a DVNS.
- USAGE su `public` senza CREATE e senza accesso a tabelle applicative.
  L'unica funzione SECURITY DEFINER accessibile censita è `rls_auto_enable`,
  che restituisce `event_trigger`, non una normale funzione dati.
  TEMP sul database resta consentito; non autorizza scritture alle tabelle DVNS.
- Bucket `dvns-snapshots` privato, una sola policy SELECT limitata all'UUID
  tecnico, al bucket, alle 220 chiavi di release e alle operazioni download.
  Le prove negative Storage reali passano.

La credenziale locale `postgres` non può eseguire SET ROLE sul lettore dedicato.
Non sono stati ampliati i grant per aggirarlo. Le variabili di progetto della
preview Vercel non rendono disponibile una URL dedicata, quindi il login SQL
con quella password resta NOT RUN. La CLI conferma Node 22.x sulla preview;
il progetto Vercel di produzione non è accessibile dall'account collegato.
I JSON `permissions-summary.json`, `permissions-column.json` e
`permissions-extra.json` conservano le evidenze senza segreti.

Per l'attivazione restano destinazione approvata, configurazione con URL SQL
dedicata, Node Vercel di produzione, responsabilità import/backup/restore e
verifica dello switch sul deployment reale. Il login del ruolo dedicato si
verifica live durante l'attivazione, con una lettura che raggiunga SQL. Il rollback provato qui è locale,
non un cambio di alias Vercel. Nessuna cache aggiunta: monitorare traffico reale,
query, latenza ed errori. Nessun test di carico calibrato è dichiarato eseguito.
