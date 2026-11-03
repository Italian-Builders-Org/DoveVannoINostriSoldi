# Import DVNS in Supabase

## Stato verificato prima della ripresa programmata

- Base dati: c3fa7372b1d3883a95f89d1ef4d3d0d4bc4bfd53, origine main invariata all'ultimo fetch.
- Catalogo: 135 dataset. Snapshot JSON: 595/595 riletti con confronto esatto dei valori.
- Inventario: 10.022 file, 2.172.701.189 byte logici; tutti associati a ricevute Storage.
- Recupero completo da Storage: PASS, 10.022/10.022 file con byte e SHA-256 identici; bucket privato. 1.008 oggetti, 2.221.325.784 byte fisici inclusi oggetti intermedi conservati.
- Stato corrente DB: scrivibile, 82.136.211 byte. Righe corpus materializzate: 0; ricevute dataset SQL: 0, dopo la pulizia per spazio. Non confondere gli 8.047.880 record attesi con record già presenti.
- Da completare: resize al target autorizzato di 24 GB dopo il cooldown e import integrale 113 dataset / 8.047.880 righe. Seguito attivo in questa chat, id `completa-import-dvns-su-supabase`, senza notifiche a stato invariato.
- Il sito e i suoi reader non sono stati cambiati. Nessuna PR aperta, nessun push, merge o deploy.

- Obiettivo: catalogare il corpus e predisporre import fedele e privato nel progetto scelto `zvqhikeylxynsljwgosc` (fps26-preferiresti).
- Base: c3fa7372b1d3883a95f89d1ef4d3d0d4bc4bfd53; branch codex/supabase-data-import, worktree isolato.
- Stato iniziale: analysis/ preesistente nel checkout principale; conservata. Tabelle public del progetto già usate da altri servizi; nessuna modifica prevista.
- Atteso: catalogo completo 135 dataset, ricevute hashate; import pilota fedele, ripetibile e privato; nessun cambio reader pubblico.
- Errori da intercettare prima del codice: ricevuta alterata, chunk alterato/mancante, conteggio non riconciliato, celle 0/vuote/omesse trasformate, catalog-only importato come righe, duplicazione dopo retry.
- Controlli: test offline exporter su fixture prima implementazione; verifica SQL reale di conteggi, payload e privilegi dopo migrazione/import. Gate completi prima di eventuale PR; nessuna PR richiesta ora.
- Limite noto: connessione DATABASE_URL non disponibile; bulk COPY in attesa di configurazione locale, senza segreti in chat.

## Prima fase eseguita il 3 novembre 2026

- Applicata soltanto `20261103200007_dvns_corpus_private.sql` via Supabase MCP `apply_migration` al progetto scelto. Non usare `supabase db push` su questo progetto condiviso: le migrazioni assistant/boards del repository hanno altre destinazioni.
- Creati dvns_metadata.snapshots/datasets/imports e dvns_corpus.rows. RLS attiva, nessun accesso anon/authenticated agli schemi; nessun grant API o policy pubblica. L'advisor segnala INFO “RLS enabled no policy”: deny-by-default intenzionale per tabelle private, https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .
- Catalogo importato: 135 dataset; somma expected_public_rows = 8.047.880. Copiati integralmente metadata e ricevute; non è un import del dettaglio di tutti i dataset.
- Pilota ade-cinque-per-mille-territori-2024: 22 righe, SHA-256 payload sorgente d7dfd21601637baaaec00f1a63ce406b2bbd16b67db5d8bb3b7410b93cbb3e8b. Due import consecutivi → 22 righe, una ricevuta. Confronto SQL bidirezionale di tutti i payload.
- Caso negativo remoto: modificata soltanto nella tabella temporanea attesa la cella Territorio vuota con __DVNS_CORRUPTION_TEST__. Import rifiutato con “DVNS payload reconciliation failed”; successivo SELECT conferma 22 righe e zero celle corrotte. Nessun dato esistente rimosso.
- Controlli locali: 6 test unittest PASS (inizialmente rossi per modulo mancante, poi implementato). Runtime disponibile Python 3.9.6, non Python 3.12 richiesto dalla CI: verifica su 3.12 ancora NOT RUN. Suite ETL completa NOT RUN; gate applicativi/build/browser NOT RUN (nessun cambio UI/runtime, nessuna PR aperta).
- Bootstrap limitato a 1.000 righe per dataset. La funzione di esportazione non è un importer bulk riprendibile e non va estesa a milioni di INSERT.
- Il pannello Connect mostra [YOUR-PASSWORD], non la password attuale. Preparata .env.local nel checkout principale con permessi 0600, esclusa da Git: progetto e URL valorizzati, DVNS_DATABASE_URL vuota. Nessun segreto copiato al worktree o pubblicato; nessuna password reimpostata. Connessione bulk resta da configurare.
- Il sito continua a leggere gli snapshot Git. Le tabelle di dominio, i raw non distribuiti, gli altri snapshot tipizzati, ledger completo e Storage non sono ancora migrati.

## Riproduzione bootstrap

Dalla radice di questo worktree:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p test_supabase_corpus_export.py
python3 scripts/etl/supabase_corpus_export.py --code-sha c3fa7372b1d3883a95f89d1ef4d3d0d4bc4bfd53 --out artifacts/supabase/catalog.sql
python3 scripts/etl/supabase_corpus_export.py --dataset ade-cinque-per-mille-territori-2024 --out artifacts/supabase/pilot.sql
```

Applicare la sola migrazione DVNS alla destinazione esatta, poi catalog.sql e pilot.sql via client SQL. Non eseguire gli altri file migration su questo progetto. Il codice non carica automaticamente .env.local. Rivedere SQL e destinazione prima di eseguirlo.

Artifact locali ripetibili: artifacts/supabase/catalog.sql, pilot.sql, test-export.log, verification.sql. Nessuna credenziale negli artifact.

Query di verifica:

```sql
select count(*), sum(expected_public_rows) from dvns_metadata.datasets;
select dataset_id, verified_rows, rows_sha256 from dvns_metadata.imports;
select count(*) from dvns_corpus.rows;
select has_schema_privilege('anon','dvns_metadata','USAGE'),
       has_schema_privilege('authenticated','dvns_corpus','USAGE');
```

## Bulk: comportamento atteso prima dell'implementazione

- Nuova richiesta utente: verificare la credenziale locale e proseguire l'import. Base invariata c3fa7372; modifiche bootstrap ancora non committate.
- Verificare connessione TLS e destinazione esatta senza loggare URI/password; riconciliare catalogo remoto prima di scrivere.
- Validare tutti i chunk in streaming contro proof e ricevute prima dell'import del dataset; nessun cambio di stato verificato per caricamenti incompleti.
- COPY client-side per blocchi in tabella temporanea; commit di ciascun blocco con confronto payload bidirezionale per retry e checkpoint atomico. Una sola sessione; niente carico parallelo sul progetto condiviso.
- Rischi testati prima del codice: chunk mancante/corrotto, conteggio/hash discordante, ripresa con ordinale stabile, valori vuoti/zero distinti, credenziali in errori, destinazione sbagliata. E2E DB: retry identico, interruzione dopo un blocco e ripresa, mismatch payload rigettato e rollback del blocco, receipt finale soltanto a conteggio esatto.
- Non rimuovere artifact Git né cambiare il reader del sito in questa fase.

## Connessione ripristinata e piano COPY

L'utente ha cambiato autonomamente la password nel pannello Supabase e ha autorizzato la ripresa. La nuova URI è salvata solo nel checkout principale, .env.local 0600, tramite input nascosto. TLS Session pooler: PASS; current_database/current_user postgres; dimensione iniziale DB 16.542.867 byte. Nessuna password nei log.
Preflight offline completo PASS: 113 dataset, 8.047.880 righe, 8.119 chunk, 5.821.380.080 byte decompressi. Gli 11 test offline PASS su Python 3.12.8.
COPY previsto: massimo 25 chunk per transazione, checkpoint atomici in tabella privata, confronto payload prima del commit; una sessione di import. Verifica finale con cursore server ordinato e hash JSON canonico di tutte le righe rilette; ricevuta finale solo dopo digest e conteggio esatti. Resume da checkpoint e rifiuto di contenuti divergenti.

## Correzione del piano di confronto

Il primo import completo si è fermato volontariamente dopo avere osservato un confronto batch attivo da 63 secondi, wait_event IO/BuffileRead. Il LEFT JOIN su payload JSONB larghi sceglieva un piano con spill su disco. Cancellata soltanto la query del nostro importer con pg_cancel_backend, con rollback atomico del blocco in corso. I checkpoint già committati sono rimasti validi. Log originale: artifacts/supabase/import-before-plan-fix.jsonl.
Il confronto ora usa lookup correlati sulla PK (snapshot_id,dataset_id,ordinal), mantenendo IS DISTINCT FROM per rilevare anche righe mancanti. Riavviato l'import con i 14 test offline verdi e riconciliazione finale invariata. Log ripresa: artifacts/supabase/import-all-resumed.jsonl. Nessuna cache, memoria funzione o dimensione compute è stata aumentata.

## Snapshot JSON tipizzati: comportamento prima del codice

Per coprire anche gli snapshot esterni al corpus, trasferire i documenti .json delle radici generate dichiarate dal registro, con gruppi di origine, path relativo, SHA codice, byte e SHA-256 del file. Schema privato separato dvns_snapshots: sono documenti dello snapshot, non ulteriori fatti da sommare al corpus. Preservare valori numerici esatti passando il testo JSON originale a PostgreSQL; verificare il contenuto riletto con parser Decimal su entrambi i lati, mantenendo ordine array, chiavi assenti/null, stringhe/numero distinti. I blob compressi e pack derivati non vengono ricopiati in JSONB: inventario esplicito dello stato separato.
Test prima implementazione: associazione corretta gruppi/path; JSON malformato o NaN rifiutato; numeri oltre precisione float preservati; celle zero/vuote/null/omesse distinte; nessuna selezione di file fuori dalle radici generate o link simbolici. Verifica DB file per file prima del commit; retry divergente rifiutato senza overwrite.

## Errore transitorio durante batch PNRR

Un INSERT nel batch da 25 chunk ha restituito DiskFull/SQLSTATE 53100. L'importer ha effettuato rollback e chiuso la sessione: rimanevano 59 dataset e 567.070 righe verificati. Misure: DB 770.927.763 byte; corpus rows 753.893.376 byte. Il pannello Infrastructure riportava circa 23% occupato, 1,77 GB su 8 GB (database 749,8 MB, WAL 896 MB, system 168 MB): non è dimostrato un esaurimento del disco persistente. Nessun resize o upgrade eseguito.
Dopo verifica dei log, un batch PNRR da 1.000 righe è riuscito. Ripresa dei soli dataset non verificati con batch da 5 chunk: PNRR ha caricato tutte le 291.398 righe, poi ha superato la rilettura/digest. Il batch predefinito è stato ridotto a 5; log artifacts/supabase/import-remaining.jsonl. La causa infrastrutturale specifica del 53100 non è stata isolata; non è stata nascosta come successo.

## Budget persistente durante il bulk

Il pannello ha poi mostrato un banner di spazio prossimo all'esaurimento; l'importer è stato fermato con SIGINT prima di fare altre scritture. La schermata aggiornata riportava 3,80 GB su 8 GB (database 2,1 GB, WAL 1,6 GB, system 153,2 MB), con cooldown resize residuo di circa 3h09m. Il banner e le metriche puntuali non erano coerenti: non dedurre dal banner un disco già pieno.
Prima della ripresa aggiungere un limite conservativo di 5 GiB per pg_database_size, controllato prima dei batch e capace di interrompere senza ricevuta finale. Questo è un budget del DB, non una misura del WAL o del filesystem: mantenere il margine e verificare il pannello. Nessun resize o modifica dei limiti della piattaforma.
E2E del limite: avviare un dataset già verificato con budget di 1 byte; atteso stop prima di COPY e dati/checkpoint invariati. La ripresa con budget normale deve rispettare i checkpoint e mantenere la verifica digest.

## Archiviazione integrale su Storage: comportamento prima del codice

Per preservare anche i 1.308 file compressi/binari senza materializzarli come fatti SQL, archiviare tutti i byte delle radici generate in bucket privato `dvns-snapshots`, indirizzati dal contenuto. La chiave server esistente è stata recuperata dal pannello e salvata, senza output del valore, in .env.storage.local nel checkout principale (0600, ignorata da Git). Nessuna chiave creata, nessun accesso pubblico o policy anon.
Per evitare limiti di upload e grandi buffer, ogni file è diviso in parti da massimo 4 MiB; manifest SQL con ordine, dimensioni e SHA-256 delle parti, SHA e dimensione dell'intero file. Rileggere ogni parte da Storage e verificarne hash/byte prima della ricevuta SQL del blob. Mai upsert o overwrite; in caso di chiave già presente verificare i byte. Bucket preesistente pubblico → errore, non modifica silenziosa dei permessi.
Test prima implementazione: confine/ordine delle parti, file vuoto, hash sorgente alterato prima dell'upload, download corrotto/troncato, errore HTTP non trattato come duplicato, redirect vietato per non inoltrare credenziali. E2E: upload/rilettura/retry di un piccolo artifact, anon negato, poi archiviazione completa con riconciliazione files↔blobs.
L'API Storage è stata verificata in sola lettura con chiave server: HTTP 200, nessun bucket esistente. Il metodo di upload non richiede la password PostgreSQL; SQL e catalogo restano gestiti dalla connessione PostgreSQL.

## Sola lettura e ripristino dello spazio condiviso

Il budget di 5 GiB del solo database non ha coperto la crescita del WAL: Supabase ha attivato default_transaction_read_only=on a DB 5.038.042.259 byte. Stato al blocco: 93 dataset / 1.691.106 righe verificati, 3.681.106 righe in checkpoint (di cui 1.990.000 BD/RDM incomplete). Entrambi gli importer si sono fermati senza ricevute false.
Per ripristinare spazio al progetto condiviso sono state esportate tutte le ricevute in artifacts/supabase/checkpoints-before-space-recovery.json; verificata l'assenza di FK verso le tre tabelle effimere. Poi, soltanto nella sessione di pulizia e senza disattivare globalmente la protezione della piattaforma, TRUNCATE di dvns_corpus.rows, dvns_metadata.chunks, dvns_metadata.imports. Tutti i byte originali sono ancora negli snapshot Git; questi risultati sono rigenerabili. Il catalogo di 135 dataset e le tabelle degli altri servizi sono stati preservati. Dimensione DB dopo la pulizia 17.509.523 byte.
La prova di 93 dataset resta negli artifact, NON nello stato corrente del DB: non dichiararla un import completato. Budget predefinito abbassato a 2 GiB e controllo read-only prima dei batch. Il bulk completo non riparte senza una nuova verifica di capacità (dati + WAL + temporanei), a cooldown concluso o su destinazione adeguata.
Fonte operativa: https://supabase.com/docs/guides/platform/database-size — sopra il 95% la piattaforma impone sola lettura; le metriche persistite possono restare obsolete in questo stato; espansioni disco limitate dal cooldown di quattro ore.

## Storage: quota connessioni e pacchetti

Con quattro upload concorrenti Storage ha restituito HTTP 429 “Too many connections issued to the database”. Modificato il client per riusare TLS per worker (test prima rosso, poi verde), parallelismo predefinito 1; credenziali mai inoltrate su redirect. Upload singoli ripresi con successo, ma il numero di richieste resta elevato.
Per ridurlo ulteriormente, impacchettare i file rimanenti in oggetti da 4 MiB. Ogni ricevuta file conserva le parti ordinate con key, offset, byte e SHA del segmento; ogni oggetto è indirizzato dal proprio SHA. I file già verificati con oggetti singoli restano validi (offset implicito zero). Nessun overwrite o cancellazione di oggetti preesistenti. Ricevuta file solo dopo verifica di tutti gli oggetti che lo contengono.
Test prima del codice: piccoli file condividono un oggetto; file oltre confine attraversano oggetti senza perdere byte; file vuoti ricostruibili; dati ricomposti con gli offset hanno hash uguale agli originali; fonte alterata rifiutata. Verifica E2E finale ricostruisce tutti i file dall'archivio con cache limitata a un oggetto e confronta byte/hash/ordinalità.

## Stato della capacità e autorizzazione

L'utente ha risposto “Sì, 24 GB quando disponibile”: autorizzato target 24 GB gp3, circa 2 USD/mese aggiuntivi rispetto agli 8 GB inclusi; nessun altro cambio piano/compute. Creato heartbeat locale di questa chat `completa-import-dvns-su-supabase`, controllo ogni 15 minuti, silenzioso a stato invariato, da disattivare a completamento. Le istruzioni richiamano worklog e guida, verificano il cooldown e vietano importer duplicati o modifiche agli altri servizi.
Alle 21:55 UTC del 3 novembre (22:55 Europe/Rome), Infrastructure riportava 12 GB già allocati dalla piattaforma, 2,92 GB usati, cooldown 3h42m59s: il target 24 GB non è ancora stato applicato. La verifica va ripetuta quando disponibile; non aggirare il blocco. I costi gp3 verificati nella documentazione ufficiale sono 0,125 USD/GB-mese oltre 8 GB inclusi.

## Controlli e artifact finali

PASS: 26 test offline mirati con Python 3.12.8 e guard rete; test inizialmente rossi prima di implementazione/correzioni; Black 25.1.0 sui soli nuovi file; git diff --check. PASS: prova live interruzione/ripresa, corruzione rigettata con rollback, limite capacità prima delle scritture, sessione read-only rigettata prima di COPY; upload/retry/accesso anonimo negato; recupero completo archivio e confronto JSON dei 595 documenti. Il corpus SQL completo resta NOT RUN dopo il resize; il tentativo sulla vecchia capacità è FAIL ed è stato ripulito come documentato.
NOT RUN: suite ETL completa (non richiesta da Lorenzo); ci:static, ci:action-pins, npm test, test:snapshots, build, production e browser (nessuna PR o modifica UI/runtime in questa consegna). I test mirati non equivalgono al profilo completo richiesto prima di una PR.
Advisors per i soli nuovi schemi: nessun WARN/ERROR; 9 INFO RLS enabled no policy, deny-by-default intenzionale. Accesso USAGE anon/authenticated falso su tutti e tre gli schemi. Bucket pubblico=false.

Artifact (ignorati da Git, ripetibili):
- artifacts/supabase/preflight.jsonl: verifica hash e cardinalità di tutti i chunk pubblici.
- artifacts/supabase/test-import.log: 26 test PASS; format.log: formattazione.
- artifacts/supabase/resume-interrupted.jsonl e resume-verified.jsonl: prova ripresa.
- artifacts/supabase/negative-readback.py e .log: corruzione/rollback.
- artifacts/supabase/capacity-guard.jsonl e readonly-guard.py/.log: guard dei limiti.
- artifacts/supabase/checkpoints-before-space-recovery.json: audit dei risultati effimeri prima della pulizia.
- artifacts/supabase/documents-import.jsonl: 595 confronti JSON e completamento.
- artifacts/supabase/snapshot-preflight-strict.jsonl: preflight dei documenti, inclusa assenza di chiavi duplicate.
- artifacts/supabase/pack-pilot.jsonl e pack-all.jsonl: pacchetti, ricostruzione 10.022 file, totale byte.
- artifacts/supabase/final-verification.json: stato SQL corrente, conteggi, ruoli e versioni migrazioni.
- artifacts/supabase/security-advisors.json: soli avvisi relativi a DVNS.

Le quattro migrazioni sono state create inizialmente tramite CLI e i nomi file locali sono stati allineati alle versioni realmente registrate da apply_migration: 20261103200131, 20261103201945, 20261103211714, 20261103213217. I vecchi timestamp citati nelle sezioni storiche sono quelli del bootstrap locale, non file da riapplicare.
