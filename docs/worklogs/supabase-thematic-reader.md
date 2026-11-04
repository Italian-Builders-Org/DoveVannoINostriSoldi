# Snapshot tematici da Supabase

- Richiesta: repo aggiornata e dati canonici fruibili da DB/Supabase anche per pagine tematiche.
- Base locale cac80e2c; upstream 15c9bdc7 (GTFS/mobilità). Main aggiornato ff-only, analysis/ conservata. Integrato upstream nel branch isolato codex/supabase-local-reader, nessun push/deploy.
- Atteso: corpus SQL diretto; snapshot tematici/indici serviti da cache di release ricostruita da manifest SQL + bucket privato, confrontando documenti SQL e byte originali. Nessun fallback ai file generati Git quando cloud mancante; nessun cambio alle fonti live o agli asset editoriali/statici GTFS appena introdotti.
- Per compatibilità con i lettori sincroni/import JSON, avvio in una directory runtime propria: codice aggiornato, generated da Supabase, .next separata. Nessuna sovrascrittura dei file Git o copia delle env. Cache verificata prima dell'avvio; processo fallisce se mancano ricevute/byte/hash/documenti o release corretta.
- Rischi da coprire prima del codice: path traversal/symlink, file extra/mancanti, blob corrotto/segmento errato, documento DB divergente, cache corrotta o incompleta, selezione di revisione errata; copia di credenziali, codice nuovo perso, due runtime sulla stessa cache.
- Controlli: test offline su fixture prima implementazione, recupero reale intero inventario non-corpus e confronto byte + documenti SQL, E2E HTTP e browser su IRPEF/AIFA/ANAC e pagina mobilità aggiornata; corpus API ancora diretto DB. Test ETL solo mirati ai nuovi moduli, suite completa NOT RUN. Nessuna PR richiesta.

## Implementazione e prove intermedie

- Pin inventario verificato dalla sorgente locale: 10.022 file, SHA d9f207193dd00a160af10787ace65cafdd89c62b10bca26c1ae6f3520a548a7a; registro invariato dopo upstream 15c9bdc7. Dati selezionati c3fa7372, codice aggiornato separatamente.
- Primo restore fermato da OperationalError di rete durante il download (log runtime-restore.jsonl conservato). La causa di rete non è stata isolata; ridotto il tempo di vita della sessione SQL: documenti letti prima, DB chiuso prima dei download. Nessuna forzatura o modifica al progetto.
- Nuovo restore completo PASS: 1.903 file / 1.472.006.917 byte / 595 documenti confrontati, zero file extra o mancanti; hash byte-esatti e valori Decimal. Log runtime-restore-resumed.jsonl. Corpus escluso dalla cache e ancora interrogato via SQL.
- Prima del codice, test restore e runtime-view fallivano per moduli mancanti; poi 30 ETL Supabase mirati PASS con guard offline e 34 Node mirati PASS. ESLint mirato e typecheck PASS. Suite ETL completa NOT RUN.
- HTTP baseline precedente al cambio runtime: 5 risposte JSON esatte (IRPEF comunale/fasce regionali, farmaci AIFA, ricerca dispositivi, corpus Consip), conservate per confronto dopo il riavvio. Configurazioni e fonti live non sono state spostate in SQL; asset GTFS/statici appena acquisiti da main conservati.

## Esito finale

- `npm run dev:supabase` verificato su cache già popolata: nuova lettura DB e verifica completa dei 1.903 file/595 documenti PASS prima dell'avvio. Next dev serve dalla directory runtime `artifacts/supabase-runtime/site-60791`, PID server 60879 / launcher 60791, porta 43174, sessione 83470. `.next` distinta dal checkout e da qualsiasi altro worktree. La vecchia istanza della task (launcher 57169) è stata terminata dopo averne verificato l'ascendenza; nessun processo altrui toccato.
- `node artifacts/supabase-reader/thematic-http.mjs check`: cinque risposte API byte-equivalenti dopo parsing JSON, digest identici alla baseline: PASS. `http-check.mjs`: 200/400/404 con no-store per errori PASS. Il primo percorso UI ipotizzato per farmaci non esisteva: AIFA è verificata sull'API reale, la pagina sanitaria su `/spese/sanita`.
- Browser Computer/Chrome: IRPEF, sanità, imprese aggiudicatarie ANAC e nuova mappa mobilità a 1280x900 e 390x844 PASS, zero overflow globale e console errors; filtro IRPEF applicato da tastiera (Lazio, una riga) PASS. Mappa GTFS visualizzata con rete e rilievi. Screenshot `thematic-*-1280.png`, `thematic-*-390.png`, trascrizione `thematic-browser.json`.
- Limite osservato: render `/spese/sanita` in dev circa 9 s; la prima navigazione ha superato il timeout del browser, poi pagina 200 e verifiche completate. Non misurata una baseline prestazionale comparabile: non attribuire il tempo alla cache o a Supabase senza ulteriore prova.
- SQL READ ONLY e controlli privati PASS (`thematic-security.json`): 113 ricevute/8.047.880 righe inalterate, schemi senza USAGE anon/authenticated, bucket non pubblico. Nessuna scrittura cloud o migrazione in questa fase.
- Finali: 31 ETL mirati con guard offline PASS; 34 Node mirati con guard offline PASS; ESLint mirato/typecheck/diff-check PASS. Full ETL, build e produzione NOT RUN (richiesta locale, nessuna PR/deploy). Evidenza e SHA verificato in `artifacts/supabase-reader/thematic-evidence.json`.
- Copertura: tutti gli artifact runtime del registro arrivano da Supabase (SQL + Storage), usando una cache immutabile locale verificata prima dell'avvio; le SELECT per ogni grafico non sono state introdotte. Corpus rimane SQL diretto. Dati live, fonti raw di acquisizione, configurazione editoriale e asset statici restano sul loro percorso appropriato.

- Ulteriore caso di sicurezza verificato prima della chiusura: il percorso cache deve risolvere dentro artifacts del checkout, anche con symlink; un argomento errato non può sovrascrivere i generated Git. Ogni avvio usa una directory runtime unica, evitando file di codice obsoleti da run precedenti.
