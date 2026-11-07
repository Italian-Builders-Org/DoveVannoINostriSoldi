# Preview Supabase con sessioni rinnovabili

Data della verifica 7 novembre 2026. Base ufficiale
`1d02f4b31385bfec95b2ef9b90c5a8e1c6688929`, codice verificato
`1310345e`, copia privata `a91ca1fb`. La copia privata conserva lo stesso
codice applicativo ed esclude i workflow upstream. Il requisito Node è ora
`22.x`, coerente con `.nvmrc`. Le credenziali effettive restano nei file
privati originali e nelle variabili server della preview.

## Comportamento atteso

Lettura del corpus da SQL e dei blocchi ANAC/dispositivi da Storage privato
con permessi limitati, verifica dei digest e profilo build alleggerito.
L'access token viene ottenuto mediante l'identità tecnica e rinnovato un
minuto prima della scadenza. Il login è condiviso dalle richieste concorrenti
di un processo. Auth ha timeout di 10 secondi e limite di 64 KiB. Gli errori
sono redatti e hanno un cooldown di 5 secondi. Storage consente un retry su
401. I token di refresh ricevuti da Auth vengono scartati.

I test isolati coprono scadenza, concorrenza, token rifiutato dopo un rinnovo
concorrente, risposta Auth malformata, fallimento temporaneo e abort di un
singolo lettore. Gli adapter mantengono limiti, filtri, provenance e hash.

## Prove live ripetibili

[Deployment protetto verificato](https://dvns-supabase-preview-sknbt4l1p-future-proof-society.vercel.app)
nel team Future Proof Society, Node 22.x, stato READY, build 5m40s.
Le richieste sono effettuate con `vercel curl` usando l'autenticazione
dell'operatore. La protezione degli URL resta attiva.

| Percorso | Prima richiesta MISS al primo byte | Richieste HIT successive |
| --- | --- | --- |
| Scheda operatore ANAC op-00000250, anno 2025 | 5,74 s | 0,44–0,47 s |
| Aggregati dispositivi, anno 2020, classificazione, limite 5 | 2,48 s | 0,31–0,40 s |
| Dispositivo tipo 1, numero 1175175, limite 2 | 1,33 s | 0,25–0,40 s |

Nove risposte HTTP 200. Dopo oltre un'ora dalle prime misure, un'ulteriore
query non in cache, aggregati 2019 con limite 8, ha restituito 200 MISS
in 6,67 s senza aggiornamento manuale dei token. La prova è registrata in
`after-one-hour-2019.csv` e nei relativi body/header. I JSON dei dispositivi hanno i digest canonici del
riferimento filesystem. Anche il testo visibile della scheda ANAC è identico
al riferimento, con digest
`30af2a7db35a9a3b04538f4399c66c2cf5533cf43892c66772d0a7fe51713793`.
La parità del testo è verificata estraendo il contenuto di main dall'HTML.

La richiesta di aggregati anno 2021, classificazione, limite 7 ha riprodotto
HTTP 500 sulla vecchia preview con token statico scaduto e HTTP 200 sulla
preview aggiornata. Il MISS sulla nuova preview ha impiegato 10,40 s al primo
byte. Il successivo HIT ha impiegato 1,16 s. La prima lettura resta un limite di latenza da valutare per il rilascio.
Queste misure sono campioni HTTP e non costituiscono un benchmark a macchina
isolata o una misura della CPU Fluid.

Un gruppo di richieste concorrenti controlla anno 2024 per ANAC, aggregati
2020 con limite 6 e dettaglio dispositivo con limite 3. Controllati anche
limite 101 con risposta 400, dispositivo assente con risposta 404 e corpus
Consip con risposta 200.

La prova Auth/Storage usa l'identità tecnica reale e 12 lettori concorrenti
per round. Dopo avanzamento simulato dell'orologio di oltre un'ora il
lettore ottiene una nuova sessione e rilegge gli stessi byte con risposta
Range 206 e digest identico. La fixture considera l'offset del file nel
contenitore Storage. Un oggetto esistente fuori perimetro viene negato con
400 e la lista del bucket restituisce un array vuoto.

Artifact locali in `artifacts/supabase-production/`.
`preview-metrics.csv` contiene gli esiti e i digest dei nove download.
`preview-boundaries.py` ripete le richieste concorrenti e i casi limite.
`live-renewal.mjs` e `storage-proof.json` ripetono la verifica di rinnovo
con le credenziali lette dal file privato originale.
`expired-preview-repro.csv` registra la riproduzione del difetto.
`anac-parity.mjs` ripete il confronto del testo HTML.
I comandi e gli artifact sono privi di valori di credenziali.

## Gate locali

Runtime locale Node 22.23.2 e Python 3.12.8, guard offline per suite Node,
ETL e snapshot. Comandi eseguiti dalla radice del worktree.

| Controllo | Esito |
| --- | --- |
| `npm run ci:static` | PASS |
| `npm run ci:action-pins` | PASS |
| `npm test` | PASS, 2.554 test |
| `DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_supabase_*.py'` | PASS, 31 test |
| `npm run test:snapshots` con guard offline e Python 3.12.8 | PASS, 120 controlli e worktree pulito |
| `npm run build` | PASS |
| `NEXT_PORT=43287 PRODUCTION_GATES=main/core npm run test:production`, due esecuzioni separate | PASS, entrambi i gruppi ufficiali, incluso Lighthouse |
| `git diff --check` | PASS |
| Suite ETL completa | NOT RUN |

La prima esecuzione snapshot aveva usato il virtualenv Python 3.9.6 ed è
stata interrotta dopo i primi errori di compatibilità. Il virtualenv del
worktree è stato ricreato con Python 3.12.8 e dipendenze dai lock con hash.
Nella seconda esecuzione tutti i 120 controlli sono passati, con 1.349,94 s
per la ricostruzione dell'indice dispositivi. Il wrapper ha rilevato le
modifiche documentali apportate durante il giro e ha correttamente
restituito exit 1. I log originali sono conservati.
La ripetizione `snapshots-final.log` ha verificato tutti i 120 controlli e il
worktree pulito, con 835,10 s per l'indice dispositivi.

L'esecuzione iniziale del profilo produzione all ha superato 421 scenari
prima di un timeout di navigazione Chromium su sanità, tema scuro, 1280 px,
con destinazione about:blank e senza errori pagina o HTTP. La chiusura di
Chromium ha anch'essa superato il timeout. Il caso ripetuto con browser e
server nuovi è passato tre volte in 0,877, 0,326 e 0,337 s senza modificare
codice o timeout. I due gruppi ufficiali main e core sono stati poi eseguiti
separatamente, ciascuno con server nuovo, e sono entrambi passati. La loro
unione copre lo stesso profilo completo usato dai due job CI.
`production.log` e la directory di errore
`artifacts/browser/core/conto-economico-ssn-1280px/` conservano il fallimento.
`production-main.log`, `production-core.log`, `sanita-repro-final.log`
e `sanita-dark-fresh.png` documentano la ripetizione riuscita. I report
Lighthouse sono in `.lighthouseci/`.



## Perimetro del rilascio

La PR conserva il profilo filesystem predefinito, i file sorgenti versionati
e il manifest dei digest. I fix OpenBDAP, testi di stato, precisione MOP e CSS
mobilità, insieme al test OpenBDAP, sono conservati nel branch separato
`codex/openbdap-map-fixes`.

La preview usa ancora il progetto condiviso `zvqhikeylxynsljwgosc`.
Destinazione dedicata o approvazione della destinazione, configurazione degli
endpoint, responsabilità operativa di import/backup e prova di restore
restano condizioni per l'attivazione. Le variabili server e il rollback sono
documentati in `docs/SUPABASE_CORPUS_IMPORT.md`. La verifica live di questa
revisione usa HTTP autenticato, mentre il gate di produzione locale verifica
il flusso browser previsto dal repository.
